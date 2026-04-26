"""§48 — Runtime gateway auto-start.

Until §48, XSafeClaw never started any framework gateway by itself. The user
flow was painful::

    1. setup → install OpenClaw / Hermes / Nanobot via the wizard
    2. close XSafeClaw, restart it
    3. open Town / Configure → "[No response]" everywhere
    4. SSH into a terminal and manually run::

        openclaw gateway start
        nanobot gateway --port 18790 --verbose
        systemctl --user start hermes-gateway.service

…before any chat actually works again.

§48 closes that gap on **two** trigger points:

* **Boot-time** (`autostart_installed_runtimes()`) — called from the FastAPI
  ``lifespan`` startup hook, after DB init / file-watcher boot. Probes each
  framework's *install state* (binary or config dir present) and *health
  endpoint*; only attempts a start when installed-but-not-running. Dispatched
  via ``asyncio.create_task`` so a slow start (e.g. systemd taking 8s to bind)
  never delays XSafeClaw's own ``/health`` from going green.
* **Post-install** — the install/init endpoints that *just created* the
  framework's config call the corresponding ``autostart_*`` helper so the
  user doesn't have to reach for a terminal to "finish the install".
  ``/install-hermes`` already did this (via ``_hermes_bring_up_api``); §48
  adds the same behaviour for ``/nanobot/init-default``.

Design rules:

* **Idempotent.** Every helper checks the gateway's health endpoint *first*
  and returns ``("already_running", ...)`` if it's up. Calling them twice in
  a row is safe and cheap.
* **Best-effort.** A failing start is logged but never raises. XSafeClaw must
  keep serving its own UI even when none of the gateways are up — the user
  needs that UI to fix the gateway.
* **No new wheels.** Hermes start path goes through
  ``api.routes.system::_restart_hermes_api_server`` (the same logic
  ``/hermes/apply`` and ``/hermes-enable-api-server`` already use).
  OpenClaw uses the upstream ``openclaw gateway start --json`` service
  command. Nanobot uses the same ``start_new_session=True`` detached spawn
  pattern that ``_hermes_bring_up_api`` step (3) uses.
* **Opt-out.** Disabled by setting ``AUTO_START_RUNTIMES=false``
  in the env / ``.env``. We do not provide a per-framework knob because the
  helpers already no-op when a framework isn't installed — there's nothing
  to disable in that case.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Result tuple meaning, used uniformly across helpers:
#   status:
#     "already_running"  — gateway was already responding when we probed
#     "started"          — we started it and a follow-up probe succeeded
#     "skipped"          — framework not installed / not configured
#     "failed"           — installed but start attempt did not bring it up
#     "disabled"         — auto-start globally turned off
#   detail: short human-readable explanation suitable for log lines
StartResult = tuple[str, str]


# ───────────────────────── shared helpers ──────────────────────────────


async def _probe_http_health(
    url: str,
    *,
    timeout_s: float = 2.0,
    accept_status: tuple[int, ...] = (200,),
) -> bool:
    """Return True if a quick HTTP GET to ``url`` returns any accept_status."""
    try:
        import httpx
    except Exception:
        # httpx is a hard dep of XSafeClaw; if missing the install is broken.
        return False
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.get(url)
            return resp.status_code in accept_status
    except Exception:
        return False


async def _wait_http_health(
    url: str,
    *,
    timeout_s: float,
    poll_interval_s: float = 0.5,
    accept_status: tuple[int, ...] = (200,),
) -> bool:
    """Poll ``url`` until it answers or ``timeout_s`` elapses."""
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout_s
    while loop.time() < deadline:
        if await _probe_http_health(url, accept_status=accept_status):
            return True
        await asyncio.sleep(poll_interval_s)
    return False


async def _run_cmd(
    args: list[str],
    *,
    env: dict[str, str] | None = None,
    timeout_s: float = 15.0,
) -> tuple[int, str]:
    """Tiny subprocess wrapper; returns ``(rc, combined_output)``.

    Mirrors the contract of ``api.routes.system::_run_cmd`` but lives here so
    this module has no import-time coupling on the routes layer (the routes
    layer imports lots of heavy deps — uvicorn middleware, the runtime
    registry, etc.).
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            stdin=asyncio.subprocess.DEVNULL,
            env=env,
        )
        try:
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
        except TimeoutError:
            try:
                proc.kill()
                await proc.wait()
            except Exception:
                pass
            return 124, f"timeout after {timeout_s:.0f}s"
        return proc.returncode or 0, (stdout or b"").decode("utf-8", errors="replace")
    except FileNotFoundError as exc:
        return 127, f"executable not found: {exc}"
    except Exception as exc:
        return 1, f"{type(exc).__name__}: {exc}"


# ───────────────────────── OpenClaw ────────────────────────────────────


def _openclaw_installed() -> tuple[bool, str | None]:
    """Detect OpenClaw via PATH-resolved CLI + ``~/.openclaw/openclaw.json``.

    We require *both* — having only the CLI means the user never ran
    ``openclaw onboard`` and there's no daemon to start; having only the
    config file means the CLI was uninstalled and we'd just fail spawning.
    """
    cli = shutil.which("openclaw")
    if not cli:
        return False, None
    config = Path.home() / ".openclaw" / "openclaw.json"
    if not config.exists():
        return False, cli
    return True, cli


async def autostart_openclaw(*, timeout_s: float = 10.0) -> StartResult:
    """Best-effort start of the local OpenClaw gateway service.

    Strategy:
      1. Skip if CLI is missing or ``~/.openclaw/openclaw.json`` is absent
         (the daemon would refuse to start without ``gateway.mode=local``).
      2. ``openclaw gateway start --json`` — the upstream service-control
         command (works on systemd / launchd / schtasks).
      3. Re-probe ``ws://127.0.0.1:18789`` via a quick HTTP GET. The
         WebSocket port responds with ``426 Upgrade Required`` on plain
         HTTP, which is enough to confirm a listener is bound — we don't
         need a real WS handshake here, the runtime registry will do that
         when a chat actually starts.
    """
    installed, cli = _openclaw_installed()
    if not installed:
        return "skipped", "openclaw CLI or ~/.openclaw/openclaw.json missing"

    probe_url = "http://127.0.0.1:18789/"
    if await _probe_http_health(probe_url, accept_status=(200, 400, 401, 426)):
        return "already_running", "openclaw gateway already listening on :18789"

    rc, out = await _run_cmd(
        [cli, "gateway", "start", "--json"], timeout_s=timeout_s
    )
    snippet = out.strip().splitlines()[-1][:240] if out.strip() else ""
    if rc != 0:
        return (
            "failed",
            f"`openclaw gateway start` exited rc={rc}: {snippet or 'no output'}",
        )

    if await _wait_http_health(
        probe_url, timeout_s=timeout_s, accept_status=(200, 400, 401, 426)
    ):
        return "started", "openclaw gateway is now listening on :18789"
    return (
        "failed",
        "openclaw gateway start returned 0 but no listener bound on :18789 "
        "after wait — check `openclaw gateway status` for details.",
    )


# ───────────────────────── Hermes ──────────────────────────────────────


def _hermes_installed() -> bool:
    """Same check as ``api.routes.system::_hermes_runtime_detected``.

    Duplicated here (cheap one-liner) so this module stays import-light.
    """
    return Path.home().joinpath(".hermes").is_dir() or shutil.which("hermes") is not None


async def autostart_hermes(*, timeout_s: float = 20.0) -> StartResult:
    """Best-effort start of the Hermes API server.

    Reuses ``_restart_hermes_api_server`` from the system routes — it's the
    same function ``/hermes/apply`` and the post-install hook already use,
    and it's idempotent (no-op when ``/health`` is already 200).
    """
    if not _hermes_installed():
        return "skipped", "Hermes not installed (~/.hermes missing and no `hermes` on PATH)"

    # Cheap fast-path: skip the heavy restart pipeline if the API is already up.
    from ..config import settings as _settings  # local import → no circular dep
    health_url = f"http://127.0.0.1:{_settings.hermes_api_port}/health"
    if await _probe_http_health(health_url):
        return "already_running", f"hermes /health already 200 on :{_settings.hermes_api_port}"

    # Lazy import: routes.system imports settings, registry, etc. — defer it
    # until autostart actually runs so we don't pay that cost on every test
    # that imports this module.
    from ..api.routes.system import _restart_hermes_api_server  # type: ignore

    success, log = await _restart_hermes_api_server(timeout_s=timeout_s)
    if success:
        return "started", f"hermes API server is now responding on :{_settings.hermes_api_port}"
    # Truncate the multi-section log for a clean one-line summary.
    last_line = ""
    for line in reversed(log.splitlines()):
        if line.strip():
            last_line = line.strip()[:240]
            break
    return "failed", f"hermes API server did not come up — last log: {last_line or '(empty)'}"


# ───────────────────────── Nanobot ─────────────────────────────────────


_NANOBOT_DEFAULT_CONFIG = Path.home() / ".nanobot" / "config.json"
_NANOBOT_DEFAULT_GATEWAY_PORT = 18790


def _nanobot_installed() -> tuple[bool, str | None]:
    """Detect Nanobot via PATH-resolved CLI + ``~/.nanobot/config.json``.

    Without the config file there's no gateway port / channels block to
    serve, so spawning ``nanobot gateway`` would just exit with a config
    error. Caller must run ``/nanobot/init-default`` first.
    """
    from ..api.routes.system import _build_env, _find_nanobot  # type: ignore

    cli = _find_nanobot(env=_build_env())
    if not cli:
        return False, None
    if not _NANOBOT_DEFAULT_CONFIG.exists():
        return False, cli
    return True, cli


def _nanobot_gateway_port() -> int:
    """Read the gateway port from the user's config; fall back to the default."""
    try:
        import json as _json
        data = _json.loads(_NANOBOT_DEFAULT_CONFIG.read_text(encoding="utf-8"))
    except Exception:
        return _NANOBOT_DEFAULT_GATEWAY_PORT
    if not isinstance(data, dict):
        return _NANOBOT_DEFAULT_GATEWAY_PORT
    gateway = data.get("gateway")
    if isinstance(gateway, dict):
        port = gateway.get("port")
        if isinstance(port, int) and 0 < port < 65536:
            return port
    return _NANOBOT_DEFAULT_GATEWAY_PORT


async def autostart_nanobot(*, timeout_s: float = 12.0) -> StartResult:
    """Best-effort start of the local Nanobot gateway.

    Nanobot has no service-mode (no ``nanobot gateway install`` equivalent
    of OpenClaw/Hermes), so we use the same detached-spawn pattern that
    ``_hermes_bring_up_api`` step (3) uses for Hermes:

      * write logs to ``~/.nanobot/gateway.log`` so the user can ``tail -f``
      * ``start_new_session=True`` so the child survives this Python process
        exiting (we want it to outlive a XSafeClaw restart, just like the
        user's manual ``nanobot gateway --port 18790 --verbose`` does).
      * ``stdin=DEVNULL`` so it doesn't try to read from our terminal.
    """
    installed, cli = _nanobot_installed()
    if not installed:
        if cli is None:
            return "skipped", "nanobot CLI missing on PATH"
        return "skipped", "nanobot CLI present but ~/.nanobot/config.json missing"

    port = _nanobot_gateway_port()
    health_url = f"http://127.0.0.1:{port}/health"
    if await _probe_http_health(health_url):
        return "already_running", f"nanobot /health already 200 on :{port}"

    log_path = Path.home() / ".nanobot" / "gateway.log"
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_fh = open(log_path, "ab", buffering=0)
    except Exception as exc:
        return "failed", f"could not open {log_path} for nanobot gateway logs: {exc}"

    try:
        from ..api.routes.system import _build_env, _build_nanobot_command  # type: ignore

        env = _build_env()
        await asyncio.create_subprocess_exec(
            *_build_nanobot_command(cli, ["gateway", "--port", str(port)]),
            stdin=asyncio.subprocess.DEVNULL,
            stdout=log_fh,
            stderr=asyncio.subprocess.STDOUT,
            start_new_session=True,
            close_fds=os.name != "nt",
            env=env,
        )
        # log_fh is now owned by the child; we deliberately do NOT close it
        # here — closing on the parent side would only close our copy of the
        # fd, but we leave it open to keep the file-table entry alive in
        # case any logging from this same Python process also writes to it.
    except Exception as exc:
        try:
            log_fh.close()
        except Exception:
            pass
        return "failed", f"detached nanobot gateway spawn failed: {exc}"

    if await _wait_http_health(health_url, timeout_s=timeout_s):
        return "started", f"nanobot gateway is now serving /health on :{port}"
    return (
        "failed",
        f"nanobot gateway spawned but /health silent on :{port} after {timeout_s:.0f}s — "
        f"check {log_path}",
    )


# ───────────────────────── orchestrator ────────────────────────────────


async def autostart_installed_runtimes() -> dict[str, dict[str, Any]]:
    """Run all three autostart helpers in parallel and log a summary.

    Called from ``api.main::lifespan`` via ``asyncio.create_task`` so a slow
    framework start (e.g. systemd taking ~8s) never delays XSafeClaw's own
    ``/health``. Returns a dict for tests / future ``/api/system/runtimes``
    inspection endpoints.
    """
    from ..config import settings as _settings  # local import → no circular dep
    enabled = getattr(_settings, "auto_start_runtimes", True)
    if not enabled:
        logger.info("[autostart] disabled via AUTO_START_RUNTIMES=false")
        return {
            "openclaw": {"status": "disabled", "detail": "auto_start_runtimes=false"},
            "hermes":   {"status": "disabled", "detail": "auto_start_runtimes=false"},
            "nanobot":  {"status": "disabled", "detail": "auto_start_runtimes=false"},
        }

    logger.info("[autostart] probing installed runtimes…")
    results = await asyncio.gather(
        autostart_openclaw(),
        autostart_hermes(),
        autostart_nanobot(),
        return_exceptions=True,
    )
    summary: dict[str, dict[str, Any]] = {}
    for name, result in zip(("openclaw", "hermes", "nanobot"), results):
        if isinstance(result, BaseException):
            status, detail = "failed", f"{type(result).__name__}: {result}"
        else:
            status, detail = result
        summary[name] = {"status": status, "detail": detail}
        # Log levels: surface only the noteworthy ones at INFO, others at DEBUG.
        if status in ("started", "failed"):
            logger.info("[autostart] %s → %s: %s", name, status, detail)
        else:
            logger.debug("[autostart] %s → %s: %s", name, status, detail)
    return summary
