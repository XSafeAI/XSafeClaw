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
_NANOBOT_GATEWAY_LOG = Path.home() / ".nanobot" / "gateway.log"
_NANOBOT_AUTOSTART_LOCK: asyncio.Lock | None = None
_NANOBOT_BROKEN_TOOL_MARKERS = (
    "modulenotfounderror: no module named 'nanobot'",
    "failed to canonicalize script path",
)

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


async def _probe_tcp_listener(
    host: str,
    port: int,
    *,
    timeout_s: float = 1.5,
) -> bool:
    """Return True if a TCP connection to host:port can be established.

    Used as a lightweight "is something bound on this port?" check — much more
    reliable under OpenClaw 4.25 than ``_probe_http_health`` because 4.25's
    gateway only responds to full WebSocket handshakes, and an HTTP GET may
    return a non-accept_status response (or hang) even when the listener is up.
    """
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port),
            timeout=timeout_s,
        )
    except (OSError, asyncio.TimeoutError):
        return False
    try:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
    except Exception:
        pass
    return True


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


_OPENCLAW_PENDING_JSON = Path.home() / ".openclaw" / "devices" / "pending.json"


async def _auto_approve_openclaw_plugin_repairs() -> None:
    """Approve OpenClaw plugin-owned ``metadata-upgrade`` pending requests.

    Under OpenClaw 2026.4.25, a plugin whose device identity was paired on an
    earlier OpenClaw version (or on a different platform — e.g. qqbot's
    ``native-approvals`` sub-device originally pinned as ``linux``, now
    reporting ``win32``) is rejected with ``PAIRING_REQUIRED / metadata-upgrade``
    every time the plugin reloads. The gateway responds by reloading the
    plugin again, which starves the main WebSocket handler and makes every
    ``openclaw <subcommand> --json`` call hang for its whole timeout window.

    The pending queue in ``~/.openclaw/devices/pending.json`` marks these as
    ``clientMode=backend`` + ``isRepair=true``. They are *local* plugin
    self-repair requests (not external pairings), so auto-approving them here
    is both safe and required to keep the gateway healthy enough for
    XSafeClaw's own chat path.

    This runs best-effort in background after ``autostart_openclaw`` reports
    the gateway is reachable; any exception is swallowed because a stale
    plugin pending should never prevent XSafeClaw from serving its UI.
    """
    try:
        import json as _json

        if not _OPENCLAW_PENDING_JSON.exists():
            return
        try:
            raw = _OPENCLAW_PENDING_JSON.read_text(encoding="utf-8")
            parsed = _json.loads(raw)
        except Exception:
            return

        repair_ids: list[str] = []
        if isinstance(parsed, dict):
            iterable = parsed.items()
        elif isinstance(parsed, list):
            iterable = [(None, entry) for entry in parsed if isinstance(entry, dict)]
        else:
            return
        for key, value in iterable:
            if not isinstance(value, dict):
                continue
            if value.get("clientMode") != "backend":
                continue
            if not value.get("isRepair"):
                continue
            req_id = value.get("requestId") or value.get("request_id") or key
            if isinstance(req_id, str) and req_id:
                repair_ids.append(req_id)

        if not repair_ids:
            return

        from ..gateway_client import _find_openclaw_binary  # local import, avoids cycles

        openclaw_bin = _find_openclaw_binary()
        if not openclaw_bin:
            return

        for req_id in repair_ids:
            for cmd in (
                [openclaw_bin, "approve", req_id],
                [openclaw_bin, "devices", "approve", req_id],
                [openclaw_bin, "pairing", "approve", req_id],
            ):
                rc, _out = await _run_cmd(cmd, timeout_s=45.0)
                if rc == 0:
                    logger.info(
                        "[autostart] approved openclaw plugin repair request %s", req_id
                    )
                    break
    except Exception as exc:
        logger.debug("[autostart] plugin-repair approval skipped: %s", exc)


async def autostart_openclaw(*, timeout_s: float = 90.0) -> StartResult:
    """Best-effort start of the local OpenClaw gateway service.

    Strategy (adapted for OpenClaw 2026.4.25):
      1. Skip if CLI is missing or ``~/.openclaw/openclaw.json`` is absent
         (the daemon would refuse to start without ``gateway.mode=local``).
      2. First check **TCP-level** readiness on ``127.0.0.1:18789``. 4.25's
         gateway may take ~80s to finish plugin loading but the port binds
         early, so a raw TCP accept is the most reliable "is anything
         listening?" signal. An HTTP GET is no longer authoritative — 4.25
         sometimes serves a dashboard at ``/`` and sometimes rejects plain
         HTTP until plugins finish booting.
      3. If nothing is bound, invoke ``openclaw gateway start --json``. In
         4.25 this command itself can legitimately take 60‑90s because the
         upstream service wrapper waits for a WebSocket health probe before
         returning. We give it ``timeout_s`` (default 90s) instead of 10s.
      4. If ``start`` ultimately times out but the TCP listener is already
         bound, we treat this as ``already_running`` — the CLI's own WS
         probe may have been rejected (pairing/metadata upgrade issues) while
         the actual gateway is fine for XSafeClaw's signed connects.
      5. Whenever the gateway is reachable, approve any ``isRepair=true``
         plugin pending request (see :func:`_auto_approve_openclaw_plugin_repairs`)
         so the qqbot / memory-core / safeclaw-guard metadata-upgrade loops
         don't starve the main gateway handler.
    """
    installed, cli = _openclaw_installed()
    if not installed:
        return "skipped", "openclaw CLI or ~/.openclaw/openclaw.json missing"

    host, port = "127.0.0.1", 18789
    probe_url = f"http://{host}:{port}/"

    async def _final(status: str, detail: str) -> StartResult:
        if status in ("already_running", "started"):
            try:
                await asyncio.wait_for(
                    _auto_approve_openclaw_plugin_repairs(), timeout=90.0
                )
            except Exception as exc:
                logger.debug("[autostart] plugin-repair approval failed: %s", exc)
        return status, detail

    if await _probe_tcp_listener(host, port):
        return await _final(
            "already_running", f"openclaw gateway already listening on :{port}"
        )

    rc, out = await _run_cmd(
        [cli, "gateway", "start", "--json"], timeout_s=timeout_s
    )
    snippet = out.strip().splitlines()[-1][:240] if out.strip() else ""

    if rc == 0:
        if await _wait_http_health(
            probe_url,
            timeout_s=min(timeout_s, 15.0),
            accept_status=(200, 400, 401, 403, 404, 426, 503),
        ) or await _probe_tcp_listener(host, port):
            return await _final(
                "started", f"openclaw gateway is now listening on :{port}"
            )
        return (
            "failed",
            "openclaw gateway start returned 0 but no listener bound on "
            f":{port} after wait — check `openclaw gateway status` for details.",
        )

    # rc != 0: the CLI itself timed out or errored. Under 4.25 this is common
    # when the internal WS health probe is rejected (metadata-upgrade, scope
    # upgrades, or a stuck plugin), even though the real listener is up and
    # reachable for XSafeClaw's own device-signed connects.
    if await _probe_tcp_listener(host, port):
        return await _final(
            "already_running",
            f"openclaw gateway start exited rc={rc} (CLI health probe failed: "
            f"{snippet or 'no output'}), but a TCP listener is bound on :{port}",
        )

    return (
        "failed",
        f"`openclaw gateway start` exited rc={rc}: {snippet or 'no output'}",
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


def _get_nanobot_autostart_lock() -> asyncio.Lock:
    global _NANOBOT_AUTOSTART_LOCK
    if _NANOBOT_AUTOSTART_LOCK is None:
        _NANOBOT_AUTOSTART_LOCK = asyncio.Lock()
    return _NANOBOT_AUTOSTART_LOCK


def _last_non_empty_line(text: str) -> str:
    for line in reversed(text.splitlines()):
        line = line.strip()
        if line:
            return line[:240]
    return ""


def _nanobot_gateway_log_tail(*, max_lines: int = 16, max_chars: int = 1200) -> str:
    try:
        lines = _NANOBOT_GATEWAY_LOG.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return ""
    tail = lines[-max_lines:]
    joined = " | ".join(line.strip() for line in tail if line.strip())
    return joined[:max_chars]


def _nanobot_log_indicates_broken_tool_env(text: str) -> bool:
    haystack = text.lower()
    return any(marker in haystack for marker in _NANOBOT_BROKEN_TOOL_MARKERS)


def _nanobot_failure_detail(base: str, *, log_tail: str | None = None) -> str:
    tail = (log_tail or "").strip()
    if tail:
        return f"{base}. gateway.log tail: {tail}"
    return base


async def _repair_nanobot_tool_env(reason: str) -> tuple[bool, str, str | None]:
    from ..api.routes.system import (  # type: ignore
        _build_env,
        _build_uv_command,
        _find_nanobot,
        _find_uv_executable,
        _nanobot_official_install_args,
        _nanobot_overlay_install_args,
        _probe_nanobot_cli_async,
    )

    env = _build_env()
    uv_executable = _find_uv_executable(env=env)
    if not uv_executable:
        return False, f"nanobot repair needed ({reason}) but uv is not available", None

    install_args = _nanobot_official_install_args(
        env=env,
        uv_executable=uv_executable,
        force=True,
    )
    rc, out = await _run_cmd(
        _build_uv_command(install_args[0], install_args[1:]),
        env=env,
        timeout_s=240.0,
    )
    if rc != 0:
        return (
            False,
            f"nanobot repair failed during `uv tool install nanobot-ai --force`: "
            f"{_last_non_empty_line(out) or f'rc={rc}'}",
            None,
        )

    overlay_args = _nanobot_overlay_install_args(
        env=env,
        uv_executable=uv_executable,
    )
    rc, out = await _run_cmd(
        _build_uv_command(overlay_args[0], overlay_args[1:]),
        env=env,
        timeout_s=240.0,
    )
    if rc != 0:
        return (
            False,
            f"nanobot repair applied the CLI but failed to refresh the XSafeClaw overlay: "
            f"{_last_non_empty_line(out) or f'rc={rc}'}",
            None,
        )

    env = _build_env()
    cli = _find_nanobot(env=env)
    ready, _, error = await _probe_nanobot_cli_async(
        cli,
        env=env,
        timeout_s=15.0,
    )
    if not ready:
        return (
            False,
            f"nanobot CLI is still unusable after repair: {error or 'executable not detected'}",
            cli,
        )
    return True, f"nanobot CLI repaired after {reason}", cli


async def _spawn_nanobot_gateway(
    cli: str,
    *,
    port: int,
    env: dict[str, str],
) -> tuple[bool, str]:
    try:
        _NANOBOT_GATEWAY_LOG.parent.mkdir(parents=True, exist_ok=True)
        log_fh = open(_NANOBOT_GATEWAY_LOG, "ab", buffering=0)
    except Exception as exc:
        return False, f"could not open {_NANOBOT_GATEWAY_LOG} for nanobot gateway logs: {exc}"

    try:
        from ..api.routes.system import _build_nanobot_command  # type: ignore

        await asyncio.create_subprocess_exec(
            *_build_nanobot_command(cli, ["gateway", "--port", str(port)]),
            stdin=asyncio.subprocess.DEVNULL,
            stdout=log_fh,
            stderr=asyncio.subprocess.STDOUT,
            start_new_session=True,
            close_fds=os.name != "nt",
            env=env,
        )
        return True, ""
    except Exception as exc:
        return False, f"detached nanobot gateway spawn failed: {exc}"
    finally:
        try:
            log_fh.close()
        except Exception:
            pass


async def autostart_nanobot(*, timeout_s: float = 45.0) -> StartResult:
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
    return await _autostart_nanobot_health_checked(timeout_s=timeout_s)


async def _autostart_nanobot_impl(*, timeout_s: float) -> StartResult:
    return await _autostart_nanobot_locked(timeout_s=timeout_s)


async def _autostart_nanobot_locked(*, timeout_s: float) -> StartResult:
    return await _autostart_nanobot_final(timeout_s=timeout_s)


async def _autostart_nanobot_final(*, timeout_s: float) -> StartResult:
    return await _autostart_nanobot_v3(timeout_s=timeout_s)


async def _autostart_nanobot_v3(*, timeout_s: float) -> StartResult:
    return await _autostart_nanobot_chat_ready(timeout_s=timeout_s)


async def _autostart_nanobot_chat_ready(*, timeout_s: float) -> StartResult:
    return await _autostart_nanobot_real(timeout_s=timeout_s)


async def _autostart_nanobot_real(*, timeout_s: float) -> StartResult:
    return await _autostart_nanobot_serialized(timeout_s=timeout_s)


async def _autostart_nanobot_serialized(*, timeout_s: float) -> StartResult:
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


async def _autostart_nanobot_health_checked(*, timeout_s: float) -> StartResult:
    installed, cli = _nanobot_installed()
    if not installed:
        if cli is None:
            return "skipped", "nanobot CLI missing on PATH"
        return "skipped", "nanobot CLI present but ~/.nanobot/config.json missing"

    port = _nanobot_gateway_port()
    health_url = f"http://127.0.0.1:{port}/health"
    if await _probe_http_health(health_url):
        return "already_running", f"nanobot /health already 200 on :{port}"

    async with _get_nanobot_autostart_lock():
        if await _probe_http_health(health_url):
            return "already_running", f"nanobot /health already 200 on :{port}"

        from ..api.routes.system import _build_env, _find_nanobot, _probe_nanobot_cli_async  # type: ignore

        env = _build_env()
        cli_path = cli or _find_nanobot(env=env)
        ready, _, cli_error = await _probe_nanobot_cli_async(
            cli_path,
            env=env,
            timeout_s=15.0,
        )

        repaired = False
        if not ready:
            repair_ok, repair_detail, repaired_cli = await _repair_nanobot_tool_env(
                cli_error or "nanobot --version failed",
            )
            if not repair_ok:
                return "failed", repair_detail
            repaired = True
            env = _build_env()
            cli_path = repaired_cli or _find_nanobot(env=env)

        if not cli_path:
            return "failed", "nanobot CLI is missing after repair; cannot start the gateway"

        spawned, detail = await _spawn_nanobot_gateway(
            cli_path,
            port=port,
            env=env,
        )
        if not spawned:
            return "failed", detail

        if await _wait_http_health(health_url, timeout_s=timeout_s):
            if repaired:
                return "started", f"nanobot gateway is now serving /health on :{port} after repairing the nanobot CLI"
            return "started", f"nanobot gateway is now serving /health on :{port}"

        log_tail = _nanobot_gateway_log_tail()
        if not repaired and _nanobot_log_indicates_broken_tool_env(log_tail):
            repair_ok, repair_detail, repaired_cli = await _repair_nanobot_tool_env(
                "gateway startup exposed a broken nanobot tool environment",
            )
            if not repair_ok:
                return "failed", _nanobot_failure_detail(repair_detail, log_tail=log_tail)

            env = _build_env()
            cli_path = repaired_cli or _find_nanobot(env=env)
            if not cli_path:
                return "failed", _nanobot_failure_detail(
                    "nanobot repair completed but the CLI is still missing",
                    log_tail=log_tail,
                )

            spawned, detail = await _spawn_nanobot_gateway(
                cli_path,
                port=port,
                env=env,
            )
            if not spawned:
                return "failed", detail

            if await _wait_http_health(health_url, timeout_s=timeout_s):
                return "started", f"nanobot gateway recovered on :{port} after repairing the nanobot tool environment"
            log_tail = _nanobot_gateway_log_tail()

        return (
            "failed",
            _nanobot_failure_detail(
                f"nanobot gateway spawned but /health stayed silent on :{port} after {timeout_s:.0f}s",
                log_tail=log_tail,
            ),
        )
