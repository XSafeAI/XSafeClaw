"""System management API – OpenClaw / Hermes install / onboard / status."""

from __future__ import annotations

import asyncio
import json
import os
import re
import select as _select
import shutil
import struct
import threading
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ...config import settings

try:
    import fcntl
except ImportError:
    fcntl = None

try:
    import termios
except ImportError:
    termios = None

router = APIRouter()

# ---------------------------------------------------------------------------
# PTY-based process registry for interactive (onboard) steps
# { proc_id: {"proc": Process, "master_fd": int, "queue": Queue, "done": bool} }
# ---------------------------------------------------------------------------
_procs: dict[str, dict] = {}

# ── ANSI helpers ─────────────────────────────────────────────────────────────
_ANSI_RE = re.compile(
    r'\x1b(?:'
    r'[@-Z\\-_]'                       # Fe sequences (ESC @, ESC [, etc.)
    r'|\[[\x20-\x3f]*[\x40-\x7e]'      # CSI sequences  – handles ?25l, >0h …
    r'|\][^\x07\x1b]*(?:\x07|\x1b\\)'  # OSC sequences
    r'|\([AB012]'                       # Charset selection
    r')'
)

def _strip_ansi(text: str) -> str:
    return _ANSI_RE.sub('', text)

def _is_text_prompt(text: str) -> bool:
    """True when the line (inside a prompt box) looks like a text-input cursor."""
    lower = text.lower()
    text_kw = ['token', 'api key', 'api-key', 'paste', 'email',
               'username', 'password', 'enter your']
    return '›' in text or (
        any(k in lower for k in text_kw) and (
            text.endswith('?') or text.endswith(':')
        )
    )

def _is_text_input_question(text: str) -> bool:
    """
    True when a ◆/◇ question header is asking for text input.
    Catches patterns like "Enter Moonshot API key (.cn)", "Enter token", etc.
    – no ending punctuation required.
    """
    lower = text.lower()
    # "Enter <something>" pattern is always a text input request
    if lower.startswith('enter '):
        return True
    # Keyword anywhere in the question (no ending char needed)
    text_kw = ['api key', 'api-key', 'token', 'password',
               'secret', 'email', 'username', 'access key']
    return any(k in lower for k in text_kw)

# ── nvm / node helpers ────────────────────────────────────────────────────────
_NVM_SCRIPT = Path.home() / ".nvm" / "nvm.sh"
_PATH_SEP = os.pathsep
_OPENCLAW_EXECUTABLES = (
    ("openclaw.cmd", "openclaw.exe", "openclaw.bat", "openclaw.ps1", "openclaw")
    if os.name == "nt"
    else ("openclaw",)
)
_HERMES_EXECUTABLES = (
    ("hermes.cmd", "hermes.exe", "hermes.bat", "hermes.ps1", "hermes")
    if os.name == "nt"
    else ("hermes",)
)


def _is_runnable_file(path: Path) -> bool:
    if not path.is_file():
        return False
    if os.name == "nt":
        return True
    return os.access(path, os.X_OK)


def _pty_supported() -> bool:
    return (
        os.name != "nt"
        and hasattr(os, "openpty")
        and fcntl is not None
        and termios is not None
        and hasattr(termios, "TIOCSWINSZ")
    )


def _set_pty_size(fd: int, rows: int, cols: int) -> None:
    if not _pty_supported():
        return
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

def _build_env() -> dict:
    """Build an env dict that includes nvm Node 22 bin directory if available."""
    env = {**os.environ, "CI": "true", "NO_COLOR": "1"}
    nvm_node22 = Path.home() / ".nvm" / "versions" / "node"
    if nvm_node22.exists():
        v22_dirs = sorted(
            [d for d in nvm_node22.iterdir() if d.name.startswith("v22")],
            reverse=True,
        )
        if v22_dirs:
            v22_bin = str(v22_dirs[0] / "bin")
            current_path = env.get("PATH", "")
            if v22_bin not in current_path:
                env["PATH"] = v22_bin + _PATH_SEP + current_path
    # Match install_openclaw: global npm packages live next to bundled Node when Setup
    # downloaded Node to ~/.xsafeclaw/node — that dir must be on PATH here too.
    _node_dir = Path.home() / ".xsafeclaw" / "node"
    if _node_dir.exists():
        plat, _ = _node_platform_arch()
        node_bin = str(_node_dir) if plat == "win" else str(_node_dir / "bin")
        current_path = env.get("PATH", "")
        if node_bin not in current_path:
            env["PATH"] = node_bin + _PATH_SEP + current_path
    return env

def _find_openclaw() -> Optional[str]:
    """Locate the openclaw binary, checking nvm Node 22 paths first."""
    env = _build_env()
    for d in env.get("PATH", "").split(_PATH_SEP):
        if not d:
            continue
        for executable in _OPENCLAW_EXECUTABLES:
            candidate = Path(d) / executable
            if _is_runnable_file(candidate):
                return str(candidate)
    return shutil.which("openclaw", path=env.get("PATH"))


def _find_hermes() -> Optional[str]:
    """Locate the hermes binary.

    The official installer symlinks ``hermes`` into ``~/.local/bin`` and
    the actual venv binary lives at ``~/hermes-agent/venv/bin/hermes``.
    Non-login shells (systemd, cron, subprocess) often lack these in
    PATH, so we probe them explicitly.
    """
    env = _build_env()

    extra_dirs: list[str] = []
    local_bin = Path.home() / ".local" / "bin"
    if local_bin.is_dir():
        extra_dirs.append(str(local_bin))
    # Official install.sh defaults to ~/.hermes/hermes-agent (older docs mentioned ~/hermes-agent).
    for venv_bin in (
        Path.home() / ".hermes" / "hermes-agent" / "venv" / "bin",
        Path.home() / "hermes-agent" / "venv" / "bin",
    ):
        if venv_bin.is_dir():
            extra_dirs.append(str(venv_bin))
            break

    search_path = env.get("PATH", "")
    for d in extra_dirs:
        if d not in search_path:
            search_path = d + _PATH_SEP + search_path

    for d in search_path.split(_PATH_SEP):
        if not d:
            continue
        for executable in _HERMES_EXECUTABLES:
            candidate = Path(d) / executable
            if _is_runnable_file(candidate):
                return str(candidate)
    return shutil.which("hermes", path=search_path)


def _find_agent_binary() -> Optional[str]:
    """Locate the active platform's binary (``hermes`` or ``openclaw``)."""
    if settings.is_hermes:
        return _find_hermes()
    return _find_openclaw()


# ── Hermes embedded-Python bridge ─────────────────────────────────────────────
# Hermes ships its own Python package tree at ``~/.hermes/hermes-agent/`` with
# a dedicated venv (``venv/bin/python3``).  That interpreter has full access
# to ``hermes_cli.models`` and ``agent.models_dev`` — the upstream single
# source of truth for providers, model ids, and models.dev metadata.
#
# By spawning *that* interpreter (not XSafeClaw's own) we can read the live
# catalog without HTTP scraping or pty TUI gymnastics.  Results are cached so
# the 0.5–2s subprocess startup doesn't run on every onboard-scan hit.

_hermes_interp_cache: tuple[str, str] | None = None  # (hermes_bin, python_path)


def _hermes_python_interpreter() -> Optional[str]:
    """Return the Python interpreter bundled with the installed Hermes.

    Parses the shebang of the ``hermes`` CLI wrapper (installer always writes
    an absolute-path shebang pointing into the Hermes venv).  Returns ``None``
    when Hermes isn't installed or the wrapper doesn't match the expected
    shape — callers must fall back gracefully.
    """
    global _hermes_interp_cache

    hermes_bin = _find_hermes()
    if not hermes_bin:
        return None

    if _hermes_interp_cache and _hermes_interp_cache[0] == hermes_bin:
        return _hermes_interp_cache[1]

    try:
        with open(hermes_bin, "rb") as fh:
            first = fh.readline(256)
    except OSError:
        return None

    if not first.startswith(b"#!"):
        return None
    shebang = first[2:].decode("utf-8", errors="replace").strip()
    if not shebang:
        return None
    # Some installers write "#!/usr/bin/env python3" — reject that, since it
    # doesn't give us Hermes's site-packages.  We only trust absolute paths
    # that resolve to an executable python.
    interp = shebang.split()[0]
    if not os.path.isabs(interp):
        return None
    if not _is_runnable_file(Path(interp)):
        return None

    _hermes_interp_cache = (hermes_bin, interp)
    return interp


def _hermes_install_root() -> Optional[str]:
    """Return the directory containing Hermes's ``hermes_cli/`` and ``agent/``.

    Derived from the venv python's path:
    ``<root>/venv/bin/python3``  →  ``<root>``.  Verified by checking that
    ``hermes_cli/models.py`` actually exists there.
    """
    interp = _hermes_python_interpreter()
    if not interp:
        return None
    p = Path(interp).resolve()
    # Walk up from ``…/venv/bin/python3`` until we find ``hermes_cli``.
    for candidate in (p.parents[2] if len(p.parents) > 2 else None, p.parents[1] if len(p.parents) > 1 else None):
        if candidate is None:
            continue
        if (candidate / "hermes_cli" / "models.py").is_file():
            return str(candidate)
    return None


def _build_openclaw_command(openclaw_path: str, args: list[str]) -> list[str]:
    """Build a subprocess command that can launch OpenClaw across platforms."""
    suffix = Path(openclaw_path).suffix.lower()
    if suffix == ".ps1":
        return [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            openclaw_path,
            *args,
        ]
    return [openclaw_path, *args]


def _build_agent_command(agent_path: str, args: list[str]) -> list[str]:
    """Build a subprocess command for the active platform binary."""
    return _build_openclaw_command(agent_path, args)

def _find_node_version() -> str:
    """Return the currently accessible Node.js version string."""
    import subprocess
    env = _build_env()
    try:
        result = subprocess.run(
            ["node", "--version"],
            capture_output=True, text=True, timeout=5, env=env,
        )
        return result.stdout.strip()
    except Exception:
        return "unknown"


# ──────────────────────────────────────────────
# Status
# ──────────────────────────────────────────────

@router.get("/status")
async def get_system_status():
    """Check whether the agent CLI is installed and whether its daemon is running."""
    env = _build_env()
    platform_name = settings.resolved_platform

    if settings.is_hermes:
        return await _hermes_status(env)

    # ── OpenClaw status ───────────────────────────────────────────────────
    openclaw_path = _find_openclaw()

    if not openclaw_path:
        return {
            "platform": platform_name,
            "openclaw_installed": False,
            "hermes_installed": _find_hermes() is not None,
            "openclaw_version": None,
            "daemon_running": False,
            "openclaw_path": None,
            "node_version": _find_node_version(),
            "config_exists": _CONFIG_PATH.exists(),
        }

    version: Optional[str] = None
    try:
        proc = await asyncio.create_subprocess_exec(
            openclaw_path, "--version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=5)
        raw = (stdout or stderr).decode().strip()
        version = raw.splitlines()[0] if raw else "unknown"
        if "requires Node" in version or "Upgrade Node" in version:
            return {
                "platform": platform_name,
                "openclaw_installed": False,
                "hermes_installed": _find_hermes() is not None,
                "openclaw_version": None,
                "daemon_running": False,
                "openclaw_path": None,
                "node_version": _find_node_version(),
                "config_exists": _CONFIG_PATH.exists(),
                "error": "node_version_too_low",
            }
    except Exception:
        version = "unknown"

    daemon_running = False
    try:
        proc2 = await asyncio.create_subprocess_exec(
            openclaw_path, "status",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        await asyncio.wait_for(proc2.communicate(), timeout=5)
        daemon_running = proc2.returncode == 0
    except Exception:
        pass

    return {
        "platform": platform_name,
        "openclaw_installed": True,
        "hermes_installed": _find_hermes() is not None,
        "openclaw_version": version,
        "daemon_running": daemon_running,
        "openclaw_path": openclaw_path,
        "node_version": _find_node_version(),
        "config_exists": _CONFIG_PATH.exists(),
    }


async def _hermes_api_reachable() -> bool:
    """Return True if the Hermes HTTP API server responds on the configured port."""
    try:
        import httpx
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(
                f"http://127.0.0.1:{settings.hermes_api_port}/health"
            )
            return resp.status_code == 200
    except Exception:
        pass
    try:
        import httpx
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(
                f"http://127.0.0.1:{settings.hermes_api_port}/v1/models"
            )
            return resp.status_code in (200, 401, 403)
    except Exception:
        return False


# ──────────────────────────────────────────────────────────────────────────────
# Hermes API server lifecycle helpers
#
# OpenClaw achieves "configure-and-use" because the ``openclaw onboard`` CLI
# both writes the config file and signals the running gateway daemon to reload.
# Hermes has no equivalent: the API server only reads ``~/.hermes/.env`` and
# ``~/.hermes/config.yaml`` at process startup. To reach parity, any change to
# those files made by XSafeClaw must be followed by a restart of the Hermes
# API server + a readiness probe — the same pattern used in the OpenClaw path
# of ``_quick_model_config_*``.
# ──────────────────────────────────────────────────────────────────────────────

async def _wait_hermes_api_up(timeout_s: float) -> bool:
    """Poll the Hermes ``/health`` endpoint until it responds or timeout."""
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout_s
    while loop.time() < deadline:
        if await _hermes_api_reachable():
            return True
        await asyncio.sleep(0.4)
    return False


def _kill_pid_on_port(port: int, grace_s: float = 3.0) -> list[int]:
    """Terminate any process listening on ``port`` (SIGTERM → SIGKILL).

    Returns the PIDs that were signalled (empty list if none / lsof missing).
    This is the last-resort fallback when ``hermes api restart`` / ``stop``
    are not recognised by the installed Hermes CLI version.
    """
    import signal as _signal
    import subprocess as _sp
    import time as _time

    pids: list[int] = []
    try:
        out = _sp.check_output(
            ["lsof", "-ti", f":{port}"], text=True, stderr=_sp.DEVNULL
        )
        pids = [int(x) for x in out.split() if x.strip().isdigit()]
    except Exception:
        try:
            out = _sp.check_output(
                ["fuser", f"{port}/tcp"], text=True, stderr=_sp.DEVNULL
            )
            pids = [int(x) for x in out.split() if x.strip().isdigit()]
        except Exception:
            pids = []

    for pid in pids:
        try:
            os.kill(pid, _signal.SIGTERM)
        except Exception:
            pass

    steps = max(1, int(grace_s / 0.2))
    for _ in range(steps):
        alive: list[int] = []
        for pid in pids:
            try:
                os.kill(pid, 0)
                alive.append(pid)
            except Exception:
                pass
        if not alive:
            return pids
        _time.sleep(0.2)

    for pid in pids:
        try:
            os.kill(pid, _signal.SIGKILL)
        except Exception:
            pass
    return pids


async def _run_cmd(
    cmd: list[str], *, env: dict, timeout_s: float = 10.0
) -> tuple[int, str]:
    """Run a subprocess, capturing merged stdout+stderr. ``127`` = not found."""
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            stdin=asyncio.subprocess.DEVNULL,
            env=env,
            start_new_session=True,
        )
    except FileNotFoundError as exc:
        return 127, f"not found: {exc}"
    except Exception as exc:
        return 1, f"spawn failed: {exc}"
    try:
        stdout_bytes, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        return 124, "timeout"
    return proc.returncode or 0, stdout_bytes.decode("utf-8", errors="replace").strip()


async def _find_hermes_user_units(env: dict) -> list[str]:
    """Return systemd ``--user`` service units whose name contains ``hermes``.

    The official installer's ``hermes setup`` / ``hermes gateway install`` wizard
    registers one or more user units (e.g. ``hermes-gateway.service``) that
    own the HTTP listener on ``hermes_api_port``. Restarting *those* is the
    reliable way to reload ``~/.hermes/.env`` + ``config.yaml`` on installs
    where the ``hermes api`` CLI subcommand does not exist (as of the upstream
    fork shipped with ``hermes --help`` lacking ``api``).
    """
    rc, out = await _run_cmd(
        ["systemctl", "--user", "list-unit-files", "--no-pager", "--plain",
         "--type=service"],
        env=env,
        timeout_s=5,
    )
    if rc != 0 or not out:
        return []
    units: list[str] = []
    for line in out.splitlines():
        parts = line.strip().split()
        if not parts:
            continue
        unit = parts[0]
        if not unit.endswith(".service"):
            continue
        if "hermes" in unit.lower():
            units.append(unit)
    # Prefer units that are currently active (listening) first so we avoid
    # triggering ones that are intentionally disabled.
    active: list[str] = []
    inactive: list[str] = []
    for unit in units:
        rc, state = await _run_cmd(
            ["systemctl", "--user", "is-active", unit], env=env, timeout_s=3
        )
        if state.strip() == "active":
            active.append(unit)
        else:
            inactive.append(unit)
    return active + inactive


def _snapshot_listener_cmdline(port: int) -> list[str] | None:
    """Return ``/proc/<pid>/cmdline`` of a process listening on ``port``.

    Used as a last-resort way to relaunch the same process after we kill it —
    works for foreground ``hermes gateway`` runs, systemd units, nohup scripts,
    anything that doesn't hide in a container. Returns ``None`` on Windows or
    when the PID cannot be resolved.
    """
    import subprocess as _sp

    for probe in (["lsof", "-ti", f":{port}"], ["fuser", f"{port}/tcp"]):
        try:
            out = _sp.check_output(probe, text=True, stderr=_sp.DEVNULL)
            pid_str = next((x for x in out.split() if x.strip().isdigit()), "")
            if not pid_str:
                continue
            proc_path = Path(f"/proc/{pid_str}/cmdline")
            if not proc_path.exists():
                continue
            raw = proc_path.read_bytes()
            if not raw:
                continue
            parts = [p.decode("utf-8", errors="replace") for p in raw.split(b"\x00") if p]
            return parts or None
        except Exception:
            continue
    return None


async def _restart_hermes_api_server(timeout_s: float = 20.0) -> tuple[bool, str]:
    """Best-effort restart of the Hermes API listener so it reloads config.

    Different Hermes distributions expose the HTTP API on ``hermes_api_port``
    through different mechanisms. We try each in order and stop at the first
    that brings ``/health`` back up:

      1. ``systemctl --user restart <hermes-*.service>`` — the installer's
         default. Works even when the ``hermes`` CLI has no ``api`` subcommand.
      2. ``hermes gateway restart`` / ``stop + start`` — the combined
         messaging-gateway-plus-API entry point on versions where gateway hosts
         the HTTP listener.
      3. ``hermes api restart`` / ``stop + start`` — the dedicated lifecycle
         commands on upstream builds that split API out of gateway.
      4. Kill the PID on the port and relaunch ``/proc/<pid>/cmdline`` — final
         fallback for hand-started processes (``nohup hermes gateway`` etc.).

    Returns ``(success, log)``. ``success`` means ``/health`` came back within
    ``timeout_s`` seconds after the attempted action.
    """
    hermes_bin = _find_hermes()
    env = _build_env()
    sections: list[str] = []

    # ── 1. systemd user units ─────────────────────────────────────────────
    try:
        units = await _find_hermes_user_units(env)
    except Exception as exc:
        units = []
        sections.append(f"systemctl --user probe failed: {exc}")
    if units:
        sections.append(f"Detected Hermes systemd user units: {', '.join(units)}")
        any_success = False
        for unit in units:
            rc, out = await _run_cmd(
                ["systemctl", "--user", "restart", unit], env=env, timeout_s=15
            )
            sections.append(f"$ systemctl --user restart {unit}\n[rc={rc}] {out}")
            if rc == 0:
                any_success = True
        if any_success and await _wait_hermes_api_up(min(timeout_s, 10)):
            return True, "\n\n".join(sections)
    else:
        sections.append("No Hermes systemd user units found — skipping systemctl path.")

    # ── 2. hermes gateway subcommands ─────────────────────────────────────
    if hermes_bin:
        rc, out = await _run_cmd(
            [hermes_bin, "gateway", "restart"], env=env, timeout_s=12
        )
        sections.append(f"$ hermes gateway restart\n[rc={rc}] {out}")
        if rc == 0 and await _wait_hermes_api_up(6.0):
            return True, "\n\n".join(sections)

        rc1, out1 = await _run_cmd([hermes_bin, "gateway", "stop"], env=env, timeout_s=8)
        sections.append(f"$ hermes gateway stop\n[rc={rc1}] {out1}")
        rc2, out2 = await _run_cmd([hermes_bin, "gateway", "start"], env=env, timeout_s=8)
        sections.append(f"$ hermes gateway start\n[rc={rc2}] {out2}")
        if await _wait_hermes_api_up(6.0):
            return True, "\n\n".join(sections)

        # ── 3. hermes api subcommands (upstream split) ────────────────────
        rc, out = await _run_cmd(
            [hermes_bin, "api", "restart"], env=env, timeout_s=12
        )
        sections.append(f"$ hermes api restart\n[rc={rc}] {out}")
        if rc == 0 and await _wait_hermes_api_up(5.0):
            return True, "\n\n".join(sections)

        rc1, out1 = await _run_cmd([hermes_bin, "api", "stop"], env=env, timeout_s=8)
        sections.append(f"$ hermes api stop\n[rc={rc1}] {out1}")
        rc2, out2 = await _run_cmd([hermes_bin, "api", "start"], env=env, timeout_s=8)
        sections.append(f"$ hermes api start\n[rc={rc2}] {out2}")
        if await _wait_hermes_api_up(5.0):
            return True, "\n\n".join(sections)
    else:
        sections.append(
            "⚠ `hermes` executable not found on PATH / venv. Skipping CLI fallbacks."
        )

    # ── 4. kill + relaunch captured cmdline ───────────────────────────────
    port = settings.hermes_api_port
    captured = _snapshot_listener_cmdline(port)
    if captured:
        sections.append(f"Captured listener cmdline on :{port} → {captured}")
    else:
        sections.append(f"Could not capture /proc/<pid>/cmdline for :{port}.")

    killed = _kill_pid_on_port(port)
    sections.append(f"$ kill pid on :{port}\nsignalled: {killed or '(none)'}")

    relaunch_cmd: list[str] | None = None
    if captured:
        relaunch_cmd = captured
    elif hermes_bin:
        relaunch_cmd = [hermes_bin, "gateway"]
    if relaunch_cmd:
        try:
            await asyncio.create_subprocess_exec(
                *relaunch_cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                stdin=asyncio.subprocess.DEVNULL,
                env=env,
                start_new_session=True,
            )
            await asyncio.sleep(0.5)
            sections.append(f"$ {' '.join(relaunch_cmd)} (detached)\n[launched]")
        except Exception as exc:
            sections.append(f"$ {' '.join(relaunch_cmd)} (detached)\nfailed: {exc}")

    if await _wait_hermes_api_up(timeout_s):
        return True, "\n\n".join(sections)

    sections.append(
        f"⚠ Hermes /health did not respond within {timeout_s:.0f}s after all "
        "restart attempts. Configuration was persisted to ~/.hermes/.env and "
        "config.yaml, but the running server still holds the old config. "
        "Restart Hermes manually (e.g. `systemctl --user restart <unit>`, or "
        "the script/command you used to start it)."
    )
    return False, "\n\n".join(sections)


async def _wait_hermes_runtime_ready(
    model_id: str | None,
    *,
    timeout_s: float = 10.0,
) -> tuple[bool, str | None]:
    """Poll Hermes ``/v1/models`` until ``model_id`` is in the runtime catalog.

    When ``model_id`` is falsy, only confirms that ``/health`` is reachable.
    Mirrors the readiness probe used by the OpenClaw fast-path.
    """
    from ...hermes_client import HermesClient
    from .chat import _extract_runtime_model_list, _runtime_catalog_match

    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout_s
    while loop.time() < deadline:
        client: HermesClient | None = None
        try:
            client = HermesClient(api_key=settings.hermes_api_key or None)
            await asyncio.wait_for(client.connect(), timeout=3)
            if not model_id:
                return True, None
            raw = await asyncio.wait_for(client.list_models(), timeout=3)
            catalog = _extract_runtime_model_list(raw)
            ok, visible = _runtime_catalog_match(catalog, model_id)
            if ok:
                return True, visible
        except Exception:
            pass
        finally:
            if client is not None:
                try:
                    await client.disconnect()
                except Exception:
                    pass
        await asyncio.sleep(0.5)
    return False, None


async def _hermes_status(env: dict) -> dict:
    """Check Hermes installation and gateway status.

    Hermes may run on the same machine (binary on PATH) or on a remote
    host that XSafeClaw reaches via its HTTP API.  We treat Hermes as
    "installed" when *either* the binary is found locally *or* the API
    server is reachable, so that the Setup page correctly skips to the
    Configure flow.
    """
    hermes_path = _find_hermes()

    api_reachable = await _hermes_api_reachable()

    hermes_installed = hermes_path is not None or api_reachable

    # Surface whether the HTTP API listener is enabled in ~/.hermes/.env.
    # Without API_SERVER_ENABLED=true, the gateway boots but /health never
    # binds. The Configure status page shows this so the user can tell
    # "gateway not running" from "gateway running but HTTP disabled".
    api_server_enabled = (
        _read_dotenv_value(_hermes_env_path(), "API_SERVER_ENABLED").lower() == "true"
    )

    if not hermes_installed:
        return {
            "platform": "hermes",
            "openclaw_installed": False,
            "hermes_installed": False,
            "openclaw_version": None,
            "daemon_running": False,
            "openclaw_path": None,
            "hermes_path": None,
            "config_exists": _CONFIG_PATH.exists(),
            "hermes_api_port": settings.hermes_api_port,
            "hermes_config_path": str(settings.hermes_config_path),
            "hermes_home": str(settings.hermes_home),
            "hermes_api_key_configured": bool(settings.hermes_api_key),
            "hermes_api_server_enabled": api_server_enabled,
        }

    version: Optional[str] = None
    if hermes_path:
        try:
            proc = await asyncio.create_subprocess_exec(
                hermes_path, "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=5)
            raw = (stdout or stderr).decode().strip()
            version = raw.splitlines()[0] if raw else "unknown"
        except Exception:
            version = "unknown"
    else:
        version = "remote"

    config_exists = _CONFIG_PATH.exists() or api_reachable

    return {
        "platform": "hermes",
        "openclaw_installed": True,
        "hermes_installed": True,
        "openclaw_version": version,
        "daemon_running": api_reachable,
        "openclaw_path": hermes_path,
        "hermes_path": hermes_path,
        "config_exists": config_exists,
        "hermes_api_port": settings.hermes_api_port,
        "hermes_config_path": str(settings.hermes_config_path),
        "hermes_home": str(settings.hermes_home),
        "hermes_api_key_configured": bool(settings.hermes_api_key),
        "hermes_api_server_enabled": api_server_enabled,
    }


# ──────────────────────────────────────────────
# Hermes API key management
# ──────────────────────────────────────────────

class _HermesApiKeyRequest(BaseModel):
    api_key: str = ""


def _hermes_env_path() -> Path:
    """Return the Hermes-side .env path (``~/.hermes/.env``)."""
    return Path.home() / ".hermes" / ".env"


def _upsert_dotenv_line(path: Path, key_name: str, value: str) -> None:
    """Upsert ``key_name=value`` into a dotenv-style file, creating it as needed.

    Keeps comments/other variables untouched and replaces an existing line
    (including ones that are commented out in the form ``# API_SERVER_KEY=...``).
    """
    path.parent.mkdir(parents=True, exist_ok=True)

    lines: list[str] = []
    if path.exists():
        try:
            lines = path.read_text("utf-8").splitlines()
        except Exception:
            lines = []

    replaced = False
    new_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith(f"{key_name}=") or stripped.startswith(f"# {key_name}="):
            new_lines.append(f"{key_name}={value}")
            replaced = True
        else:
            new_lines.append(line)

    if not replaced:
        new_lines.append(f"{key_name}={value}")

    path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")


def _read_dotenv_value(path: Path, key_name: str) -> str:
    """Read the current value of ``key_name`` from a dotenv file. Returns ``""``."""
    if not path.exists():
        return ""
    try:
        for raw in path.read_text("utf-8").splitlines():
            stripped = raw.strip()
            if stripped.startswith("#") or "=" not in stripped:
                continue
            k, _, v = stripped.partition("=")
            if k.strip() == key_name:
                return v.strip().strip("'\"")
    except Exception:
        pass
    return ""


def _ensure_hermes_api_server_env(*, port: int | None = None) -> list[str]:
    """Ensure ``~/.hermes/.env`` has the HTTP-API-server enable flag set.

    The Hermes HTTP API (OpenAI-compatible ``/health``, ``/v1/models``,
    ``/v1/chat/completions``) is **not** a standalone command — it is an
    optional component hosted *inside* ``hermes gateway``.  Per upstream
    docs (https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server)
    it only starts when the following env vars are present in ``~/.hermes/.env``:

        API_SERVER_ENABLED=true
        API_SERVER_KEY=<shared-secret>         # XSafeClaw already writes this
        # API_SERVER_PORT=8642                 # default, overridden only when changed
        # API_SERVER_HOST=127.0.0.1            # default, loopback-only

    Without ``API_SERVER_ENABLED=true`` the gateway boots up the messaging
    components only — and ``curl http://127.0.0.1:8642/health`` times out.
    XSafeClaw has to write this flag itself, otherwise XSafeClaw ↔ Hermes
    integration is broken from the very first boot.

    Returns the list of keys that were newly written / changed, so callers
    can surface them in SSE install logs or status endpoints.
    """
    env_path = _hermes_env_path()
    touched: list[str] = []

    if _read_dotenv_value(env_path, "API_SERVER_ENABLED").lower() != "true":
        _upsert_dotenv_line(env_path, "API_SERVER_ENABLED", "true")
        touched.append("API_SERVER_ENABLED")

    # Keep the port explicit in .env when we deviate from 8642 so the user
    # and ``hermes gateway`` agree on where the listener binds. When set to
    # the default we leave the key unset (upstream default kicks in).
    effective_port = port if port is not None else settings.hermes_api_port
    current_port = _read_dotenv_value(env_path, "API_SERVER_PORT")
    if effective_port != 8642 and current_port != str(effective_port):
        _upsert_dotenv_line(env_path, "API_SERVER_PORT", str(effective_port))
        touched.append("API_SERVER_PORT")

    return touched


def _persist_hermes_api_key(key_value: str) -> None:
    """Write ``key_value`` into both XSafeClaw's .env (HERMES_API_KEY) and
    Hermes' own .env (API_SERVER_KEY), and update the running settings instance.
    Passing an empty string clears it on both sides.

    Also enables the Hermes HTTP API server via ``API_SERVER_ENABLED=true``
    when a non-empty key is written (see ``_ensure_hermes_api_server_env``).
    """
    import dotenv

    # XSafeClaw side — HERMES_API_KEY used by our own HTTP client.
    env_path = Path.cwd() / ".env"
    if not env_path.exists():
        example = Path.cwd() / ".env.example"
        if example.exists():
            import shutil
            shutil.copy(example, env_path)
        else:
            env_path.write_text("", encoding="utf-8")
    dotenv.set_key(str(env_path), "HERMES_API_KEY", key_value)
    settings.hermes_api_key = key_value

    # Hermes side — API_SERVER_KEY that the Hermes API server enforces.
    # We mirror it so both sides always match and the user does not have to
    # hand-edit ~/.hermes/.env. NOTE: Hermes processes need to be restarted to
    # pick up the new value; the API endpoint surfaces that reminder.
    _upsert_dotenv_line(_hermes_env_path(), "API_SERVER_KEY", key_value)

    # Without API_SERVER_ENABLED=true the Hermes HTTP listener never binds
    # and /health never responds — see upstream docs. We set it unconditionally
    # whenever a key is persisted (idempotent). For the "clear the key"
    # path (empty value) we leave the enable flag alone so the user can still
    # run Hermes' API for other frontends.
    if key_value:
        _ensure_hermes_api_server_env()


@router.get("/hermes-api-key-status")
async def hermes_api_key_status():
    """Return whether a Hermes API key is currently configured (never exposes the value)."""
    configured_here = bool(settings.hermes_api_key)
    hermes_side = bool(_read_dotenv_value(_hermes_env_path(), "API_SERVER_KEY"))
    return {
        "configured": configured_here,
        "hermes_side_configured": hermes_side,
        "in_sync": configured_here == hermes_side and (
            not configured_here
            or settings.hermes_api_key
            == _read_dotenv_value(_hermes_env_path(), "API_SERVER_KEY")
        ),
    }


@router.post("/hermes-api-key")
async def save_hermes_api_key(body: _HermesApiKeyRequest):
    """Persist a user-supplied Hermes API key.

    The same value is written to XSafeClaw's ``.env`` (``HERMES_API_KEY``) and
    Hermes' ``~/.hermes/.env`` (``API_SERVER_KEY``) so the user never has to
    drop to a terminal to keep them in sync.
    """
    key_value = body.api_key.strip()
    _persist_hermes_api_key(key_value)
    return {
        "success": True,
        "configured": bool(key_value),
        "hermes_env_path": str(_hermes_env_path()),
        "requires_hermes_restart": True,
    }


@router.post("/hermes-api-key/generate")
async def generate_hermes_api_key():
    """Generate a strong random API key, persist it on both sides, and return
    the generated value once so the UI can display/copy it.
    """
    import secrets

    new_key = secrets.token_urlsafe(32)
    _persist_hermes_api_key(new_key)
    return {
        "success": True,
        "configured": True,
        "api_key": new_key,
        "hermes_env_path": str(_hermes_env_path()),
        "requires_hermes_restart": True,
    }


@router.get("/hermes-api-key/reveal")
async def reveal_hermes_api_key():
    """Return the currently configured Hermes API key value.

    This endpoint is used when a user forgot the key they set earlier. It reads
    from XSafeClaw's runtime settings first, then falls back to Hermes'
    ``~/.hermes/.env``. Returns an empty string when no key is set.
    """
    value = settings.hermes_api_key or _read_dotenv_value(
        _hermes_env_path(), "API_SERVER_KEY"
    )
    return {
        "api_key": value,
        "source": "xsafeclaw" if settings.hermes_api_key else (
            "hermes" if value else "none"
        ),
    }


@router.post("/hermes-enable-api-server")
async def hermes_enable_api_server():
    """Flip ``API_SERVER_ENABLED=true`` in ``~/.hermes/.env`` and restart
    the gateway so the HTTP listener on ``hermes_api_port`` actually binds.

    Purpose: the Hermes HTTP API (``/health``, ``/v1/models``,
    ``/v1/chat/completions``) is implemented *inside* ``hermes gateway`` but
    guarded by this env flag. Upstream ships it as ``false`` by default, so
    a fresh install of Hermes looks "running" (``hermes status`` is happy)
    while XSafeClaw cannot talk to it. See:
    https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server

    Called from the Configure status page's "Enable API listener" button
    when ``hermes_api_server_enabled`` is ``false`` in status. Also safe to
    call repeatedly — writes are idempotent.

    Returns whether ``/health`` came back up after the restart.
    """
    touched = _ensure_hermes_api_server_env()
    # Ensure we have an API_SERVER_KEY too; otherwise /v1/* would 401.
    existing_key = _read_dotenv_value(_hermes_env_path(), "API_SERVER_KEY")
    if not existing_key:
        import secrets
        _persist_hermes_api_key(secrets.token_urlsafe(32))
        touched.append("API_SERVER_KEY")

    restarted, restart_detail = await _restart_hermes_api_server(timeout_s=25.0)
    api_reachable = await _hermes_api_reachable()

    return {
        "success": True,
        "env_changes": touched,
        "hermes_api_server_enabled": True,
        "restart_attempted": True,
        "restart_succeeded": restarted,
        "restart_detail": restart_detail,
        "api_reachable": api_reachable,
        "hermes_api_port": settings.hermes_api_port,
    }


class HermesApplyRequest(BaseModel):
    # Optional: if provided, /v1/models is polled until this id is listed,
    # giving the frontend a reliable "ready" signal after restart.
    model_id: Optional[str] = None


@router.post("/hermes/apply")
async def hermes_apply(body: HermesApplyRequest | None = None):
    """Restart the Hermes API server so it reloads ``~/.hermes/.env`` and
    ``~/.hermes/config.yaml``, then probe ``/health`` (and optionally
    ``/v1/models``) to confirm the new configuration is live.

    This is the Hermes counterpart to OpenClaw's implicit gateway reload
    after ``openclaw onboard``. The quick-model-config endpoint calls it
    automatically when ``auto_apply=True`` (the default); this standalone
    endpoint is useful after manual edits of ``~/.hermes/.env`` or when the
    UI wants to offer an explicit "Apply to Hermes" button.
    """
    if not settings.is_hermes:
        raise HTTPException(status_code=400, detail="Not running in Hermes mode")

    api_was_running = await _hermes_api_reachable()
    restart_ok, output = await _restart_hermes_api_server()
    model_id = (body.model_id if body else None) or None
    ready = False
    visible_model: Optional[str] = None
    if restart_ok:
        ready, visible_model = await _wait_hermes_runtime_ready(
            model_id, timeout_s=10.0
        )

    return {
        "success": restart_ok and ready,
        "restart_ok": restart_ok,
        "api_was_running": api_was_running,
        "api_reachable": await _hermes_api_reachable(),
        "model_id": model_id,
        "model_ready": bool(model_id) and ready,
        "visible_model": visible_model,
        "output": output,
    }


# ──────────────────────────────────────────────
# Hermes external-bot / messaging-platform config
# ──────────────────────────────────────────────
# Hermes' gateway talks to a large number of messaging platforms.  Each one
# takes a fixed set of credentials that Hermes reads from ``~/.hermes/.env``
# on startup.  The Configure wizard lets the user paste these credentials
# from the browser so they don't need a shell.
#
# We keep the platform schema on the backend (single source of truth) and
# expose it via ``GET /system/hermes-bot-platforms``; the frontend renders
# the fields generically.  Adding a new platform = just append to this dict.
_HERMES_BOT_PLATFORMS: dict[str, dict] = {
    "telegram": {
        "name": "Telegram",
        "hint": "@BotFather → /newbot. Paste the bot token. Optionally allowlist users.",
        "docUrl": "https://core.telegram.org/bots/tutorial",
        "fields": [
            {"key": "TELEGRAM_BOT_TOKEN", "label": "Bot Token", "required": True, "secret": True,
             "placeholder": "123456:ABC-..."},
            {"key": "TELEGRAM_ALLOWED_USERS", "label": "Allowed user IDs (comma-separated, optional)",
             "required": False, "secret": False, "placeholder": "111111111,222222222"},
        ],
    },
    "discord": {
        "name": "Discord",
        "hint": "Discord Developer Portal → New Application → Bot. Paste the bot token.",
        "docUrl": "https://discord.com/developers/applications",
        "fields": [
            {"key": "DISCORD_BOT_TOKEN", "label": "Bot Token", "required": True, "secret": True,
             "placeholder": "MTEx..."},
        ],
    },
    "slack": {
        "name": "Slack",
        "hint": "Slack App (bot scopes) → OAuth & Permissions → Bot User OAuth Token. App-level token enables Socket Mode.",
        "docUrl": "https://api.slack.com/apps",
        "fields": [
            {"key": "SLACK_BOT_TOKEN", "label": "Bot User OAuth Token", "required": True, "secret": True,
             "placeholder": "xoxb-..."},
            {"key": "SLACK_APP_TOKEN", "label": "App-Level Token (optional, xapp-...)",
             "required": False, "secret": True, "placeholder": "xapp-..."},
        ],
    },
    "feishu": {
        "name": "Feishu / Lark (飞书)",
        "hint": "开发者后台 → 应用凭证。支持国内飞书与 Lark 国际版。",
        "docUrl": "https://open.feishu.cn/app",
        "fields": [
            {"key": "FEISHU_APP_ID", "label": "App ID", "required": True, "secret": False,
             "placeholder": "cli_a..."},
            {"key": "FEISHU_APP_SECRET", "label": "App Secret", "required": True, "secret": True,
             "placeholder": "..."},
        ],
    },
    "dingtalk": {
        "name": "DingTalk (钉钉)",
        "hint": "钉钉开放平台 → 企业内部应用 → AppKey / AppSecret。",
        "docUrl": "https://open.dingtalk.com/",
        "fields": [
            {"key": "DINGTALK_APP_KEY", "label": "AppKey", "required": True, "secret": False,
             "placeholder": "dingxxxx..."},
            {"key": "DINGTALK_APP_SECRET", "label": "AppSecret", "required": True, "secret": True,
             "placeholder": "..."},
        ],
    },
    "wecom": {
        "name": "WeCom (企业微信)",
        "hint": "企业微信管理后台 → 应用管理 → 自建应用。",
        "docUrl": "https://work.weixin.qq.com/",
        "fields": [
            {"key": "WECOM_CORP_ID", "label": "CorpID", "required": True, "secret": False,
             "placeholder": "ww..."},
            {"key": "WECOM_AGENT_ID", "label": "AgentID", "required": True, "secret": False,
             "placeholder": "1000002"},
            {"key": "WECOM_SECRET", "label": "App Secret", "required": True, "secret": True,
             "placeholder": "..."},
        ],
    },
}


@router.get("/hermes-bot-platforms")
async def hermes_bot_platforms():
    """Return the schema for every supported Hermes messaging platform.

    The frontend renders each platform generically from ``fields``, so
    appending a new one here is all that's needed to make it configurable
    from the Configure wizard.  Also reports which env vars already have
    a value in ``~/.hermes/.env`` so the UI can surface "already set" hints.
    """
    if not settings.is_hermes:
        raise HTTPException(status_code=400, detail="Not running in Hermes mode")

    env_path = _hermes_env_path()
    configured: dict[str, bool] = {}
    platforms_out: list[dict] = []
    for pid, spec in _HERMES_BOT_PLATFORMS.items():
        fields_out: list[dict] = []
        any_configured = False
        for field in spec["fields"]:
            has_value = bool(_read_dotenv_value(env_path, field["key"]))
            if has_value:
                any_configured = True
            fields_out.append({**field, "configured": has_value})
        configured[pid] = any_configured
        platforms_out.append({
            "id": pid,
            "name": spec["name"],
            "hint": spec.get("hint", ""),
            "docUrl": spec.get("docUrl", ""),
            "fields": fields_out,
            "configured": any_configured,
        })

    return {
        "platforms": platforms_out,
        "env_path": str(env_path),
        "any_configured": any(configured.values()),
    }


class HermesBotConfigRequest(BaseModel):
    # Platform id as returned by ``/hermes-bot-platforms`` (e.g. ``"telegram"``).
    platform: str
    # Map of env-var name → value.  Only keys declared in the platform spec
    # are accepted; unknown keys are silently dropped.  Empty-string values
    # clear the corresponding env var.
    fields: dict[str, str] = Field(default_factory=dict)
    # When True (default), ``_restart_hermes_api_server`` is triggered after
    # the write so the gateway picks up the new credentials without the user
    # touching a shell.  Matches the model-config flow.
    auto_apply: bool = True


@router.post("/hermes-bot-config")
async def hermes_bot_config(body: HermesBotConfigRequest):
    """Persist one messaging-platform's credentials into ``~/.hermes/.env``.

    Writes only the keys declared in the platform spec.  If ``auto_apply``
    is true and the Hermes API is currently reachable, the server is
    restarted so the gateway re-reads the updated credentials.  Otherwise
    the configuration is stored but requires a manual restart.
    """
    if not settings.is_hermes:
        raise HTTPException(status_code=400, detail="Not running in Hermes mode")

    spec = _HERMES_BOT_PLATFORMS.get(body.platform)
    if not spec:
        raise HTTPException(status_code=400, detail=f"Unknown platform: {body.platform}")

    allowed_keys = {f["key"] for f in spec["fields"]}
    required_keys = {f["key"] for f in spec["fields"] if f.get("required")}
    supplied = {k: (v or "").strip() for k, v in body.fields.items() if k in allowed_keys}

    # A "save" action must at least populate every required field — otherwise
    # we'd leave the platform half-configured and Hermes would fail loudly.
    missing = [k for k in required_keys if not supplied.get(k)]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required field(s) for {body.platform}: {', '.join(missing)}",
        )

    env_path = _hermes_env_path()
    env_path.parent.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    for key in allowed_keys:
        if key in supplied:
            _upsert_dotenv_line(env_path, key, supplied[key])
            written.append(key)

    # Apply / restart path, mirroring _quick_model_config_hermes so both
    # flows give the frontend identical ``applied`` / ``api_reachable``
    # semantics.
    output = ""
    restart_ok = True
    api_was_running = await _hermes_api_reachable()

    if body.auto_apply and api_was_running:
        restart_ok, output = await _restart_hermes_api_server()
    elif body.auto_apply and not api_was_running:
        restart_ok = False
        output = (
            f"Hermes API server on 127.0.0.1:{settings.hermes_api_port} is "
            "not running. Credentials saved to ~/.hermes/.env — start the "
            "Hermes gateway/API for the bot to come online."
        )

    return {
        "success": True,
        "platform": body.platform,
        "written_keys": written,
        "applied": bool(body.auto_apply and restart_ok and api_was_running),
        "api_was_running": api_was_running,
        "api_reachable": await _hermes_api_reachable(),
        "output": output,
    }


# ──────────────────────────────────────────────
# Install  (npm install -g openclaw@latest)
# ──────────────────────────────────────────────

import platform as _platform
import tempfile

_NODE_INSTALL_DIR = Path.home() / ".xsafeclaw" / "node"
_NODE_DIST_INDEX = "https://nodejs.org/dist/index.json"


def _find_npm(env: dict) -> Optional[str]:
    """Locate npm binary using the given environment."""
    sep = ";" if os.name == "nt" else ":"
    for d in env.get("PATH", "").split(sep):
        candidate = Path(d) / ("npm.cmd" if os.name == "nt" else "npm")
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return shutil.which("npm")


def _node_platform_arch() -> tuple[str, str]:
    """Return (node_platform, node_arch) for download URL."""
    system = _platform.system().lower()
    machine = _platform.machine().lower()
    if system == "darwin":
        plat = "darwin"
    elif system == "windows":
        plat = "win"
    else:
        plat = "linux"
    arch_map = {
        "x86_64": "x64", "amd64": "x64",
        "aarch64": "arm64", "arm64": "arm64",
        "armv7l": "armv7l",
    }
    arch = arch_map.get(machine, "x64")
    return plat, arch


async def _resolve_node_lts_version() -> str:
    """Fetch latest LTS version string from nodejs.org (e.g. 'v22.22.0')."""
    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(_NODE_DIST_INDEX)
        resp.raise_for_status()
        for entry in resp.json():
            if entry.get("lts"):
                return entry["version"]
    raise RuntimeError("Could not resolve Node.js LTS version")


async def _download_with_progress(url: str, dest: Path):
    """Download a file and yield (downloaded_bytes, total_bytes) tuples."""
    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            total = int(resp.headers.get("content-length", 0))
            downloaded = 0
            with open(dest, "wb") as f:
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    f.write(chunk)
                    downloaded += len(chunk)
                    yield downloaded, total


async def _install_node(env: dict):
    """Download and extract Node.js to ~/.xsafeclaw/node/. Yields SSE data lines."""
    plat, arch = _node_platform_arch()

    yield f"data: {json.dumps({'type': 'node_status', 'step': 'resolving'})}\n\n"
    try:
        version = await _resolve_node_lts_version()
    except Exception as exc:
        yield f"data: {json.dumps({'type': 'error', 'message': f'Failed to resolve Node.js version: {exc}'})}\n\n"
        return
    yield f"data: {json.dumps({'type': 'output', 'text': f'Latest Node.js LTS: {version}'})}\n\n"

    if plat == "win":
        ext = "zip"
        archive_name = f"node-{version}-{plat}-{arch}.{ext}"
    else:
        ext = "tar.xz"
        archive_name = f"node-{version}-{plat}-{arch}.{ext}"

    url = f"https://nodejs.org/dist/{version}/{archive_name}"
    yield f"data: {json.dumps({'type': 'node_status', 'step': 'downloading', 'url': url, 'version': version})}\n\n"

    tmp_dir = Path(tempfile.mkdtemp(prefix="xsafeclaw-node-"))
    archive_path = tmp_dir / archive_name

    try:
        last_pct = -1
        async for downloaded, total in _download_with_progress(url, archive_path):
            if total > 0:
                pct = int(downloaded * 100 / total)
                if pct != last_pct and (pct % 5 == 0 or pct == 100):
                    mb_down = downloaded / 1048576
                    mb_total = total / 1048576
                    yield f"data: {json.dumps({'type': 'node_progress', 'downloaded': downloaded, 'total': total, 'percent': pct, 'text': f'Downloading Node.js {version}... {mb_down:.1f} / {mb_total:.1f} MB ({pct}%)'})}\n\n"
                    last_pct = pct

        yield f"data: {json.dumps({'type': 'output', 'text': 'Download complete. Extracting...'})}\n\n"
        yield f"data: {json.dumps({'type': 'node_status', 'step': 'extracting'})}\n\n"

        _NODE_INSTALL_DIR.parent.mkdir(parents=True, exist_ok=True)
        if _NODE_INSTALL_DIR.exists():
            shutil.rmtree(str(_NODE_INSTALL_DIR))

        if plat == "win":
            import zipfile
            with zipfile.ZipFile(archive_path) as zf:
                zf.extractall(tmp_dir)
            extracted = tmp_dir / archive_name.replace(".zip", "")
            extracted.rename(_NODE_INSTALL_DIR)
        else:
            import tarfile
            with tarfile.open(archive_path) as tf:
                tf.extractall(tmp_dir)
            extracted = tmp_dir / archive_name.replace(".tar.xz", "")
            extracted.rename(_NODE_INSTALL_DIR)

        if plat == "win":
            node_bin = str(_NODE_INSTALL_DIR)
        else:
            node_bin = str(_NODE_INSTALL_DIR / "bin")

        env["PATH"] = node_bin + (";" if os.name == "nt" else ":") + env.get("PATH", "")

        yield f"data: {json.dumps({'type': 'output', 'text': f'Node.js {version} installed to {_NODE_INSTALL_DIR}'})}\n\n"
        yield f"data: {json.dumps({'type': 'node_status', 'step': 'done', 'version': version})}\n\n"

    except Exception as exc:
        yield f"data: {json.dumps({'type': 'error', 'message': f'Failed to install Node.js: {exc}'})}\n\n"
    finally:
        shutil.rmtree(str(tmp_dir), ignore_errors=True)


@router.post("/install")
async def install_openclaw():
    """Auto-install Node.js if npm is missing, then install openclaw via npm. Streams SSE."""
    env = _build_env()

    # Pre-check: if we previously installed Node.js, add it to PATH
    if _NODE_INSTALL_DIR.exists():
        plat, _ = _node_platform_arch()
        node_bin = str(_NODE_INSTALL_DIR) if plat == "win" else str(_NODE_INSTALL_DIR / "bin")
        env["PATH"] = node_bin + (";" if os.name == "nt" else ":") + env.get("PATH", "")

    async def generate():
        npm_path = _find_npm(env)

        if not npm_path:
            yield f"data: {json.dumps({'type': 'output', 'text': 'npm not found. Installing Node.js automatically...'})}\n\n"
            async for line in _install_node(env):
                yield line
                if '"type": "error"' in line:
                    return

            npm_path = _find_npm(env)
            if not npm_path:
                yield f"data: {json.dumps({'type': 'error', 'message': 'npm still not found after Node.js install. Please install Node.js manually.'})}\n\n"
                return

        # Force git to use HTTPS instead of SSH/git:// (avoids protocol blocks)
        env["GIT_CONFIG_COUNT"] = "2"
        env["GIT_CONFIG_KEY_0"] = "url.https://github.com/.insteadOf"
        env["GIT_CONFIG_VALUE_0"] = "git@github.com:"
        env["GIT_CONFIG_KEY_1"] = "url.https://.insteadOf"
        env["GIT_CONFIG_VALUE_1"] = "git://"

        yield f"data: {json.dumps({'type': 'output', 'text': 'Running: npm install -g openclaw@latest'})}\n\n"
        yield f"data: {json.dumps({'type': 'npm_install_start'})}\n\n"

        try:
            proc = await asyncio.create_subprocess_exec(
                npm_path, "install", "-g", "openclaw@latest",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                stdin=asyncio.subprocess.DEVNULL,
                env=env,
            )
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").rstrip()
                yield f"data: {json.dumps({'type': 'output', 'text': text})}\n\n"
            await proc.wait()
            if proc.returncode == 0:
                yield f"data: {json.dumps({'type': 'done', 'success': True})}\n\n"
                trigger_onboard_scan_preload()
            else:
                yield f"data: {json.dumps({'type': 'done', 'success': False, 'exit_code': proc.returncode})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ──────────────────────────────────────────────
# Install Hermes  (official install script + gateway deps)
# ──────────────────────────────────────────────

_HERMES_INSTALL_SCRIPT_URL = (
    "https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh"
)


def _hermes_repo_dir() -> Path:
    """Resolve install path from official Hermes install.sh (default ~/.hermes/hermes-agent)."""
    default = Path.home() / ".hermes" / "hermes-agent"
    legacy = Path.home() / "hermes-agent"
    if default.is_dir():
        return default
    if legacy.is_dir():
        return legacy
    return default


async def _hermes_bring_up_api(env: dict):
    """SSE generator: non-interactively bring the Hermes API listener up.

    Yielded events use the same ``data: {json}\\n\\n`` shape as the rest of
    ``install_hermes`` so the frontend progress stream stays uniform.

    Order of attempts — stops at the first that makes ``/health`` return 200:
      0. Write ``API_SERVER_ENABLED=true`` (+ port override if needed) to
         ``~/.hermes/.env``. **Without this flag, ``hermes gateway`` boots
         only the messaging components and ``/health`` never binds** — this
         was the root cause of the "health never visible" bug that persisted
         even after manual ``hermes setup`` / ``restart gateway``.
         See: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server
      1. ``hermes gateway install`` (documented, non-interactive).
      2. ``systemctl --user daemon-reload`` + ``enable --now`` on every
         ``hermes-*.service`` we can discover.
      3. Spawn ``hermes gateway`` detached (``nohup … &``) — works when no
         systemd user session is available (e.g. ``loginctl enable-linger``
         not set).  Output is redirected to ``~/.hermes/gateway.log`` so the
         user can ``tail -f`` it for troubleshooting.
      4. pty-driven ``hermes setup`` feeding blank lines + EOF — best-effort.
    """
    hermes_bin = _find_hermes()
    port = settings.hermes_api_port

    # ── (0) Enable the HTTP API inside the gateway ────────────────────
    # Hermes ships with API_SERVER_ENABLED=false by default. Every start of
    # `hermes gateway` without this flag silently skips the HTTP listener,
    # which is why curl :8642/health kept failing even after `hermes setup`
    # and `hermes gateway` restarts.
    touched = _ensure_hermes_api_server_env(port=port)
    if touched:
        keys_list = ", ".join(touched)
        msg = f"▸ Enabled Hermes HTTP API in ~/.hermes/.env ({keys_list}=…)"
        yield f"data: {json.dumps({'type': 'output', 'text': msg})}\n\n"
    else:
        yield f"data: {json.dumps({'type': 'output', 'text': '✓ ~/.hermes/.env already has API_SERVER_ENABLED=true'})}\n\n"

    # Ensure an API_SERVER_KEY exists so the first HTTP call is authorized.
    # If XSafeClaw already has HERMES_API_KEY we mirror that; otherwise a
    # random key is generated and mirrored back to XSafeClaw's own .env so
    # the Configure/API-Key page picks it up.
    existing_key = _read_dotenv_value(_hermes_env_path(), "API_SERVER_KEY")
    if not existing_key:
        from secrets import token_urlsafe
        new_key = token_urlsafe(32)
        _persist_hermes_api_key(new_key)
        yield f"data: {json.dumps({'type': 'output', 'text': '▸ Generated API_SERVER_KEY and mirrored to both .env files'})}\n\n"

    if await _hermes_api_reachable():
        yield f"data: {json.dumps({'type': 'output', 'text': f'✓ Hermes API already listening on :{port}; no bring-up needed.'})}\n\n"
        return

    # ── (1) hermes gateway install ────────────────────────────────────
    if hermes_bin:
        yield f"data: {json.dumps({'type': 'output', 'text': '▸ Running: hermes gateway install'})}\n\n"
        rc, out = await _run_cmd(
            [hermes_bin, "gateway", "install"], env=env, timeout_s=60
        )
        for segment in (out or "").splitlines():
            if segment.strip():
                yield f"data: {json.dumps({'type': 'output', 'text': segment})}\n\n"
        yield f"data: {json.dumps({'type': 'output', 'text': f'gateway install → rc={rc}'})}\n\n"
    else:
        yield f"data: {json.dumps({'type': 'output', 'text': '⚠ `hermes` executable not found on PATH; skipping gateway install.'})}\n\n"

    # ── (2) systemctl --user enable --now <hermes-*.service> ──────────
    await _run_cmd(["systemctl", "--user", "daemon-reload"], env=env, timeout_s=5)
    try:
        units = await _find_hermes_user_units(env)
    except Exception as exc:
        units = []
        yield f"data: {json.dumps({'type': 'output', 'text': f'systemctl --user probe failed: {exc}'})}\n\n"

    if units:
        _units_str = ", ".join(units)
        yield f"data: {json.dumps({'type': 'output', 'text': f'Detected systemd user units: {_units_str}'})}\n\n"
        for unit in units:
            yield f"data: {json.dumps({'type': 'output', 'text': f'▸ systemctl --user enable --now {unit}'})}\n\n"
            rc, out = await _run_cmd(
                ["systemctl", "--user", "enable", "--now", unit],
                env=env,
                timeout_s=15,
            )
            for segment in (out or "").splitlines():
                if segment.strip():
                    yield f"data: {json.dumps({'type': 'output', 'text': segment})}\n\n"
            yield f"data: {json.dumps({'type': 'output', 'text': f'enable --now {unit} → rc={rc}'})}\n\n"
    else:
        yield f"data: {json.dumps({'type': 'output', 'text': 'No hermes-*.service found under systemctl --user.'})}\n\n"

    if await _wait_hermes_api_up(10.0):
        return

    # ── (3) Detached `hermes gateway` spawn ───────────────────────────
    # Works in environments where systemd --user is unavailable / linger is
    # off (WSL, plain docker, some cloud VMs). We redirect to a log file so
    # the user can ``tail -f ~/.hermes/gateway.log`` when troubleshooting.
    if hermes_bin:
        log_path = settings.hermes_home / "gateway.log"
        try:
            log_path.parent.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        yield f"data: {json.dumps({'type': 'output', 'text': f'▸ Spawning: nohup hermes gateway > {log_path} 2>&1 &'})}\n\n"
        try:
            # start_new_session detaches from our controlling terminal so
            # the child keeps running after this SSE response closes.
            log_fh = open(log_path, "ab", buffering=0)
            await asyncio.create_subprocess_exec(
                hermes_bin, "gateway",
                stdin=asyncio.subprocess.DEVNULL,
                stdout=log_fh,
                stderr=asyncio.subprocess.STDOUT,
                env=env,
                start_new_session=True,
                close_fds=True,
            )
            # don't close log_fh — the child now owns that fd
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'output', 'text': f'⚠ Detached gateway spawn failed: {exc}'})}\n\n"
        else:
            if await _wait_hermes_api_up(12.0):
                yield f"data: {json.dumps({'type': 'output', 'text': f'✓ Detached hermes gateway is serving /health on :{port}'})}\n\n"
                return
            yield f"data: {json.dumps({'type': 'output', 'text': f'… detached gateway spawned but /health still silent; see {log_path} for errors.'})}\n\n"

    # ── (4) pty-driven `hermes setup` (best-effort) ───────────────────
    # The interactive wizard keeps asking questions until it gets EOF or a
    # final "yes/no" that closes the stream. We allocate a pseudo-TTY so its
    # input() calls don't raise, and we continuously feed "\n" (accept
    # default) for 20s before closing. Prompt set varies by version, so we
    # cap the runtime and never let this stage fail the whole install.
    if hermes_bin and hasattr(os, "openpty"):
        yield f"data: {json.dumps({'type': 'output', 'text': '▸ Falling back to: hermes setup (non-interactive, pty-driven)'})}\n\n"
        try:
            import pty as _pty
            import fcntl as _fcntl
            import select as _select_mod
            import termios as _termios

            master_fd, slave_fd = _pty.openpty()
            try:
                # Make master non-blocking so our feeder + reader don't stall
                _flags = _fcntl.fcntl(master_fd, _fcntl.F_GETFL)
                _fcntl.fcntl(master_fd, _fcntl.F_SETFL, _flags | os.O_NONBLOCK)
                try:
                    attrs = _termios.tcgetattr(slave_fd)
                    attrs[3] = attrs[3] & ~_termios.ECHO
                    _termios.tcsetattr(slave_fd, _termios.TCSANOW, attrs)
                except Exception:
                    pass

                proc = await asyncio.create_subprocess_exec(
                    hermes_bin, "setup",
                    stdin=slave_fd,
                    stdout=slave_fd,
                    stderr=slave_fd,
                    env=env,
                    start_new_session=True,
                )
                os.close(slave_fd)

                loop = asyncio.get_event_loop()
                deadline = loop.time() + 25.0
                buf = b""
                next_feed = loop.time() + 0.4
                while loop.time() < deadline:
                    if proc.returncode is not None:
                        break
                    try:
                        ready_r, _, _ = _select_mod.select([master_fd], [], [], 0.2)
                    except Exception:
                        ready_r = []
                    if ready_r:
                        try:
                            chunk = os.read(master_fd, 4096)
                        except BlockingIOError:
                            chunk = b""
                        except OSError:
                            break
                        if chunk:
                            buf += chunk
                            while b"\n" in buf:
                                line, buf = buf.split(b"\n", 1)
                                text = line.decode("utf-8", errors="replace").rstrip("\r")
                                if text:
                                    yield f"data: {json.dumps({'type': 'output', 'text': text})}\n\n"
                    # Feed Enter periodically so prompts advance
                    if loop.time() >= next_feed:
                        try:
                            os.write(master_fd, b"\n")
                        except Exception:
                            pass
                        next_feed = loop.time() + 0.5

                try:
                    proc.terminate()
                except Exception:
                    pass
                try:
                    await asyncio.wait_for(proc.wait(), timeout=3)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass
                try:
                    os.close(master_fd)
                except Exception:
                    pass
            finally:
                try:
                    os.close(slave_fd)
                except Exception:
                    pass
            yield f"data: {json.dumps({'type': 'output', 'text': 'hermes setup (pty) finished'})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'output', 'text': f'⚠ pty-driven hermes setup failed: {exc}'})}\n\n"

        # After setup, the unit may have been registered/started; try
        # systemctl enable --now once more.
        try:
            units2 = await _find_hermes_user_units(env)
        except Exception:
            units2 = []
        new_units = [u for u in units2 if u not in (units or [])]
        for unit in new_units:
            await _run_cmd(
                ["systemctl", "--user", "enable", "--now", unit],
                env=env,
                timeout_s=15,
            )
            yield f"data: {json.dumps({'type': 'output', 'text': f'enable --now {unit} (post-setup)'})}\n\n"

    if not await _wait_hermes_api_up(10.0):
        yield f"data: {json.dumps({'type': 'output', 'text': '⚠ API still not listening after all attempts. You may need to run `hermes setup` in an SSH shell to answer the interactive prompts once.'})}\n\n"


@router.post("/install-hermes")
async def install_hermes():
    """Auto-install Hermes Agent via the official install script, then
    ensure gateway (messaging) dependencies are present, and finally start
    the Hermes HTTP API listener so XSafeClaw can talk to it immediately.
    Streams SSE.

    The official installer handles: uv, Python 3.11, Node.js, ripgrep,
    ffmpeg, repo clone, venv, PATH, and initial config.

    We pass ``--skip-setup`` because the upstream ``hermes setup`` wizard is
    interactive (reads /dev/tty); when launched from the API there is no TTY
    and ``input()`` raises ``OSError: [Errno 5]``. Users can run
    ``hermes setup`` over SSH or use XSafeClaw Configure for Hermes.

    Phase 3 replaces the "users must SSH in and run hermes setup" gap with a
    non-interactive bring-up of the API listener: ``hermes gateway install``
    (documented in ``hermes --help`` — it installs a systemd user unit
    without asking any questions) followed by ``systemctl --user enable
    --now <unit>``. If that path is unavailable we fall back to driving
    ``hermes setup`` inside a ``pty`` and auto-answering every prompt with
    an empty line (default choice) + EOF — best-effort, the wizard's prompt
    set varies by version so we treat this as a safety net, not the primary
    path. Either way we finish with a ``/health`` readiness probe.
    """
    env = _build_env()

    async def generate():
        bash = shutil.which("bash")
        if not bash:
            yield f"data: {json.dumps({'type': 'error', 'message': 'bash not found. Hermes requires Linux / macOS / WSL2.'})}\n\n"
            return

        curl = shutil.which("curl")
        if not curl:
            yield f"data: {json.dumps({'type': 'error', 'message': 'curl not found. Please install curl first.'})}\n\n"
            return

        # ── Phase 1: Official install script ─────────────────────────
        yield f"data: {json.dumps({'type': 'output', 'text': '━━━ Phase 1/3: Running official Hermes installer ━━━'})}\n\n"

        # --skip-setup: upstream install.sh tries to launch "hermes setup" which
        # reads interactively from /dev/tty. Without a real TTY (API subprocess,
        # systemd, docker) input() raises OSError: [Errno 5] and the whole
        # installer exits non-zero. We always skip it and let XSafeClaw's
        # Configure/Hermes wizard handle API keys afterwards.
        install_cmd = (
            f"curl -fsSL {_HERMES_INSTALL_SCRIPT_URL} | bash -s -- --skip-setup"
        )
        yield f"data: {json.dumps({'type': 'output', 'text': f'▸ Running: {install_cmd}'})}\n\n"
        try:
            proc = await asyncio.create_subprocess_shell(
                install_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                stdin=asyncio.subprocess.DEVNULL,
                env=env,
            )
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").rstrip()
                if text:
                    yield f"data: {json.dumps({'type': 'output', 'text': text})}\n\n"
            await proc.wait()
            rc = proc.returncode
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': f'Install script failed: {exc}'})}\n\n"
            return

        if rc != 0:
            yield f"data: {json.dumps({'type': 'done', 'success': False, 'exit_code': rc})}\n\n"
            return

        yield f"data: {json.dumps({'type': 'output', 'text': 'ℹ Skipped interactive setup wizard (--skip-setup). Configure API keys via XSafeClaw, or run `hermes setup` in an SSH shell.'})}\n\n"

        # ── Phase 2: Ensure gateway / messaging extras ───────────────
        yield f"data: {json.dumps({'type': 'output', 'text': ''})}\n\n"
        yield f"data: {json.dumps({'type': 'output', 'text': '━━━ Phase 2/3: Installing gateway dependencies ━━━'})}\n\n"

        hermes_repo = _hermes_repo_dir()
        venv_pip = hermes_repo / "venv" / "bin" / "pip"
        uv_bin = shutil.which("uv")

        if uv_bin and hermes_repo.is_dir():
            pip_env = {**env, "VIRTUAL_ENV": str(hermes_repo / "venv")}
            gateway_cmd = [
                uv_bin, "pip", "install", "-e", ".[messaging,cron,cli,pty,mcp]",
            ]
            yield f"data: {json.dumps({'type': 'output', 'text': f'▸ Running: uv pip install -e \".[messaging,cron,cli,pty,mcp]\"'})}\n\n"
            try:
                proc2 = await asyncio.create_subprocess_exec(
                    *gateway_cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    stdin=asyncio.subprocess.DEVNULL,
                    env=pip_env,
                    cwd=str(hermes_repo),
                )
                while True:
                    line = await proc2.stdout.readline()
                    if not line:
                        break
                    text = line.decode("utf-8", errors="replace").rstrip()
                    if text:
                        yield f"data: {json.dumps({'type': 'output', 'text': text})}\n\n"
                await proc2.wait()
                if proc2.returncode != 0:
                    yield f"data: {json.dumps({'type': 'output', 'text': f'⚠ Gateway extras exited with code {proc2.returncode} (non-fatal)'})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'output', 'text': '✓ Gateway dependencies installed'})}\n\n"
            except Exception as exc:
                yield f"data: {json.dumps({'type': 'output', 'text': f'⚠ Gateway extras install error: {exc} (non-fatal)'})}\n\n"
        elif venv_pip.is_file():
            yield f"data: {json.dumps({'type': 'output', 'text': '▸ uv not found, using venv pip for gateway extras'})}\n\n"
            try:
                proc2 = await asyncio.create_subprocess_exec(
                    str(venv_pip), "install", "-e", ".[messaging,cron,cli,pty,mcp]",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    stdin=asyncio.subprocess.DEVNULL,
                    env=env,
                    cwd=str(hermes_repo),
                )
                while True:
                    line = await proc2.stdout.readline()
                    if not line:
                        break
                    text = line.decode("utf-8", errors="replace").rstrip()
                    if text:
                        yield f"data: {json.dumps({'type': 'output', 'text': text})}\n\n"
                await proc2.wait()
                if proc2.returncode != 0:
                    yield f"data: {json.dumps({'type': 'output', 'text': f'⚠ Gateway extras exited with code {proc2.returncode} (non-fatal)'})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'output', 'text': '✓ Gateway dependencies installed'})}\n\n"
            except Exception as exc:
                yield f"data: {json.dumps({'type': 'output', 'text': f'⚠ Gateway extras install error: {exc} (non-fatal)'})}\n\n"
        else:
            yield f"data: {json.dumps({'type': 'output', 'text': '⚠ Could not locate hermes-agent repo or venv; skipping gateway extras. You can install manually: cd ~/.hermes/hermes-agent && uv pip install -e \".[messaging,cron,cli,pty,mcp]\"'})}\n\n"

        # ── Phase 3: Non-interactive API bring-up ─────────────────────
        # Goal: have 127.0.0.1:<hermes_api_port>/health return 200 by the
        # time this SSE stream ends, so XSafeClaw's Setup page can skip to
        # Configure and the user never has to SSH in.
        #
        # Strategy (fall through on failure):
        #   a) `hermes gateway install` — documented in upstream help; it's
        #      the non-interactive way to register + start the systemd user
        #      unit that owns the HTTP listener.
        #   b) Enumerate `systemctl --user` units named *hermes* and run
        #      `systemctl --user enable --now <unit>` on each.
        #   c) Best-effort: drive `hermes setup` inside a pty and feed
        #      blank lines + EOF (equivalent to pressing Enter at every
        #      prompt → default choice). Brittle across versions but a
        #      useful last resort.
        yield f"data: {json.dumps({'type': 'output', 'text': ''})}\n\n"
        yield f"data: {json.dumps({'type': 'output', 'text': '━━━ Phase 3/3: Starting Hermes API listener ━━━'})}\n\n"

        async for line in _hermes_bring_up_api(env):
            yield line

        # Final readiness check — we announce `done` regardless of API
        # readiness because the install itself succeeded; the frontend will
        # still refresh status and show whether /health came up.
        if await _hermes_api_reachable():
            yield f"data: {json.dumps({'type': 'output', 'text': f'✓ Hermes API is listening on 127.0.0.1:{settings.hermes_api_port}'})}\n\n"
        else:
            yield f"data: {json.dumps({'type': 'output', 'text': f'⚠ Hermes API is not yet reachable on 127.0.0.1:{settings.hermes_api_port}. Try: `systemctl --user status hermes-*.service`, or start it manually via `hermes gateway`.'})}\n\n"

        yield f"data: {json.dumps({'type': 'done', 'success': True})}\n\n"
        trigger_onboard_scan_preload()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ──────────────────────────────────────────────
# Config reset
# ──────────────────────────────────────────────

class ConfigResetRequest(BaseModel):
    scope: str = "config"
    workspace: str = "~/.openclaw/workspace"


@router.post("/config-reset")
async def config_reset(body: ConfigResetRequest):
    """Reset OpenClaw configuration. Mirrors the source's handleReset logic."""
    deleted: list[str] = []

    if _CONFIG_PATH.exists():
        _CONFIG_PATH.unlink()
        deleted.append(str(_CONFIG_PATH))
    if _EXPLICIT_MODELS_PATH.exists():
        _EXPLICIT_MODELS_PATH.unlink()
        deleted.append(str(_EXPLICIT_MODELS_PATH))

    if body.scope in ("config+creds+sessions", "full"):
        for p in [
            _OPENCLAW_DIR / "credentials",
            _OPENCLAW_DIR / "agents" / "main" / "sessions",
        ]:
            if p.exists():
                shutil.rmtree(str(p))
                deleted.append(str(p))
        auth_p = _OPENCLAW_DIR / "agents" / "main" / "agent" / "auth-profiles.json"
        if auth_p.exists():
            auth_p.unlink()
            deleted.append(str(auth_p))

    if body.scope == "full":
        wp = Path(body.workspace).expanduser()
        if wp.exists():
            shutil.rmtree(str(wp))
            deleted.append(str(wp))

    return {"success": True, "deleted": deleted}


# ──────────────────────────────────────────────
# Onboard  (openclaw onboard --install-daemon)
# Uses a PTY so @clack/prompts gets a real TTY
# ──────────────────────────────────────────────

class OnboardStartResponse(BaseModel):
    proc_id: str


@router.post("/onboard/start", response_model=OnboardStartResponse)
async def onboard_start():
    """
    Launch  `openclaw onboard --install-daemon`  via a PTY so that interactive
    TUI prompts (e.g. @clack/prompts) work properly.

    Returns a proc_id.
      GET /onboard/{proc_id}/stream  → SSE stream of output
      POST /onboard/{proc_id}/input  → send a keystroke / text to the process
    """
    proc_id = str(uuid.uuid4())
    env = _build_env()
    openclaw_path = _find_openclaw() or "openclaw"

    master_fd: int | None = None
    stdin_stream = None

    if _pty_supported():
        # Unix/macOS: keep the existing PTY flow so clack prompts behave normally.
        master_fd, slave_fd = os.openpty()
        _set_pty_size(slave_fd, 50, 220)

        proc = await asyncio.create_subprocess_exec(
            openclaw_path, "onboard", "--install-daemon",
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            env=env,
            close_fds=True,
        )
        os.close(slave_fd)
    else:
        # Windows fallback: use regular pipes so the API can still start and
        # attempt interactive onboarding without importing Unix-only modules.
        proc = await asyncio.create_subprocess_exec(
            openclaw_path, "onboard", "--install-daemon",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
        )
        stdin_stream = proc.stdin

    queue: asyncio.Queue = asyncio.Queue()
    _procs[proc_id] = {
        "proc":      proc,
        "master_fd": master_fd,
        "stdin":     stdin_stream,
        "queue":     queue,
        "done":      False,
    }

    # ── Background reader: state-machine that classifies @clack/prompts output ──
    #
    # @clack/prompts renders ALL interactive prompts with the same box-drawing
    # pattern, so one generic state machine handles every prompt type:
    #
    #  ◆/◇  Question text           → save question, emit output
    #  │   ○ Yes / ● No             → prompt_confirm  (Yes/No on same line)
    #  │   ● Option A               → accumulate option (select prompt)
    #  │   ○ Option B               → accumulate option
    #  │   ›  _                     → prompt_text      (free-text input)
    #  └                            → flush pending select → prompt_select
    #
    # The frontend only needs to handle three event types:
    #   prompt_confirm  → Yes / No buttons
    #   prompt_select   → radio-button list
    #   prompt_text     → text input box
    #
    async def _reader():
        loop = asyncio.get_event_loop()
        buf            = ""
        last_question  = ""          # ◆/◇ question text
        last_confirm_q = ""          # last confirm prompt sent, to avoid duplicates
        pending_opts: list[dict] = []  # accumulated options for select/multiselect
        pending_type   = "prompt_select"    # "prompt_select" | "prompt_multiselect"
        saw_multiselect = False      # True if any ◻/□ option was seen for current question

        def _flush_select():
            nonlocal pending_opts, pending_type, saw_multiselect
            if pending_opts:
                actual_type = "prompt_multiselect" if saw_multiselect else pending_type
                queue.put_nowait(json.dumps({
                    "type":    actual_type,
                    "text":    last_question,
                    "options": pending_opts,
                }))
                pending_opts = []
                saw_multiselect = False

        def _process_line(raw_line: str):
            nonlocal last_question, last_confirm_q, pending_opts, saw_multiselect
            line = raw_line.strip()
            if not line:
                return
            lower = line.lower()

            # ── Split merged lines (clack sometimes outputs "│  ● Yes / ○ No◇  Question") ──
            # If a ◆/◇ appears mid-line, split and process each part separately.
            split_match = re.search(r'(?<=\S)[◆◇]', line)
            if split_match:
                _process_line(line[:split_match.start()])
                _process_line(line[split_match.start():])
                return

            lower = line.lower()

            # ── ◆/◇  prompt question header ──────────────────────────────
            if line[0] in "◆◇":
                _flush_select()
                saw_multiselect = False
                q = re.sub(r"^[◆◇\s│]+", "", line).strip()
                if q:
                    last_question = q
                # Always emit the line as output (shows in terminal log)
                queue.put_nowait(json.dumps({"type": "output", "text": line}))
                # If the question itself is asking for text input
                # (e.g. "Enter Moonshot API key (.cn)"), emit prompt_text now
                # so the frontend shows the input box immediately.
                if q and _is_text_input_question(q):
                    queue.put_nowait(json.dumps({
                        "type": "prompt_text",
                        "text": q,
                    }))
                return
            if line.startswith("└"):
                _flush_select()
                # Don't emit the box-drawing character
                return

            # ── "? question" — clack NO_COLOR fallback rendering ────────
            # When NO_COLOR=1, clack renders "? Question text" without ◆
            # 注意：不要在这里调 _flush_select()，避免打断正在积累的选项
            if re.match(r"^\?\s+\S", line):
                q = re.sub(r"^\?\s*", "", line).strip()
                if q:
                    last_question = q
                queue.put_nowait(json.dumps({"type": "output", "text": line}))
                if q and _is_text_input_question(q):
                    queue.put_nowait(json.dumps({"type": "prompt_text", "text": q}))
                # 不在这里发 prompt_confirm，confirm 由 "○ Yes / ● No" 模式处理
                return

            # ── Lines inside the prompt box (start with │ or ├) ─────────
            content = re.sub(r"^[│├]\s*", "", line).strip()

            # confirm: "○ Yes / ● No"  (both options on ONE line with " / ")
            if (
                ("○" in content or "●" in content)
                and "yes" in lower and "no" in lower
                and "/" in content
            ):
                _flush_select()
                # Detect which option is currently highlighted (●)
                # Pattern: "● Yes / ○ No" → yes_selected=True
                #          "○ Yes / ● No" → yes_selected=False
                yes_selected = bool(re.search(r"●\s*yes", content, re.IGNORECASE))
                confirm_text = last_question or content
                if confirm_text != last_confirm_q:
                    last_confirm_q = confirm_text
                    queue.put_nowait(json.dumps({
                        "type": "prompt_confirm",
                        "text": confirm_text,
                        "yes_default": yes_selected,
                    }))
                return

            # single-select option: ○ or ● (not the Yes/No pair on one line)
            if re.match(r"^[○●]\s+\S", content):
                is_selected = content.startswith("●")
                label = re.sub(r"^[○●]\s+", "", content).strip()
                if label:
                    pending_type = "prompt_select"
                    pending_opts.append({"label": label, "selected": is_selected})
                return

            # multi-select option: □/☐/◻ (unselected) or ■/◼/▪/☑ (selected)
            if content and content[0] not in "○●" and re.match(r"^[□■▪▸☐◻◼☑☒▢▣⬜⬛]\s*\S", content):
                is_checked = content[0] in "■▪◼☑"
                label = re.sub(r"^[□■▪▸☐◻◼☑☒▢▣⬜⬛]\s*", "", content).strip()
                if label:
                    pending_type = "prompt_multiselect"
                    saw_multiselect = True
                    pending_opts.append({"label": label, "selected": is_checked})
                return

            # text-input prompt: clack uses "›" as the cursor
            if content.startswith("›") or _is_text_prompt(content):
                _flush_select()
                queue.put_nowait(json.dumps({
                    "type": "prompt_text",
                    "text": last_question or content,
                }))
                return

            # fallback: bare lines (no box chars) that ask for text input
            # e.g. clack outputs "Enter Moonshot API key (.cn)" without ◆ prefix
            if _is_text_input_question(content or line):
                _flush_select()
                if content or line != last_question:  # avoid duplicate prompt
                    last_question = content or line
                queue.put_nowait(json.dumps({"type": "output", "text": line}))
                queue.put_nowait(json.dumps({
                    "type": "prompt_text",
                    "text": content or line,
                }))
                return

            # everything else inside box → regular output
            if content:
                queue.put_nowait(json.dumps({"type": "output", "text": line}))

        # ── Raw byte reader ───────────────────────────────────────────────
        # Unix/macOS keeps the PTY reader thread. Windows falls back to
        # reading process stdout directly.
        loop = asyncio.get_event_loop()
        raw_queue: asyncio.Queue = asyncio.Queue()
        stop_evt = threading.Event()

        if master_fd is not None:
            def _pty_reader_thread():
                try:
                    while not stop_evt.is_set():
                        try:
                            r, _, _ = _select.select([master_fd], [], [master_fd], 0.5)
                        except (OSError, ValueError):
                            break
                        if r:
                            try:
                                data = os.read(master_fd, 4096)
                                loop.call_soon_threadsafe(raw_queue.put_nowait, data)
                            except OSError:
                                break
                        elif proc.returncode is not None:
                            break
                finally:
                    loop.call_soon_threadsafe(raw_queue.put_nowait, None)

            threading.Thread(target=_pty_reader_thread, daemon=True).start()
        else:
            async def _pipe_reader():
                try:
                    stdout = proc.stdout
                    if stdout is None:
                        return
                    while True:
                        data = await stdout.read(4096)
                        if not data:
                            break
                        await raw_queue.put(data)
                finally:
                    await raw_queue.put(None)

            asyncio.create_task(_pipe_reader())

        try:
            while True:
                try:
                    data = await asyncio.wait_for(raw_queue.get(), timeout=2.0)
                except asyncio.TimeoutError:
                    # 2秒没新数据，选项肯定到齐了，flush
                    if pending_opts:
                        _flush_select()
                    continue
                if data is None:
                    break

                text = _strip_ansi(data.decode("utf-8", errors="replace"))
                buf += text

                # 处理完整行
                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    _process_line(line)

                # 处理没有换行符的 partial line（选项行、└）
                s = buf.strip()
                if s and (
                    s.startswith("└")
                    or re.match(r"^[│├]?\s*[□■▪◻◼☐☑]", s)
                ):
                    _process_line(s)
                    buf = ""

        except Exception as exc:
            queue.put_nowait(json.dumps({"type": "error", "message": str(exc)}))
        finally:
            stop_evt.set()
            if buf.strip():
                _process_line(buf.strip())
            _flush_select()
            await proc.wait()
            if master_fd is not None:
                try:
                    os.close(master_fd)
                except OSError:
                    pass
            _procs[proc_id]["done"] = True
            queue.put_nowait(json.dumps({
                "type":      "done",
                "success":   proc.returncode == 0,
                "exit_code": proc.returncode,
            }))

    asyncio.create_task(_reader())
    return OnboardStartResponse(proc_id=proc_id)


@router.get("/onboard/{proc_id}/stream")
async def onboard_stream(proc_id: str):
    """SSE stream of classified onboard process output."""
    if proc_id not in _procs:
        raise HTTPException(status_code=404, detail="Process not found")

    entry = _procs[proc_id]

    async def generate():
        while True:
            try:
                msg = await asyncio.wait_for(entry["queue"].get(), timeout=1.0)
                yield f"data: {msg}\n\n"
                parsed = json.loads(msg)
                if parsed.get("type") in ("done", "error"):
                    _procs.pop(proc_id, None)
                    break
            except asyncio.TimeoutError:
                if entry.get("done"):
                    break
                yield ": keep-alive\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class OnboardInputRequest(BaseModel):
    """
    Generic PTY input request.

    Special keyword values (case-insensitive):
      YES          → b"y\\r"         confirm yes
      NO           → b"n\\r"         confirm no
      ENTER        → b"\\r"          press Enter (accept current selection)
      DOWN:N       → N×↓ + Enter     move down N options, then confirm
      UP:N         → N×↑ + Enter     move up N options, then confirm
    Anything else  → text + "\\r"    free-text input
    """
    text: str


_ARROW_DOWN = b"\x1b[B"
_ARROW_UP   = b"\x1b[A"


@router.post("/onboard/{proc_id}/input")
async def onboard_input(proc_id: str, body: OnboardInputRequest):
    if proc_id not in _procs:
        raise HTTPException(status_code=404, detail="Process not found")

    mfd = _procs[proc_id].get("master_fd")
    stdin_stream = _procs[proc_id].get("stdin")
    if mfd is None and stdin_stream is None:
        raise HTTPException(status_code=400, detail="PTY not available")

    t     = body.text.strip()
    upper = t.upper()

    if upper == "YES":
        payload = b"y\r"
    elif upper == "NO":
        payload = b"n\r"
    elif upper == "ENTER":
        payload = b"\r"
    elif upper.startswith("DOWN:"):
        n = max(1, int(upper.split(":")[1]))
        payload = _ARROW_DOWN * n + b"\r"
    elif upper.startswith("UP:"):
        n = max(1, int(upper.split(":")[1]))
        payload = _ARROW_UP * n + b"\r"
    elif upper.startswith("MULTISELECT:"):
        # MULTISELECT:0,2,4  – navigate top-to-bottom, space-toggle selected indices
        raw_indices = upper[len("MULTISELECT:"):]
        selected = set(int(x) for x in raw_indices.split(",") if x.strip().isdigit()) if raw_indices.strip() else set()
        # Build sequence: for each row walk down from previous cursor pos, toggle if selected
        seq = b""
        prev = 0
        for idx in sorted(selected):
            downs = idx - prev
            if downs > 0:
                seq += _ARROW_DOWN * downs
            seq += b" "   # Space toggles current item
            prev = idx
        seq += b"\r"      # Enter to confirm
        payload = seq
    else:
        payload = (t + "\r").encode()

    try:
        if mfd is not None:
            os.write(mfd, payload)
        else:
            stdin_stream.write(payload)
            await stdin_stream.drain()
        return {"ok": True, "sent": repr(payload)}
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ──────────────────────────────────────────────
# Provider / Model registry
# ──────────────────────────────────────────────

PROVIDERS: list[dict] = [
    {
        "id": "moonshot",
        "name": "Moonshot AI (Kimi)",
        "baseUrl": "https://api.moonshot.cn/v1",
        "api": "openai-completions",
        "keyUrl": "https://platform.moonshot.cn/console/api-keys",
        "models": [
            {"id": "kimi-k2.5", "name": "Kimi K2.5", "reasoning": False},
            {"id": "moonshot-v1-auto", "name": "Moonshot V1 Auto", "reasoning": False},
        ],
    },
    {
        "id": "openai",
        "name": "OpenAI",
        "baseUrl": "https://api.openai.com/v1",
        "api": "openai-completions",
        "keyUrl": "https://platform.openai.com/api-keys",
        "models": [
            {"id": "gpt-4o", "name": "GPT-4o", "reasoning": False},
            {"id": "gpt-4o-mini", "name": "GPT-4o Mini", "reasoning": False},
            {"id": "o3-mini", "name": "o3-mini", "reasoning": True},
        ],
    },
    {
        "id": "anthropic",
        "name": "Anthropic",
        "baseUrl": "https://api.anthropic.com",
        "api": "anthropic-messages",
        "keyUrl": "https://console.anthropic.com/settings/keys",
        "models": [
            {"id": "claude-sonnet-4-5-20250514", "name": "Claude Sonnet 4.5", "reasoning": False},
            {"id": "claude-opus-4-20250514", "name": "Claude Opus 4", "reasoning": False},
        ],
    },
    {
        "id": "google",
        "name": "Google AI",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "api": "google-generative-ai",
        "keyUrl": "https://aistudio.google.com/apikey",
        "models": [
            {"id": "gemini-2.5-flash-preview-05-20", "name": "Gemini 2.5 Flash", "reasoning": False},
            {"id": "gemini-2.5-pro-preview-05-06", "name": "Gemini 2.5 Pro", "reasoning": True},
        ],
    },
    {
        "id": "minimax",
        "name": "MiniMax",
        "baseUrl": "https://api.minimax.chat/v1",
        "api": "openai-completions",
        "keyUrl": "https://platform.minimaxi.com/user-center/basic-information/interface-key",
        "models": [
            {"id": "MiniMax-M1", "name": "MiniMax M1", "reasoning": True},
        ],
    },
    {
        "id": "qwen-portal",
        "name": "Qwen (Tongyi)",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "api": "openai-completions",
        "keyUrl": "https://bailian.console.aliyun.com/?apiKey=1",
        "models": [
            {"id": "qwen-max", "name": "Qwen Max", "reasoning": False},
            {"id": "qwen-plus", "name": "Qwen Plus", "reasoning": False},
        ],
    },
    {
        "id": "deepseek",
        "name": "DeepSeek",
        "baseUrl": "https://api.deepseek.com/v1",
        "api": "openai-completions",
        "keyUrl": "https://platform.deepseek.com/api_keys",
        "models": [
            {"id": "deepseek-chat", "name": "DeepSeek V3", "reasoning": False},
            {"id": "deepseek-reasoner", "name": "DeepSeek R1", "reasoning": True},
        ],
    },
    {
        "id": "ollama",
        "name": "Ollama (Local)",
        "baseUrl": "http://127.0.0.1:11434/v1",
        "api": "openai-completions",
        "keyUrl": "",
        "models": [
            {"id": "llama3.1", "name": "Llama 3.1", "reasoning": False},
            {"id": "qwen2.5", "name": "Qwen 2.5", "reasoning": False},
        ],
    },
    {
        "id": "openrouter",
        "name": "OpenRouter",
        "baseUrl": "https://openrouter.ai/api/v1",
        "api": "openai-completions",
        "keyUrl": "https://openrouter.ai/keys",
        "models": [
            {"id": "openai/gpt-4o", "name": "GPT-4o (via OpenRouter)", "reasoning": False},
            {"id": "anthropic/claude-sonnet-4-5", "name": "Claude Sonnet 4.5 (via OpenRouter)", "reasoning": False},
        ],
    },
]

AVAILABLE_HOOKS = [
    {"id": "session-memory", "name": "Session Memory", "description": "Save session context to memory on /new or /reset"},
    {"id": "boot-md", "name": "Boot MD", "description": "Execute BOOT.md on gateway startup"},
    {"id": "command-logger", "name": "Command Logger", "description": "Log all commands to ~/.openclaw/logs/commands.log"},
    {"id": "bootstrap-extra-files", "name": "Bootstrap Extra Files", "description": "Include extra files during agent bootstrap"},
]

AVAILABLE_CHANNELS = [
    {"id": "feishu", "name": "Feishu/Lark"},
    {"id": "telegram", "name": "Telegram (Bot API)"},
    {"id": "whatsapp", "name": "WhatsApp (QR link)"},
    {"id": "discord", "name": "Discord (Bot API)"},
    {"id": "slack", "name": "Slack (Socket Mode)"},
    {"id": "signal", "name": "Signal (signal-cli)"},
    {"id": "googlechat", "name": "Google Chat (Chat API)"},
    {"id": "imessage", "name": "iMessage (imsg)"},
    {"id": "irc", "name": "IRC (Server + Nick)"},
    {"id": "line", "name": "LINE (Messaging API)"},
    {"id": "nostr", "name": "Nostr (NIP-04 DMs)"},
    {"id": "msteams", "name": "Microsoft Teams (Bot Framework)"},
    {"id": "mattermost", "name": "Mattermost"},
    {"id": "nextcloud", "name": "Nextcloud Talk (self-hosted)"},
    {"id": "matrix", "name": "Matrix"},
    {"id": "bluebubbles", "name": "BlueBubbles (macOS app)"},
    {"id": "zalo-bot", "name": "Zalo (Bot API)"},
    {"id": "zalo-personal", "name": "Zalo (Personal Account)"},
    {"id": "synology", "name": "Synology Chat (Webhook)"},
    {"id": "tlon", "name": "Tlon (Urbit)"},
]

_OPENCLAW_DIR = Path.home() / ".openclaw"
_HERMES_DIR = settings.hermes_home

if settings.is_hermes:
    _CONFIG_PATH = settings.hermes_config_path
    _EXPLICIT_MODELS_PATH = _HERMES_DIR / "xsafeclaw-explicit-models.json"
else:
    _CONFIG_PATH = _OPENCLAW_DIR / "openclaw.json"
    _EXPLICIT_MODELS_PATH = _OPENCLAW_DIR / "xsafeclaw-explicit-models.json"

# ── Hermes model / provider catalog ──────────────────────────────────────────
# Static catalog derived from Hermes's official provider documentation.
# Env-var names and representative models for each provider.

# Provider *shell* registry for Hermes — NO model ids.
#
# This table intentionally carries only identity/UX metadata (id, display
# name, hint, envKey).  Model lists are authoritatively owned by Hermes
# itself and fetched at runtime by ``_fetch_hermes_catalog_live()``; writing
# ids here invites the exact kind of drift that caused the ``Model Not
# Exist`` / ``[No response]`` regressions (OpenRouter's
# ``anthropic/claude-sonnet-4-20250514`` was Anthropic's snapshot naming,
# not OpenRouter's; ``alibaba/*`` mixed coding-intl and standard DashScope
# naming; etc.).
#
# Two downstream consumers still need this shell:
#   • ``_HERMES_AUTH_PROVIDERS`` — drives the Configure wizard's auth-step UI
#   • ``_HERMES_PROVIDER_ENV_KEYS`` — tells ``_quick_model_config_hermes``
#     which env var receives the API key the user just typed in
_HERMES_MODEL_CATALOG: list[dict] = [
    {"id": "anthropic",      "name": "Anthropic",                         "hint": "Claude models (API key or Claude Code auth)",          "envKey": "ANTHROPIC_API_KEY",      "models": []},
    {"id": "openai",         "name": "OpenAI",                            "hint": "GPT / o-series models",                                "envKey": "OPENAI_API_KEY",         "models": []},
    {"id": "openrouter",     "name": "OpenRouter",                        "hint": "200+ models via single API key",                       "envKey": "OPENROUTER_API_KEY",     "models": []},
    {"id": "gemini",         "name": "Google Gemini",                     "hint": "Gemini API key",                                       "envKey": "GOOGLE_API_KEY",         "models": []},
    {"id": "deepseek",       "name": "DeepSeek",                          "hint": "DeepSeek API",                                         "envKey": "DEEPSEEK_API_KEY",       "models": []},
    {"id": "alibaba",        "name": "Alibaba Cloud (DashScope / Qwen)",  "hint": "Qwen models",                                          "envKey": "DASHSCOPE_API_KEY",      "models": []},
    {"id": "zai",            "name": "Z.AI / ZhipuAI (GLM)",              "hint": "GLM models",                                           "envKey": "GLM_API_KEY",            "models": []},
    {"id": "kimi-coding",    "name": "Kimi / Moonshot",                   "hint": "Kimi models (international)",                          "envKey": "KIMI_API_KEY",           "models": []},
    {"id": "kimi-coding-cn", "name": "Kimi / Moonshot (China)",           "hint": "Kimi models (China endpoint)",                         "envKey": "KIMI_CN_API_KEY",        "models": []},
    {"id": "minimax",        "name": "MiniMax",                           "hint": "MiniMax models (global)",                              "envKey": "MINIMAX_API_KEY",        "models": []},
    {"id": "minimax-cn",     "name": "MiniMax (China)",                   "hint": "MiniMax models (China endpoint)",                      "envKey": "MINIMAX_CN_API_KEY",     "models": []},
    {"id": "xiaomi",         "name": "Xiaomi MiMo",                       "hint": "Xiaomi MiMo models",                                   "envKey": "XIAOMI_API_KEY",         "models": []},
    {"id": "arcee",          "name": "Arcee AI",                          "hint": "Trinity models",                                       "envKey": "ARCEEAI_API_KEY",        "models": []},
    {"id": "huggingface",    "name": "Hugging Face",                      "hint": "Inference Providers (20+ open models)",                "envKey": "HF_TOKEN",               "models": []},
    {"id": "copilot",        "name": "GitHub Copilot",                    "hint": "Uses Copilot subscription (OAuth)",                    "envKey": "",                       "models": []},
    {"id": "kilocode",       "name": "Kilo Code",                         "hint": "Kilo Code API",                                        "envKey": "KILOCODE_API_KEY",       "models": []},
    {"id": "opencode-zen",   "name": "OpenCode Zen",                      "hint": "OpenCode Zen API",                                     "envKey": "OPENCODE_ZEN_API_KEY",   "models": []},
    {"id": "opencode-go",    "name": "OpenCode Go",                       "hint": "OpenCode Go API",                                      "envKey": "OPENCODE_GO_API_KEY",    "models": []},
    {"id": "mistral",        "name": "Mistral AI",                        "hint": "Mistral API",                                          "envKey": "MISTRAL_API_KEY",        "models": []},
    {"id": "xai",            "name": "xAI (Grok)",                        "hint": "xAI Grok models",                                      "envKey": "XAI_API_KEY",            "models": []},
    {"id": "ai-gateway",     "name": "AI Gateway (Vercel)",               "hint": "Vercel AI Gateway",                                    "envKey": "AI_GATEWAY_API_KEY",     "models": []},
    {"id": "custom",         "name": "Custom Endpoint",                   "hint": "Any OpenAI-compatible endpoint (Ollama, vLLM, etc.)",  "envKey": "",                       "models": []},
]

_HERMES_AUTH_PROVIDERS: list[dict] = [
    {
        "id": prov["id"],
        "name": prov["name"],
        "hint": prov["hint"],
        "supported": True,
        "methods": [{"id": f"{prov['id']}-api-key", "label": f"{prov['name']} API key"}],
    }
    for prov in _HERMES_MODEL_CATALOG
    if prov["id"] not in ("custom", "copilot")
] + [
    {
        "id": "copilot",
        "name": "GitHub Copilot",
        "hint": "OAuth device code flow",
        "supported": False,
        "methods": [{"id": "copilot-oauth", "label": "GitHub OAuth (run hermes model)"}],
    },
    {
        "id": "custom",
        "name": "Custom Endpoint",
        "hint": "Any OpenAI-compatible endpoint (Ollama, vLLM, etc.)",
        "supported": True,
        "methods": [{"id": "custom-api-key", "label": "Custom provider"}],
    },
]

# Map Hermes provider id → env var name for writing API keys
_HERMES_PROVIDER_ENV_KEYS: dict[str, str] = {
    prov["id"]: prov["envKey"]
    for prov in _HERMES_MODEL_CATALOG
    if prov.get("envKey")
}

# ── DashScope endpoint presets ───────────────────────────────────────────────
# Hermes's ``alibaba`` adapter hardcodes its default to the Alibaba *Coding
# Plan* endpoint (``coding-intl.dashscope.aliyuncs.com/v1``), which rejects
# standard DashScope API keys with HTTP 401 / ``Model Not Exist``.  Because
# Hermes silently swallows adapter-side exceptions in the gateway the user
# sees this as ``[No response]`` in the UI — the same class of trap §30 fixed
# for OpenRouter/Nous, just dressed differently.
#
# We surface the three realistic endpoints so the Configure wizard and the
# agent-town ``create agent`` modal can let users pick the one that matches
# the key they pasted in.  The id is frontend-facing only; the authoritative
# value is ``base_url``, which we upsert into ``~/.hermes/.env`` as
# ``DASHSCOPE_BASE_URL``.  Hermes honours that env var at provider
# construction time (see docs/reference/environment-variables) so no
# ``config.yaml`` model-level override is needed.
_HERMES_DASHSCOPE_ENDPOINTS: list[dict] = [
    {
        "id": "dashscope-intl",
        "label": "DashScope (International, recommended)",
        "hint": "Standard DashScope OpenAI-compatible endpoint. Works with keys from bailian.console.aliyun.com or dashscope.console.aliyun.com.",
        "base_url": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    },
    {
        "id": "dashscope-cn",
        "label": "DashScope (Mainland China)",
        "hint": "Mainland China DashScope endpoint. Use this only if your key is bound to the China region.",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
    {
        "id": "coding-intl",
        "label": "Alibaba Coding Plan (Hermes default)",
        "hint": "Only for users with an Alibaba Coding Plan subscription — standard DashScope keys will get 401 here.",
        "base_url": "https://coding-intl.dashscope.aliyuncs.com/v1",
    },
]

# The env var Hermes reads to override the alibaba adapter's hardcoded
# base URL.  Kept as a module-level constant so downstream refactors don't
# drift from the dotenv key name.
_HERMES_DASHSCOPE_BASE_URL_ENV = "DASHSCOPE_BASE_URL"


def _current_hermes_dashscope_base_url() -> str:
    """Return the ``DASHSCOPE_BASE_URL`` currently persisted in ~/.hermes/.env.

    Empty string when the file doesn't exist or the variable is unset.  The
    Configure UI uses this to pre-select whatever endpoint the user last
    picked (or manually edited), so re-saving the ``alibaba`` provider
    without touching the dropdown doesn't silently clobber their choice.
    """
    try:
        return _read_dotenv_value(_hermes_env_path(), _HERMES_DASHSCOPE_BASE_URL_ENV).strip()
    except Exception:
        return ""


# ── Dynamic auth-provider scanning ───────────────────────────────────────────
# Reads each extension's openclaw.plugin.json at runtime so the provider list
# stays in sync across OpenClaw upgrades without manual copy-paste.

_EXTRA_STATIC_PROVIDERS: list[dict] = [
    {"id": "custom", "name": "Custom Provider", "hint": "Any OpenAI/Anthropic-compatible endpoint", "supported": True, "methods": [
        {"id": "custom-api-key", "label": "Custom provider"},
    ]},
    {"id": "skip", "name": "Skip for now", "hint": "", "supported": True},
]

_FALLBACK_AUTH_PROVIDERS: list[dict] = [
    {"id": "moonshot", "name": "Moonshot AI (Kimi K2.5)", "hint": "Kimi K2.5", "supported": True, "methods": [
        {"id": "moonshot-api-key", "label": "Moonshot API key (.ai)", "modelProviders": ["moonshot"]},
        {"id": "moonshot-api-key-cn", "label": "Moonshot API key (.cn)", "modelProviders": ["moonshot"]},
        {"id": "kimi-code-api-key", "label": "Kimi Code API key", "modelProviders": ["kimi-coding"]},
    ]},
    {"id": "anthropic", "name": "Anthropic", "hint": "API key", "supported": True, "methods": [
        {"id": "apiKey", "label": "Anthropic API key"},
    ]},
    {"id": "openai", "name": "OpenAI", "hint": "API key", "supported": True, "methods": [
        {"id": "openai-api-key", "label": "OpenAI API key"},
    ]},
    {"id": "google", "name": "Google", "hint": "Gemini API key", "supported": True, "methods": [
        {"id": "gemini-api-key", "label": "Gemini API key"},
    ]},
    *_EXTRA_STATIC_PROVIDERS,
]

_FALLBACK_CLI_FLAGS: dict[str, str] = {
    "apiKey": "--anthropic-api-key",
    "openai-api-key": "--openai-api-key",
    "moonshot-api-key": "--moonshot-api-key",
    "moonshot-api-key-cn": "--moonshot-api-key",
    "kimi-code-api-key": "--kimi-code-api-key",
    "gemini-api-key": "--gemini-api-key",
}

# Cache: (openclaw_version, auth_providers, cli_flags)
_provider_cache: dict[str, tuple[list[dict], dict[str, str]]] = {}


def _find_extensions_dir() -> Optional[Path]:
    """Locate the openclaw extensions directory from the binary path."""
    openclaw_path = _find_openclaw()
    if not openclaw_path:
        return None
    bin_path = Path(openclaw_path).resolve()
    # Binary is at <prefix>/bin/openclaw or <prefix>/openclaw
    # Extensions are at <prefix>/lib/node_modules/openclaw/dist/extensions/
    for ancestor in bin_path.parents:
        candidate = ancestor / "lib" / "node_modules" / "openclaw" / "dist" / "extensions"
        if candidate.is_dir():
            return candidate
    # Also try: binary might be a symlink pointing into node_modules
    try:
        real = Path(os.readlink(openclaw_path)).resolve()
        for ancestor in real.parents:
            candidate = ancestor / "extensions"
            if candidate.is_dir() and (candidate / "anthropic").is_dir():
                return candidate
    except (OSError, ValueError):
        pass
    return None


_catalog_models_cache: dict[str, list[dict]] = {}


def _scan_provider_catalog_models(ext_dir: Path) -> dict[str, list[dict]]:
    """Extract built-in model catalogs from each extension's provider-catalog JS.

    Many providers (moonshot, deepseek, mistral, etc.) define their model lists
    inside a build*Provider() function rather than registering them in the global
    models list.  We execute these functions via Node.js to get the real data.
    """
    version = _get_openclaw_version_sync()
    if version and version in _catalog_models_cache:
        return _catalog_models_cache[version]

    import subprocess
    env = _build_env()
    dist_dir = ext_dir.parent

    js_script = """
import fs from 'fs';
import path from 'path';
const extDir = %EXT_DIR%;

async function main() {
  const result = {};

  for (const dir of fs.readdirSync(extDir).sort()) {
    const catFile = path.join(extDir, dir, 'provider-catalog.js');
    if (!fs.existsSync(catFile)) continue;

    const manifest = path.join(extDir, dir, 'openclaw.plugin.json');
    let providerIds = [];
    if (fs.existsSync(manifest)) {
      try {
        const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        providerIds = m.providers || [];
      } catch {}
    }
    if (providerIds.length === 0) continue;

    try {
      const mod = await import('file://' + catFile);
      const buildFns = Object.keys(mod).filter(
        k => k.startsWith('build') && typeof mod[k] === 'function'
      );
      for (const fn of buildFns) {
        try {
          const prov = mod[fn]();
          if (!prov || !Array.isArray(prov.models)) continue;
          for (const pid of providerIds) {
            if (!result[pid]) result[pid] = [];
            for (const m of prov.models) {
              if (!m.id) continue;
              result[pid].push({
                id: pid + '/' + m.id,
                name: m.name || m.id,
                reasoning: !!m.reasoning,
                contextWindow: m.contextWindow || 0,
              });
            }
          }
          break;
        } catch {}
      }
    } catch {}
  }

  process.stdout.write(JSON.stringify(result));
}
main();
""".replace("%EXT_DIR%", json.dumps(str(ext_dir)))
    node_path = shutil.which("node", path=env.get("PATH", ""))
    if not node_path:
        return {}

    try:
        tmp = Path(tempfile.mkdtemp(prefix="xsafeclaw-"))
        script_file = tmp / "catalog_scan.mjs"
        script_file.write_text(js_script, encoding="utf-8")
        try:
            proc = subprocess.run(
                [node_path, str(script_file)],
                capture_output=True, text=True, timeout=10, env=env,
                cwd=str(dist_dir),
            )
        finally:
            shutil.rmtree(str(tmp), ignore_errors=True)
        if proc.returncode != 0:
            print(f"[catalog-scan] node script failed: {proc.stderr[:200]}")
            return {}
        parsed = json.loads(proc.stdout)
        if version:
            _catalog_models_cache.clear()
            _catalog_models_cache[version] = parsed
        return parsed
    except Exception as exc:
        print(f"[catalog-scan] failed: {exc}")
        return {}


def _scan_manifests(ext_dir: Path) -> tuple[list[dict], dict[str, str]]:
    """Scan openclaw.plugin.json files and build AUTH_PROVIDERS + CLI flags."""
    groups: dict[str, dict] = {}
    cli_flags: dict[str, str] = {}

    for entry in sorted(ext_dir.iterdir()):
        manifest_path = entry / "openclaw.plugin.json"
        if not manifest_path.is_file():
            continue
        try:
            manifest = json.loads(manifest_path.read_text("utf-8"))
        except Exception:
            continue
        choices = manifest.get("providerAuthChoices")
        if not choices:
            continue
        if not manifest.get("providers"):
            continue
        for choice in choices:
            gid = choice.get("groupId")
            if not gid:
                continue
            if gid not in groups:
                groups[gid] = {
                    "id": gid,
                    "name": choice.get("groupLabel", gid),
                    "hint": choice.get("groupHint", ""),
                    "supported": False,
                    "methods": [],
                }

            choice_id = choice.get("choiceId", "")
            cli_flag = choice.get("cliFlag")
            has_cli = bool(cli_flag)

            method: dict = {
                "id": choice_id,
                "label": choice.get("choiceLabel", choice_id),
            }
            choice_hint = choice.get("choiceHint", "")
            if choice_hint:
                method["hint"] = choice_hint

            choice_provider = choice.get("provider", "")
            if choice_provider:
                method["modelProviders"] = [choice_provider]

            deprecated = choice.get("deprecatedChoiceIds")
            if deprecated:
                method["deprecatedChoiceIds"] = deprecated

            groups[gid]["methods"].append(method)
            if has_cli:
                groups[gid]["supported"] = True
                cli_flags[choice_id] = cli_flag
                if deprecated:
                    for dep_id in deprecated:
                        cli_flags[dep_id] = cli_flag

    # Providers with custom frontend UI that work without a CLI flag
    _CUSTOM_UI_GROUPS = {"vllm", "ollama", "sglang"}
    for gid in _CUSTOM_UI_GROUPS:
        if gid in groups:
            groups[gid]["supported"] = True

    result: list[dict] = list(groups.values())
    result.extend(_EXTRA_STATIC_PROVIDERS)
    return result, cli_flags


def _get_openclaw_version_sync() -> str:
    """Get openclaw version string synchronously (for cache key)."""
    import subprocess
    env = _build_env()
    openclaw_path = _find_openclaw()
    if not openclaw_path:
        return ""
    try:
        proc = subprocess.run(
            [openclaw_path, "--version"],
            capture_output=True, text=True, timeout=5, env=env,
        )
        return proc.stdout.strip().split("\n")[0] if proc.stdout else ""
    except Exception:
        return ""


def _get_auth_providers_and_flags() -> tuple[list[dict], dict[str, str]]:
    """Return (AUTH_PROVIDERS, _METHOD_CLI_FLAGS), using cache when possible."""
    version = _get_openclaw_version_sync()
    if not version:
        return _FALLBACK_AUTH_PROVIDERS, _FALLBACK_CLI_FLAGS

    cached = _provider_cache.get(version)
    if cached:
        return cached

    ext_dir = _find_extensions_dir()
    if not ext_dir:
        return _FALLBACK_AUTH_PROVIDERS, _FALLBACK_CLI_FLAGS

    try:
        providers, flags = _scan_manifests(ext_dir)
        if not providers:
            return _FALLBACK_AUTH_PROVIDERS, _FALLBACK_CLI_FLAGS
        _provider_cache.clear()
        _provider_cache[version] = (providers, flags)
        return providers, flags
    except Exception as exc:
        print(f"[provider-scan] failed to scan manifests: {exc}")
        return _FALLBACK_AUTH_PROVIDERS, _FALLBACK_CLI_FLAGS

PROVIDER_KEY_URLS: dict[str, str] = {
    "openai": "https://platform.openai.com/api-keys",
    "anthropic": "https://console.anthropic.com/settings/keys",
    "google": "https://aistudio.google.com/apikey",
    "google-vertex": "https://console.cloud.google.com/apis/credentials",
    "google-gemini-cli": "https://aistudio.google.com/apikey",
    "moonshot": "https://platform.moonshot.cn/console/api-keys",
    "kimi-coding": "https://www.kimi.com/code/en",
    "minimax": "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    "minimax-cn": "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    "mistral": "https://console.mistral.ai/api-keys",
    "xai": "https://console.x.ai/",
    "deepseek": "https://platform.deepseek.com/api_keys",
    "openrouter": "https://openrouter.ai/keys",
    "together": "https://api.together.xyz/settings/api-keys",
    "huggingface": "https://huggingface.co/settings/tokens",
    "groq": "https://console.groq.com/keys",
    "cerebras": "https://cloud.cerebras.ai/",
    "venice": "https://venice.ai/settings/api",
    "qwen-portal": "https://dashscope.console.aliyun.com/apiKey",
    "modelstudio": "https://bailian.console.aliyun.com/",
    "qianfan": "https://console.bce.baidu.com/qianfan/ais/console/apiKey",
    "opencode": "https://opencode.ai/auth",
    "volcengine": "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    "zai": "https://open.bigmodel.cn/usercenter/apikeys",
    "xiaomi": "https://developers.xiaomi.com/mimo",
    "litellm": "https://litellm.ai",
    "cloudflare-ai-gateway": "https://dash.cloudflare.com/",
    "amazon-bedrock": "https://console.aws.amazon.com/bedrock/",
}

SEARCH_PROVIDERS = [
    {"id": "brave", "name": "Brave Search", "hint": "Structured results with country/language/time filters", "placeholder": "BSA..."},
    {"id": "gemini", "name": "Gemini (Google Search)", "hint": "Google Search grounding, AI-synthesized", "placeholder": "AIza..."},
    {"id": "grok", "name": "Grok (xAI)", "hint": "xAI web-grounded responses", "placeholder": "xai-..."},
    {"id": "kimi", "name": "Kimi (Moonshot)", "hint": "Moonshot web search", "placeholder": "sk-..."},
    {"id": "perplexity", "name": "Perplexity Search", "hint": "Structured results with domain/country filters", "placeholder": "pplx-..."},
]


def _extract_json_obj(raw: str) -> dict | list:
    """Extract the first complete JSON object/array from a string that may
    contain non-JSON text before or after (e.g. plugin log lines).

    Tries '{' first (most CLI outputs are objects), then falls back to '['.
    This avoids false matches on log lines like ``[plugins] ...``."""
    for bracket_char in ("{", "["):
        close = "}" if bracket_char == "{" else "]"
        start = raw.find(bracket_char)
        if start == -1:
            continue
        depth = 0
        in_str = False
        escape = False
        for i in range(start, len(raw)):
            ch = raw[i]
            if escape:
                escape = False
                continue
            if ch == "\\":
                if in_str:
                    escape = True
                continue
            if ch == '"':
                in_str = not in_str
                continue
            if in_str:
                continue
            if ch == bracket_char:
                depth += 1
            elif ch == close:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(raw[start:i + 1])
                    except json.JSONDecodeError:
                        break
        continue
    raise ValueError("No valid JSON found in output")


async def _run_agent_json(args: list[str], timeout: int = 30) -> dict | list | None:
    """Run the active platform's CLI with --json and return parsed output.

    Dispatches to ``_run_openclaw_json`` or ``_run_hermes_json`` depending
    on the configured platform.
    """
    if settings.is_hermes:
        return await _run_hermes_json(args, timeout=timeout)
    return await _run_openclaw_json(args, timeout=timeout)


async def _run_hermes_json(args: list[str], timeout: int = 30) -> dict | list | None:
    """Run a hermes CLI command with --json and return parsed output."""
    hermes_path = _find_hermes()
    if not hermes_path:
        print(f"[hermes-json] hermes executable not found for args={args!r}")
        return None
    env = _build_env()
    cmd = _build_agent_command(hermes_path, [*args, "--json"])
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        stdout_text = (stdout or b"").decode("utf-8", errors="replace")
        stderr_text = (stderr or b"").decode("utf-8", errors="replace")
        raw = "\n".join(part for part in (stdout_text, stderr_text) if part).strip()
        if not raw:
            return None
        try:
            return _extract_json_obj(raw)
        except Exception:
            return None
    except asyncio.TimeoutError:
        return None
    except Exception:
        return None


async def _run_openclaw_json(args: list[str], timeout: int = 30) -> dict | list | None:
    """Run an openclaw CLI command with --json and return parsed output."""
    openclaw_path = _find_openclaw()
    if not openclaw_path:
        print(f"[openclaw-json] openclaw executable not found for args={args!r}")
        return None
    env = _build_env()
    cmd = _build_openclaw_command(openclaw_path, [*args, "--json"])
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        stdout_text = (stdout or b"").decode("utf-8", errors="replace")
        stderr_text = (stderr or b"").decode("utf-8", errors="replace")
        raw = "\n".join(part for part in (stdout_text, stderr_text) if part).strip()
        if not raw:
            print(
                f"[openclaw-json] empty output for cmd={cmd!r}, returncode={proc.returncode}"
            )
            return None
        try:
            parsed = _extract_json_obj(raw)
        except Exception as exc:
            snippet = raw[:500].replace("\n", "\\n")
            print(
                f"[openclaw-json] failed to parse JSON for cmd={cmd!r}, "
                f"returncode={proc.returncode}, error={exc}, output={snippet}"
            )
            return None
        if proc.returncode != 0:
            print(
                f"[openclaw-json] non-zero exit for cmd={cmd!r}, returncode={proc.returncode}; "
                "using parsed JSON payload anyway"
            )
        return parsed
    except asyncio.TimeoutError:
        print(f"[openclaw-json] timeout after {timeout}s for cmd={cmd!r}")
        return None
    except Exception as exc:
        print(f"[openclaw-json] exec failed for cmd={cmd!r}: {exc}")
        return None


# ── Onboard-scan background preloader ─────────────────────────────────────────
# Runs `openclaw models list --all` (slow, ~70s) in the background so the
# configure page loads instantly when the user navigates there.

_onboard_scan_cache: dict = {}
_onboard_scan_version: str = ""
_onboard_scan_task: Optional[asyncio.Task] = None
_onboard_scan_lock = asyncio.Lock()
_ONBOARD_SCAN_DISK_CACHE = _OPENCLAW_DIR / "xsafeclaw-model-catalog-cache.json"


def _save_scan_to_disk(data: dict, version: str = "") -> None:
    try:
        payload = {**data, "_cache_version": version}
        tmp = _ONBOARD_SCAN_DISK_CACHE.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        tmp.rename(_ONBOARD_SCAN_DISK_CACHE)
    except Exception:
        pass


def _load_scan_from_disk() -> tuple[dict, str]:
    """Return (data, cached_version). Both empty if no valid cache."""
    if not _ONBOARD_SCAN_DISK_CACHE.exists():
        return {}, ""
    try:
        raw = json.loads(_ONBOARD_SCAN_DISK_CACHE.read_text("utf-8"))
        if not isinstance(raw, dict):
            return {}, ""
        cached_version = str(raw.pop("_cache_version", ""))
        return raw, cached_version
    except Exception:
        return {}, ""


async def _build_onboard_scan_data() -> dict:
    """Execute all openclaw CLI scans and assemble the full onboard-scan response."""
    models_task = _run_openclaw_json(["models", "list", "--all"], timeout=500)
    status_task = _run_openclaw_json(["models", "status"], timeout=500)
    channels_task = _run_openclaw_json(["channels", "list"], timeout=500)
    skills_task = _run_openclaw_json(["skills", "list"], timeout=500)
    hooks_task = _run_openclaw_json(["hooks", "list"], timeout=500)

    models_raw, status_raw, channels_raw, skills_raw, hooks_raw = await asyncio.gather(
        models_task, status_task, channels_task, skills_task, hooks_task,
    )

    # Parse models -> group by provider
    providers: dict[str, dict] = {}
    if models_raw and isinstance(models_raw, dict):
        for m in models_raw.get("models", []):
            key = m.get("key", "")
            if "/" not in key:
                continue
            prov_id = key.split("/")[0]
            if prov_id not in providers:
                providers[prov_id] = {
                    "id": prov_id, "name": prov_id, "models": [],
                    "keyUrl": PROVIDER_KEY_URLS.get(prov_id, ""),
                }
            providers[prov_id]["models"].append({
                "id": key,
                "name": m.get("name", key),
                "contextWindow": m.get("contextWindow", 0),
                "reasoning": "reasoning" in (m.get("tags") or []),
                "available": m.get("available", False),
                "input": m.get("input", "text"),
            })

    # Supplement with built-in provider-catalog models (moonshot, deepseek, etc.)
    ext_dir = _find_extensions_dir()
    if ext_dir:
        catalog_models = _scan_provider_catalog_models(ext_dir)
        for prov_id, models in catalog_models.items():
            if prov_id not in providers:
                providers[prov_id] = {
                    "id": prov_id, "name": prov_id, "models": [],
                    "keyUrl": PROVIDER_KEY_URLS.get(prov_id, ""),
                }
            existing_ids = {m["id"] for m in providers[prov_id]["models"]}
            for m in models:
                if m["id"] not in existing_ids:
                    providers[prov_id]["models"].append({
                        "id": m["id"],
                        "name": m.get("name", m["id"]),
                        "contextWindow": m.get("contextWindow", 0),
                        "reasoning": m.get("reasoning", False),
                        "available": True,
                        "input": m.get("input", "text"),
                    })

    # Parse status
    default_model = ""
    auth_profiles: list[dict] = []
    if status_raw and isinstance(status_raw, dict):
        default_model = status_raw.get("defaultModel", "")
        auth_profiles = status_raw.get("auth", [])

    # Parse channels
    configured_channels: set[str] = set()
    if channels_raw and isinstance(channels_raw, dict):
        chat = channels_raw.get("chat", {})
        if isinstance(chat, dict):
            configured_channels = {ch_id for ch_id, ch_data in chat.items() if ch_data}
    channels: list[dict] = [
        {**ch, "configured": ch["id"] in configured_channels}
        for ch in AVAILABLE_CHANNELS
    ]

    # Parse skills
    skills: list[dict] = []
    if skills_raw and isinstance(skills_raw, dict):
        for s in skills_raw.get("skills", []):
            skills.append({
                "name": s.get("name", ""),
                "description": s.get("description", ""),
                "emoji": s.get("emoji", ""),
                "eligible": s.get("eligible", False),
                "disabled": s.get("disabled", False),
                "missing": s.get("missing", []) if isinstance(s.get("missing"), list) else [],
                "source": s.get("source", ""),
                "bundled": s.get("bundled", False),
            })

    # Parse hooks
    hooks: list[dict] = []
    if hooks_raw and isinstance(hooks_raw, dict):
        for h in hooks_raw.get("hooks", []):
            hooks.append({
                "name": h.get("name", ""),
                "description": h.get("description", ""),
                "emoji": h.get("emoji", ""),
                "enabled": h.get("enabled", False),
            })
    if not hooks:
        hooks = [
            {"name": h["name"], "description": h["description"], "emoji": h.get("emoji", "⚙️"), "enabled": False}
            for h in AVAILABLE_HOOKS
        ]

    return {
        "model_providers": list(providers.values()),
        "auth_profiles": auth_profiles,
        "default_model": default_model,
        "channels": channels,
        "skills": skills,
        "hooks": hooks,
    }


# ── Live Hermes catalog bridge ────────────────────────────────────────────────
# Imports ``hermes_cli.models`` + ``agent.models_dev`` via the Hermes-bundled
# Python so the XSafeClaw frontend can offer *exactly* the providers/models
# the installed Hermes version supports — not a copy-pasted snapshot that
# drifts on each Hermes upgrade.  Falls back to the static catalog below if
# anything goes wrong (Hermes not installed, shebang unparseable, import
# error in a future Hermes version, etc.).

_HERMES_CATALOG_TTL_S = 600.0  # 10 minutes — matches Hermes's own models.dev refresh cadence
_hermes_catalog_cache: tuple[list[dict], float] | None = None

# Inline Python executed inside the Hermes venv.  Kept deliberately tiny and
# dependency-free beyond ``hermes_cli`` / ``agent`` so it won't break on
# partial installs.
#
# Two important contracts vs the older probe:
#
#   1. Credentials gate — we call ``list_available_providers()`` (same primitive
#      that powers the ``hermes model`` TUI picker) so provider entries get an
#      ``authenticated`` flag.  The frontend uses that flag to grey out
#      providers the user hasn't set keys for, which is the *only* way to
#      prevent the "pick a Nous-routed claude-opus with no NOUS_API_KEY and
#      watch chat return [No response]" class of regression.
#
#   2. OpenRouter uses its live ``/v1/models`` — ``_PROVIDER_MODELS`` has no
#      ``openrouter`` entry by design (Hermes routes OpenRouter through
#      ``fetch_openrouter_models`` with its own 10-minute disk cache).
#      Using the static catalog here would surface wrong ids
#      (``anthropic/claude-sonnet-4-20250514`` is Anthropic snapshot naming;
#      OpenRouter actually serves ``anthropic/claude-sonnet-4.5`` etc.).
_HERMES_CATALOG_PROBE_SCRIPT = r"""
import json, sys
try:
    from hermes_cli.models import CANONICAL_PROVIDERS, _PROVIDER_MODELS
except Exception as exc:
    json.dump({"error": f"import hermes_cli.models failed: {exc!r}"}, sys.stdout)
    sys.exit(0)

try:
    from hermes_cli.models import list_available_providers
except Exception:
    def list_available_providers():
        return []

try:
    from hermes_cli.models import fetch_openrouter_models
except Exception:
    fetch_openrouter_models = None

try:
    from agent.models_dev import get_model_info, get_provider_info
except Exception:
    def get_model_info(*a, **kw): return None
    def get_provider_info(*a, **kw): return None

try:
    from hermes_cli.env_loader import load_hermes_dotenv
    load_hermes_dotenv()
except Exception:
    pass

authed = set()
try:
    for ap in list_available_providers() or []:
        pid = str(ap.get("id") or "").strip() if isinstance(ap, dict) else ""
        if pid:
            authed.add(pid)
except Exception:
    pass

def _models_from_static(slug):
    bare_list = _PROVIDER_MODELS.get(slug, []) or []
    out_models = []
    for mid in bare_list:
        try:
            mi = get_model_info(slug, mid)
        except Exception:
            mi = None
        out_models.append({
            "bare_id": mid,
            "name": (getattr(mi, "name", None) or mid),
            "context_window": int(getattr(mi, "context_window", 0) or 0),
            "reasoning": bool(getattr(mi, "reasoning", False)),
        })
    return out_models

def _models_from_openrouter():
    if fetch_openrouter_models is None:
        return []
    try:
        pairs = fetch_openrouter_models(force_refresh=False) or []
    except Exception:
        return []
    out_models = []
    for item in pairs:
        try:
            mid = str(item[0] if isinstance(item, (list, tuple)) else item).strip()
        except Exception:
            continue
        if not mid:
            continue
        try:
            mi = get_model_info("openrouter", mid)
        except Exception:
            mi = None
        out_models.append({
            "bare_id": mid,
            "name": (getattr(mi, "name", None) or mid),
            "context_window": int(getattr(mi, "context_window", 0) or 0),
            "reasoning": bool(getattr(mi, "reasoning", False)),
        })
    return out_models

out = []
for p in CANONICAL_PROVIDERS:
    try:
        pi = get_provider_info(p.slug)
    except Exception:
        pi = None

    is_authed = p.slug in authed
    if p.slug == "openrouter" and is_authed:
        models = _models_from_openrouter()
        if not models:
            models = _models_from_static(p.slug)
    else:
        models = _models_from_static(p.slug)

    env_keys = []
    doc_url = ""
    if pi is not None:
        try:
            env_keys = list(getattr(pi, "env", ()) or ())
            doc_url = str(getattr(pi, "doc", "") or "")
        except Exception:
            pass

    out.append({
        "slug": p.slug,
        "label": p.label,
        "desc": p.tui_desc,
        "env_keys": env_keys,
        "doc_url": doc_url,
        "models": models,
        "authenticated": is_authed,
    })

json.dump({"providers": out}, sys.stdout)
"""


def _shape_live_catalog_entry(entry: dict) -> Optional[dict]:
    """Normalise one live-catalog provider into XSafeClaw's scan-data shape.

    Unlike the older version, this no longer drops provider entries with an
    empty ``models`` list — instead it surfaces them as ``available=False``
    so the UI can grey them out and the user sees *why* the provider exists
    but is unusable (missing API key, OAuth not completed, etc.).  This
    closes the regression where unauthenticated aggregators (``nous``,
    ``openrouter`` without an ``OPENROUTER_API_KEY``) silently produced a
    successful-looking selection that blew up at chat time.
    """
    slug = str(entry.get("slug") or "").strip()
    if not slug:
        return None

    authed = bool(entry.get("authenticated"))

    # Preserve XSafeClaw's historical "<slug>/<bare_id>" id convention so
    # existing saved selections (and the downstream _quick_model_config_hermes
    # dispatch path) keep working without any other changes.
    prefix = f"{slug}/"
    models_out: list[dict] = []
    for m in entry.get("models") or []:
        bid = str(m.get("bare_id") or "").strip()
        if not bid:
            continue
        display_id = bid if bid.startswith(prefix) else f"{prefix}{bid}"
        models_out.append({
            "id": display_id,
            "name": str(m.get("name") or bid),
            "contextWindow": int(m.get("context_window") or 0),
            "reasoning": bool(m.get("reasoning") or False),
            "available": authed,
            "input": "text",
        })

    return {
        "id": slug,
        "name": str(entry.get("label") or slug),
        "keyUrl": PROVIDER_KEY_URLS.get(slug, ""),
        "models": models_out,
        "available": authed,
        "requiresCredentials": not authed,
        # Extra fields preserved for future use (not consumed by the current
        # frontend; leaving them here avoids another round-trip when we
        # eventually surface provider env-var hints / docs).
        "_hermes_env_keys": list(entry.get("env_keys") or ()),
        "_hermes_doc_url": str(entry.get("doc_url") or ""),
        "_hermes_desc": str(entry.get("desc") or ""),
    }


def _fetch_hermes_catalog_live(*, force: bool = False) -> Optional[list[dict]]:
    """Spawn Hermes's own Python and return the live provider/model catalog.

    Results are cached for ``_HERMES_CATALOG_TTL_S`` seconds.  Returns
    ``None`` when Hermes isn't installed, the probe subprocess fails, or
    the interpreter can't import the expected modules — every caller must
    handle ``None`` by falling back to the static catalog.
    """
    global _hermes_catalog_cache
    import subprocess
    import time

    now = time.monotonic()
    if not force and _hermes_catalog_cache is not None:
        cached, stamp = _hermes_catalog_cache
        if now - stamp < _HERMES_CATALOG_TTL_S:
            return cached

    interp = _hermes_python_interpreter()
    if not interp:
        return None

    env = _build_env()
    root = _hermes_install_root()
    if root:
        existing_pp = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = (
            f"{root}{_PATH_SEP}{existing_pp}" if existing_pp else root
        )
    # Hermes's models.dev loader caches to ~/.hermes; ensure HOME resolves
    # there even when XSafeClaw is launched under systemd / nohup.
    env.setdefault("HOME", str(Path.home()))

    try:
        result = subprocess.run(
            [interp, "-I", "-c", _HERMES_CATALOG_PROBE_SCRIPT],
            capture_output=True,
            text=True,
            timeout=15,
            env=env,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None

    if result.returncode != 0:
        return None

    try:
        payload = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        return None
    if payload.get("error"):
        return None

    providers_raw = payload.get("providers") or []
    shaped: list[dict] = []
    for entry in providers_raw:
        if not isinstance(entry, dict):
            continue
        out = _shape_live_catalog_entry(entry)
        if out is not None:
            shaped.append(out)

    if not shaped:
        return None

    _hermes_catalog_cache = (shaped, now)
    return shaped


# ── Live Hermes *configured-models* bridge ────────────────────────────────────
# Sibling of _fetch_hermes_catalog_live() — that one returns the full catalog
# ("what could be configured"), this one returns only what Hermes actually has
# credentials for right now ("what is configured").  The CMD-UI model picker
# consumes this so every provider the user logged into shows up as an option,
# not just the one currently stored in ``config.yaml::model.default``.
#
# Cached for 30s — much shorter than the catalog's 10min, because auth state
# and ``custom_providers`` change the instant a user edits ~/.hermes/.env or
# runs ``hermes auth``, and we want the CMD-UI to reflect that quickly.

_HERMES_CONFIGURED_TTL_S = 30.0
_hermes_configured_cache: tuple[dict, float] | None = None

# Inline probe executed inside the Hermes venv.  Uses the same trust boundary
# as §28's catalog probe — we rely on Hermes's own ``list_available_providers``
# for the authenticated check so our view of "configured" always matches what
# ``hermes model`` / ``/model`` show.
_HERMES_CONFIGURED_PROBE_SCRIPT = r"""
import json, sys
try:
    from hermes_cli.env_loader import load_hermes_dotenv
    load_hermes_dotenv()
except Exception:
    pass

try:
    from hermes_cli.models import (
        CANONICAL_PROVIDERS,
        list_available_providers,
        get_default_model_for_provider,
    )
    from hermes_cli.config import load_config
except Exception as exc:
    json.dump({"error": f"import failed: {exc!r}"}, sys.stdout)
    sys.exit(0)

label_for = {p.slug: p.label for p in CANONICAL_PROVIDERS}

try:
    cfg = load_config() or {}
except Exception:
    cfg = {}

mcfg = cfg.get("model", "")
if isinstance(mcfg, dict):
    active_model = str(mcfg.get("default", "") or mcfg.get("model", "")).strip()
    active_provider = str(mcfg.get("provider", "") or "").strip()
else:
    active_model = str(mcfg).strip()
    active_provider = ""

authed = []
try:
    for entry in list_available_providers() or []:
        if not isinstance(entry, dict) or not entry.get("authenticated"):
            continue
        pid = str(entry.get("id") or "").strip()
        # "custom" is surfaced via cfg["custom_providers"] below, skip here.
        if not pid or pid == "custom":
            continue
        try:
            default_m = str(get_default_model_for_provider(pid) or "").strip()
        except Exception:
            default_m = ""
        authed.append({
            "slug": pid,
            "label": str(entry.get("label") or label_for.get(pid) or pid),
            "default_model": default_m,
        })
except Exception:
    pass

customs = []
cps = cfg.get("custom_providers")
if isinstance(cps, list):
    for cp in cps:
        if not isinstance(cp, dict):
            continue
        name = str(cp.get("name") or "").strip()
        model = str(cp.get("model") or "").strip()
        base_url = str(cp.get("base_url") or "").strip()
        if not name or not model or not base_url:
            continue
        customs.append({"name": name, "model": model})

json.dump({
    "active_model": active_model,
    "active_provider": active_provider,
    "authenticated": authed,
    "custom": customs,
}, sys.stdout)
"""


def _fetch_hermes_configured_models(*, force: bool = False) -> Optional[dict]:
    """Ask Hermes which providers are authenticated + what their models are.

    Returns a dict of the form::

        {
            "active_model": "deepseek/deepseek-chat",  # from config.yaml
            "active_provider": "deepseek",
            "authenticated": [{"slug": "anthropic", "label": "Anthropic",
                                "default_model": "claude-sonnet-4.5"}, ...],
            "custom": [{"name": "MyGateway", "model": "llama-3.1-70b"}, ...],
        }

    Returns ``None`` when Hermes isn't installed or the probe fails — callers
    must fall back gracefully (usually by degrading to the single-model read
    from config.yaml).
    """
    global _hermes_configured_cache
    import subprocess
    import time

    now = time.monotonic()
    if not force and _hermes_configured_cache is not None:
        cached, stamp = _hermes_configured_cache
        if now - stamp < _HERMES_CONFIGURED_TTL_S:
            return cached

    interp = _hermes_python_interpreter()
    if not interp:
        return None

    env = _build_env()
    root = _hermes_install_root()
    if root:
        existing_pp = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = (
            f"{root}{_PATH_SEP}{existing_pp}" if existing_pp else root
        )
    env.setdefault("HOME", str(Path.home()))

    try:
        result = subprocess.run(
            [interp, "-I", "-c", _HERMES_CONFIGURED_PROBE_SCRIPT],
            capture_output=True,
            text=True,
            timeout=10,
            env=env,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None

    if result.returncode != 0:
        return None

    try:
        payload = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict) or payload.get("error"):
        return None

    _hermes_configured_cache = (payload, now)
    return payload


def _invalidate_hermes_configured_cache() -> None:
    """Drop the cached configured-models probe so the next CMD-UI refresh re-reads.

    Called after ``/api/system/quick-model-config`` writes to Hermes so the
    user sees the new provider/model deck immediately instead of waiting up
    to 30s for the TTL to expire.
    """
    global _hermes_configured_cache
    _hermes_configured_cache = None


# ── §35: XSafeClaw-side persisted "configured-by-user" model list ─────────────
# Hermes's ``config.yaml::model.default`` only tracks one model at a time and
# ``hermes_cli.models.get_default_model_for_provider`` returns Hermes's
# **hardcoded** per-provider default (``""`` for OpenRouter, ``"kimi-k2.5"`` for
# alibaba, ...), neither of which captures *what the user actually picked the
# last time they ran quick-model-config*.  Without our own bookkeeping the
# CMD-UI's Create-Agent dropdown loses every prior pick on restart and shows
# Hermes's wrong defaults instead — see §35 in the change log.
#
# This file is a tiny append-only-with-dedupe ledger:
#
#     ~/.xsafeclaw/configured_models.json
#     {
#       "version": 1,
#       "models": [
#         {"slug": "openrouter", "model_id": "openrouter/anthropic/claude-opus-4.7",
#          "bare_id": "anthropic/claude-opus-4.7", "name": "...", "configured_at": 1.7e9},
#         ...
#       ]
#     }
#
# Reads are cheap (no parse caching; file is tiny).  Writes are atomic via
# tmp-then-rename so a crashed process can't leave a half-written ledger.

_XS_CONFIGURED_MODELS_VERSION = 1


def _xs_configured_models_path() -> Path:
    """Path to the XSafeClaw-side configured-models ledger."""
    return Path.home() / ".xsafeclaw" / "configured_models.json"


def _load_xs_configured_models() -> list[dict]:
    """Load the ledger.  Returns ``[]`` on missing / unparseable / wrong-shape file.

    Each entry is normalised so callers can rely on at least
    ``{"slug": str, "model_id": str, "bare_id": str, "name": str, "configured_at": float}``.
    """
    path = _xs_configured_models_path()
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8") or "{}")
    except Exception:
        return []
    if not isinstance(raw, dict):
        return []
    items = raw.get("models")
    if not isinstance(items, list):
        return []
    out: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        slug = str(item.get("slug") or "").strip()
        model_id = str(item.get("model_id") or "").strip()
        if not slug or not model_id:
            continue
        bare_id = str(item.get("bare_id") or "").strip()
        if not bare_id:
            # Backfill ``bare_id`` from ``model_id`` for entries written by an
            # older version of the recorder, so consumers can lean on the
            # invariant that bare_id is always populated.
            if "/" in model_id:
                _, bare_id = model_id.split("/", 1)
            else:
                bare_id = model_id
        out.append({
            "slug": slug,
            "model_id": model_id,
            "bare_id": bare_id,
            "name": str(item.get("name") or bare_id),
            "configured_at": float(item.get("configured_at") or 0.0),
        })
    return out


def _record_xs_configured_model(
    *,
    slug: str,
    model_id: str,
    bare_id: str = "",
    name: str = "",
) -> None:
    """Upsert a (slug, bare_id) pair into the ledger.

    Idempotent on ``(slug, bare_id)`` — re-saving the same pick just refreshes
    its ``configured_at`` timestamp (so the CMD-UI's "most recent" sort still
    works) without producing duplicates.
    """
    slug = (slug or "").strip()
    model_id = (model_id or "").strip()
    if not slug or not model_id:
        return

    if not bare_id:
        bare_id = model_id.split("/", 1)[1] if "/" in model_id else model_id
    bare_id = bare_id.strip()
    if not bare_id:
        return

    name = (name or bare_id).strip()

    import time
    now_ts = time.time()

    entries = _load_xs_configured_models()
    matched = False
    for entry in entries:
        if entry["slug"] == slug and entry["bare_id"] == bare_id:
            entry["model_id"] = model_id
            entry["name"] = name
            entry["configured_at"] = now_ts
            matched = True
            break
    if not matched:
        entries.append({
            "slug": slug,
            "model_id": model_id,
            "bare_id": bare_id,
            "name": name,
            "configured_at": now_ts,
        })

    path = _xs_configured_models_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(
                {"version": _XS_CONFIGURED_MODELS_VERSION, "models": entries},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        tmp.replace(path)
    except Exception:
        # Ledger writes are best-effort: failing to persist must not break the
        # primary quick-model-config flow that already wrote config.yaml + .env
        # successfully.  The CMD-UI degrades to "only the active model is
        # remembered" until the next successful save.
        pass


def _remove_xs_configured_model(*, slug: str, bare_id: str) -> bool:
    """Drop one ``(slug, bare_id)`` entry from the ledger.

    Returns ``True`` if the entry existed and was removed, ``False`` if there
    was no matching entry (idempotent — callers can treat the absence as a
    success too).  Never touches ``.env`` or ``config.yaml``: deleting a
    ledger entry only hides the model from the CMD-UI's "configured models"
    deck; agents already pinned to that ``model_id`` keep working as long
    as the provider's API key is still present in ``.env``.
    """
    slug = (slug or "").strip()
    bare_id = (bare_id or "").strip()
    if not slug or not bare_id:
        return False

    entries = _load_xs_configured_models()
    kept = [e for e in entries if not (e["slug"] == slug and e["bare_id"] == bare_id)]
    if len(kept) == len(entries):
        return False

    path = _xs_configured_models_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(
            json.dumps(
                {"version": _XS_CONFIGURED_MODELS_VERSION, "models": kept},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        tmp.replace(path)
    except Exception:
        # Same best-effort policy as ``_record_xs_configured_model``: a
        # failed disk write must not pretend the entry is gone (the next
        # CMD-UI refresh would still see it), so re-raise as False.
        return False
    return True


def _seed_xs_configured_models_from_config(
    *,
    default_model: str,
    provider: str,
) -> None:
    """One-shot migration: when the ledger is empty but ``config.yaml`` already
    has a ``model.default`` (e.g. user upgraded into §35 with a pre-existing
    setup), record the active model so it survives the very first restart.
    """
    if not default_model or not provider:
        return
    if _load_xs_configured_models():
        return  # Ledger already has entries — nothing to seed.
    if "/" in default_model:
        bare_id = default_model
        full_id = f"{provider}/{default_model}" if not default_model.startswith(f"{provider}/") else default_model
    else:
        bare_id = default_model
        full_id = f"{provider}/{default_model}"
    _record_xs_configured_model(
        slug=provider,
        model_id=full_id,
        bare_id=bare_id,
        name=bare_id,
    )


def _build_onboard_scan_data_hermes() -> dict:
    """Build onboard-scan response for Hermes.

    Prefers the live catalog read out of ``hermes_cli.models`` /
    ``agent.models_dev`` via the Hermes-bundled interpreter, so whatever the
    installed Hermes build supports is what users see.  Falls back to the
    static ``_HERMES_MODEL_CATALOG`` below whenever the live probe fails
    (Hermes not installed, shebang unparseable, import failure after a
    breaking Hermes upgrade, etc.).

    Also reads ``config.yaml`` to surface the currently configured default
    model so the Configure UI can highlight the active selection.
    """
    providers: dict[str, dict] = {}

    live = _fetch_hermes_catalog_live()
    if live:
        for entry in live:
            providers[entry["id"]] = entry
        # Provider-shell merge: if Hermes's canonical list of providers lost
        # coverage of something we know about (Hermes upgrade removed a
        # slug, probe partially failed, etc.), expose an empty shell so the
        # UI still knows the provider exists.  We *never* carry the static
        # model ids forward anymore — live Hermes is the single source of
        # truth for what's installable; stale or wrong ids here caused the
        # ``Model Not Exist`` / ``[No response]`` regressions.
        for prov in _HERMES_MODEL_CATALOG:
            pid = prov["id"]
            if pid in providers:
                continue
            providers[pid] = {
                "id": pid,
                "name": prov["name"],
                "keyUrl": PROVIDER_KEY_URLS.get(pid, ""),
                "models": [],
                "available": False,
                "requiresCredentials": True,
            }
    else:
        # Live probe unavailable (Hermes not installed, interpreter shebang
        # unparseable, import failure after a breaking Hermes upgrade).  We
        # surface the provider shells so the UI can still render them + let
        # the user start the setup flow, but we keep the models list empty
        # to avoid offering selections we can't validate.
        for prov in _HERMES_MODEL_CATALOG:
            prov_id = prov["id"]
            providers[prov_id] = {
                "id": prov_id,
                "name": prov["name"],
                "keyUrl": PROVIDER_KEY_URLS.get(prov_id, ""),
                "models": [],
                "available": False,
                "requiresCredentials": True,
            }

    # ``default_model`` is what the Configure wizard uses to preselect the
    # current model when the user re-opens it.  Historically Hermes stored
    # the slug-prefixed id (``openrouter/anthropic/claude-opus-4.7``) in
    # ``model.default``, and the frontend does ``def.split('/')[0]`` to
    # recover the provider slug.  Since §34 we now write the **bare** id to
    # ``model.default`` (to match Hermes's outbound-API contract), so we
    # re-attach the provider slug here purely for the UI hydration path.
    # Without this, Configure would read ``anthropic/claude-opus-4.7`` and
    # try to match provider ``"anthropic"`` against the catalog, which lists
    # the route as ``"openrouter"`` and silently drops the pre-selection.
    default_model = ""
    try:
        if _CONFIG_PATH.exists():
            import yaml
            cfg = yaml.safe_load(_CONFIG_PATH.read_text(encoding="utf-8")) or {}
            model_cfg = cfg.get("model", "")
            if isinstance(model_cfg, dict):
                raw_default = str(model_cfg.get("default", "") or model_cfg.get("model", "")).strip()
                raw_provider = str(model_cfg.get("provider", "") or "").strip()
                if raw_default and raw_provider and not raw_default.startswith(f"{raw_provider}/"):
                    default_model = f"{raw_provider}/{raw_default}"
                else:
                    default_model = raw_default
            else:
                default_model = str(model_cfg).strip()
    except Exception:
        pass

    return {
        "model_providers": list(providers.values()),
        "auth_profiles": [],
        "default_model": default_model,
        "channels": [],
        "skills": [],
        "hooks": [],
    }


def _count_scan_models(data: dict) -> int:
    return sum(len(p.get("models", [])) for p in data.get("model_providers", []))


async def _preload_onboard_scan() -> None:
    """Background task: preload onboard-scan data and cache it."""
    global _onboard_scan_cache, _onboard_scan_version
    try:
        version = _get_openclaw_version_sync()
        if not version:
            print("⚠️  Model list: cannot detect OpenClaw version, skipping scan")
            return

        # Already warm in memory for this version — nothing to do.
        if _onboard_scan_cache and _onboard_scan_version == version:
            print(f"✅ Model list: {_count_scan_models(_onboard_scan_cache)} models ready (version {version})")
            return

        # Cold start — try disk cache first for instant availability.
        if not _onboard_scan_cache:
            disk_data, disk_ver = _load_scan_from_disk()
            if disk_data and disk_data.get("model_providers"):
                n = _count_scan_models(disk_data)
                if disk_ver == version:
                    _onboard_scan_cache = disk_data
                    _onboard_scan_version = version
                    print(f"✅ Model list: {n} models loaded from disk cache (version {version})")
                    return
                else:
                    _onboard_scan_cache = disk_data
                    print(f"📂 Model list: {n} models loaded from disk cache (stale v{disk_ver}, need v{version}), refreshing...")
            else:
                print(f"📂 Model list: no disk cache found, scanning from scratch...")

        # Full CLI scan (slow, ~90s)
        print(f"🔄 Model list: scanning all providers via OpenClaw CLI...")
        data = await _build_onboard_scan_data()
        new_count = _count_scan_models(data)
        old_count = _count_scan_models(_onboard_scan_cache)

        if new_count >= old_count or new_count >= 200:
            _onboard_scan_cache = data
            _onboard_scan_version = version
            _save_scan_to_disk(data, version)
            mp = len(data.get("model_providers", []))
            print(f"✅ Model list: {new_count} models across {mp} providers (version {version}, saved to disk)")
        else:
            print(f"⚠️  Model list: scan returned {new_count} models (less than cached {old_count}), keeping cache")

    except asyncio.CancelledError:
        print("⏹️  Model list: background scan cancelled")
    except Exception as exc:
        print(f"⚠️  Model list: scan failed: {exc}")


def trigger_onboard_scan_preload(force: bool = False) -> None:
    """Fire-and-forget: start preloading if not already running.

    Safe to call from sync context (e.g. after install completes).
    When *force* is True the cached version stamp is cleared first so
    the preload actually re-runs even if the OpenClaw version hasn't changed.
    """
    global _onboard_scan_task, _onboard_scan_version
    if force:
        _onboard_scan_version = ""
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        return
    if _onboard_scan_task and not _onboard_scan_task.done():
        if not force:
            return
        _onboard_scan_task.cancel()
    _onboard_scan_task = loop.create_task(_preload_onboard_scan())


@router.get("/onboard-scan")
async def onboard_scan(refresh: bool = False):
    """Scan the local environment for available providers, channels, skills, hooks."""
    global _onboard_scan_cache, _onboard_scan_version, _onboard_scan_task

    # ── Hermes fast path — static catalog, no CLI scanning needed ─────────
    if settings.is_hermes:
        data = _build_onboard_scan_data_hermes()

        config_summary: list[str] = []
        hermes_default = data.get("default_model", "")
        if hermes_default:
            config_summary.append(f"model: {hermes_default}")

        return {
            # Surfaced so Hermes-only UI affordances (e.g. the §36 model-delete
            # button in the agent-town picker) can hide themselves on OpenClaw
            # without an extra status round-trip.
            "platform": "hermes",
            "auth_providers": _HERMES_AUTH_PROVIDERS,
            "model_providers": data.get("model_providers", []),
            "auth_profiles": [],
            "default_model": hermes_default,
            "channels": [],
            "skills": [],
            "hooks": [],
            "search_providers": SEARCH_PROVIDERS,
            "config_exists": _CONFIG_PATH.exists(),
            "config_summary": config_summary,
            # Per-provider hints the Hermes UI needs for the "pick a base URL"
            # step.  Kept in a single ``provider_endpoints`` bag so adding
            # similar fixes for other providers (moonshot .ai vs .cn, zai
            # coding vs paas, minimax .io vs .cn) later is a one-entry change
            # on both sides.  Today only ``alibaba`` ships presets; every
            # other Hermes provider keeps its single default.
            "provider_endpoints": {
                "alibaba": {
                    "env_key": _HERMES_DASHSCOPE_BASE_URL_ENV,
                    "current": _current_hermes_dashscope_base_url(),
                    "presets": _HERMES_DASHSCOPE_ENDPOINTS,
                },
            },
            "defaults": {
                "mode": "local",
                "gateway_port": settings.hermes_api_port,
                "gateway_bind": "loopback",
                "gateway_auth_mode": "token",
                "gateway_token": "",
                "tailscale_mode": "off",
                "workspace": str(_HERMES_DIR / "workspace"),
                "install_daemon": False,
                "remote_url": "",
                "remote_token": "",
                "enabled_hooks": [],
                "search_provider": "",
                "search_api_key": "",
            },
        }

    # ── OpenClaw path — full CLI scanning ─────────────────────────────────
    if refresh:
        _onboard_scan_cache.clear()
        _onboard_scan_version = ""

    version = _get_openclaw_version_sync()

    if _onboard_scan_cache and _onboard_scan_version == version and version:
        data = _onboard_scan_cache
    else:
        if _onboard_scan_task and not _onboard_scan_task.done():
            print("⏳ Waiting for background onboard-scan preload...")
            try:
                await asyncio.wait_for(asyncio.shield(_onboard_scan_task), timeout=150)
            except (asyncio.TimeoutError, Exception):
                pass

        if _onboard_scan_cache and _onboard_scan_version == version and version:
            data = _onboard_scan_cache
        else:
            data = await _build_onboard_scan_data()
            if version:
                _onboard_scan_cache = data
                _onboard_scan_version = version
                _save_scan_to_disk(data, version)

    model_providers = data.get("model_providers", [])
    auth_profiles = data.get("auth_profiles", [])
    default_model = data.get("default_model", "")
    channels = data.get("channels", [])
    skills = data.get("skills", [])
    hooks = data.get("hooks", [])

    current_config: dict = {}
    if _CONFIG_PATH.exists():
        try:
            current_config = json.loads(_CONFIG_PATH.read_text("utf-8"))
        except Exception:
            pass

    gw = current_config.get("gateway", {})
    remote_cfg = gw.get("remote", {}) if isinstance(gw.get("remote"), dict) else {}
    agents = current_config.get("agents", {}).get("defaults", {})
    hooks_cfg = current_config.get("hooks", {}).get("internal", {}).get("entries", {})
    search_cfg = current_config.get("tools", {}).get("web", {}).get("search", {})
    config_summary: list[str] = []
    ws_val = agents.get("workspace")
    if ws_val:
        config_summary.append(f"workspace: {ws_val}")
    primary_model = agents.get("model", {}).get("primary", "")
    if primary_model:
        config_summary.append(f"model: {primary_model}")
    gw_mode = gw.get("mode") or ("remote" if remote_cfg.get("url") else "local")
    if gw_mode:
        config_summary.append(f"gateway.mode: {gw_mode}")
    if gw.get("port"):
        config_summary.append(f"gateway.port: {gw['port']}")
    if gw.get("bind"):
        config_summary.append(f"gateway.bind: {gw['bind']}")
    remote_url = remote_cfg.get("url")
    if remote_url:
        config_summary.append(f"gateway.remote.url: {remote_url}")

    return {
        "auth_providers": _get_auth_providers_and_flags()[0],
        "model_providers": model_providers,
        "auth_profiles": auth_profiles,
        "default_model": default_model,
        "channels": channels,
        "skills": skills,
        "hooks": hooks,
        "search_providers": SEARCH_PROVIDERS,
        "config_exists": _CONFIG_PATH.exists(),
        "config_summary": config_summary,
        "defaults": {
            "mode": gw_mode,
            "gateway_port": gw.get("port", 18789),
            "gateway_bind": gw.get("bind", "loopback"),
            "gateway_auth_mode": gw.get("auth", {}).get("mode", "token"),
            "gateway_token": gw.get("auth", {}).get("token", ""),
            "tailscale_mode": gw.get("tailscale", {}).get("mode", "off"),
            "workspace": agents.get("workspace", str(_OPENCLAW_DIR / "workspace")),
            "install_daemon": True,
            "remote_url": remote_cfg.get("url", ""),
            "remote_token": remote_cfg.get("token", ""),
            "enabled_hooks": [k for k, v in hooks_cfg.items() if v.get("enabled")],
            "search_provider": search_cfg.get("provider", ""),
            "search_api_key": search_cfg.get("apiKey", ""),
        },
    }


# ──────────────────────────────────────────────
# Onboard Form — defaults & config write
# ──────────────────────────────────────────────

@router.get("/onboard-defaults")
async def onboard_defaults():
    """Return provider/model list and current config as form defaults."""
    current: dict = {}
    if _CONFIG_PATH.exists():
        try:
            current = json.loads(_CONFIG_PATH.read_text("utf-8"))
        except Exception:
            pass

    # Extract current values for pre-filling form
    gw = current.get("gateway", {})
    agents = current.get("agents", {}).get("defaults", {})
    hooks_cfg = current.get("hooks", {}).get("internal", {}).get("entries", {})
    # Detect current provider
    current_provider = ""
    current_model = ""
    primary_model = agents.get("model", {}).get("primary", "")
    if "/" in primary_model:
        current_provider = primary_model.split("/")[0]
        current_model = primary_model.split("/", 1)[1]

    enabled_hooks = [k for k, v in hooks_cfg.items() if v.get("enabled")]

    defaults = {
        "provider": current_provider,
        "model_id": current_model,
        "gateway_port": gw.get("port", 18789),
        "gateway_bind": gw.get("bind", "loopback"),
        "gateway_auth_mode": gw.get("auth", {}).get("mode", "token"),
        "gateway_token": gw.get("auth", {}).get("token", ""),
        "channels": [],
        "hooks": enabled_hooks,
        "workspace": agents.get("workspace", str(_OPENCLAW_DIR / "workspace")),
        "install_daemon": True,
        "tailscale_mode": gw.get("tailscale", {}).get("mode", "off"),
    }

    return {
        "providers": PROVIDERS,
        "hooks": AVAILABLE_HOOKS,
        "channels": AVAILABLE_CHANNELS,
        "defaults": defaults,
        "config_exists": _CONFIG_PATH.exists(),
    }


class OnboardConfigRequest(BaseModel):
    mode: str = "local"
    provider: str = ""
    api_key: str = ""
    model_id: str = ""
    gateway_port: int = Field(default=18789, ge=1, le=65535)
    gateway_bind: str = "loopback"
    gateway_auth_mode: str = "token"
    gateway_token: str = ""
    channels: list[str] = Field(default_factory=list)
    hooks: list[str] = Field(default_factory=list)
    workspace: str = "~/.openclaw/workspace"
    install_daemon: bool = True
    tailscale_mode: str = "off"
    search_provider: str = ""
    search_api_key: str = ""
    remote_url: str = ""
    remote_token: str = ""
    selected_skills: list[str] = Field(default_factory=list)
    feishu_app_id: str = ""
    feishu_app_secret: str = ""
    feishu_connection_mode: str = "websocket"
    feishu_domain: str = "feishu"
    feishu_group_policy: str = "open"
    feishu_group_allow_from: list[str] = Field(default_factory=list)
    feishu_verification_token: str = ""
    feishu_webhook_path: str = "/feishu/events"
    cf_account_id: str = ""
    cf_gateway_id: str = ""
    litellm_base_url: str = ""
    vllm_base_url: str = "http://127.0.0.1:8000/v1"
    vllm_model_id: str = ""
    custom_base_url: str = ""
    custom_model_id: str = ""
    custom_provider_id: str = ""
    custom_compatibility: str = "openai"


# _METHOD_CLI_FLAGS is now dynamically built by _get_auth_providers_and_flags()
# from each extension's openclaw.plugin.json → providerAuthChoices[].cliFlag.


def _normalize_model_input(value) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value or "").strip()
    if not text:
        return ["text"]
    return [part.strip() for part in text.split("+") if part.strip()]


def _lookup_catalog_model(model_id: str) -> tuple[str, dict] | None:
    target = str(model_id or "").strip()
    if not target:
        return None

    provider_hint = ""
    short_id = target
    if "/" in target:
        provider_hint, short_id = target.split("/", 1)

    if isinstance(_onboard_scan_cache, dict):
        for provider in _onboard_scan_cache.get("model_providers", []) or []:
            prov_id = str(provider.get("id", "")).strip()
            for model in provider.get("models", []) or []:
                candidate = str(model.get("id", "")).strip()
                if not candidate:
                    continue
                candidate_short = candidate.split("/", 1)[1] if "/" in candidate else candidate
                if candidate == target or (prov_id == provider_hint and candidate_short == short_id):
                    return prov_id or provider_hint, model

    for provider in PROVIDERS:
        prov_id = str(provider.get("id", "")).strip()
        if provider_hint and prov_id != provider_hint:
            continue
        for model in provider.get("models", []) or []:
            candidate = str(model.get("id", "")).strip()
            if not candidate:
                continue
            if candidate == target or candidate == short_id or f"{prov_id}/{candidate}" == target:
                return prov_id, model

    return None


def _ensure_selected_model_entry(config: dict, model_id: str) -> bool:
    target = str(model_id or "").strip()
    if not target:
        return False

    provider_key = ""
    short_id = target
    if "/" in target:
        provider_key, short_id = target.split("/", 1)

    lookup = _lookup_catalog_model(target)
    metadata: dict | None = None
    if lookup:
        provider_key = provider_key or lookup[0]
        metadata = lookup[1]

    if not provider_key:
        return False

    changed = False
    models_cfg = config.setdefault("models", {})
    providers = models_cfg.setdefault("providers", {})
    provider_cfg = providers.setdefault(provider_key, {})

    static_provider = next((provider for provider in PROVIDERS if provider.get("id") == provider_key), None)
    if static_provider:
        base_url = static_provider.get("baseUrl")
        api_kind = static_provider.get("api")
        if base_url and not provider_cfg.get("baseUrl"):
            provider_cfg["baseUrl"] = base_url
            changed = True
        if api_kind and not provider_cfg.get("api"):
            provider_cfg["api"] = api_kind
            changed = True

    models = provider_cfg.get("models")
    if not isinstance(models, list):
        provider_cfg["models"] = []
        models = provider_cfg["models"]
        changed = True

    existing_ids: set[str] = set()
    for existing in models:
        if not isinstance(existing, dict):
            continue
        raw_id = str(existing.get("id", "")).strip()
        if not raw_id:
            continue
        existing_ids.add(raw_id)
        existing_ids.add(raw_id if "/" in raw_id else f"{provider_key}/{raw_id}")

    if short_id in existing_ids or target in existing_ids:
        return changed

    entry = {
        "id": short_id,
        "name": short_id,
        "reasoning": False,
        "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
    }
    if metadata:
        entry["name"] = metadata.get("name", short_id)
        entry["reasoning"] = bool(metadata.get("reasoning", False))
        context_window = int(metadata.get("contextWindow", 0) or 0)
        if context_window:
            entry["contextWindow"] = context_window
        max_tokens = int(metadata.get("maxTokens", 0) or 0)
        if max_tokens:
            entry["maxTokens"] = max_tokens
        input_modes = _normalize_model_input(metadata.get("input"))
        if input_modes:
            entry["input"] = input_modes

    models.append(entry)
    return True


def _normalize_full_model_id(model_id: str, provider_hint: str = "") -> str:
    target = str(model_id or "").strip()
    if not target:
        return ""
    if "/" in target:
        return target
    if provider_hint:
        return f"{provider_hint}/{target}"

    lookup = _lookup_catalog_model(target)
    if lookup and lookup[0]:
        return f"{lookup[0]}/{target}"
    return target

def _load_explicit_model_ids() -> list[str]:
    if not _EXPLICIT_MODELS_PATH.exists():
        return []
    try:
        payload = json.loads(_EXPLICIT_MODELS_PATH.read_text("utf-8"))
    except Exception:
        return []

    raw_ids = payload.get("explicitModels", []) if isinstance(payload, dict) else payload
    if not isinstance(raw_ids, list):
        return []

    explicit_ids: list[str] = []
    seen: set[str] = set()
    for raw_id in raw_ids:
        full_id = _normalize_full_model_id(str(raw_id or "").strip())
        if not full_id or "/" not in full_id or full_id in seen:
            continue
        seen.add(full_id)
        explicit_ids.append(full_id)
    return explicit_ids


def _collect_explicit_model_ids(config: dict, *, ignore_provider: str = "") -> list[str]:
    explicit_ids = _load_explicit_model_ids()
    if explicit_ids:
        return explicit_ids

    explicit_ids = []
    seen: set[str] = set()
    providers_cfg = (
        config.get("models", {})
        .get("providers", {})
    )
    for provider_key, provider_cfg in providers_cfg.items():
        if ignore_provider and provider_key == ignore_provider:
            continue
        for model in provider_cfg.get("models", []) or []:
            if not isinstance(model, dict):
                continue
            full_id = _normalize_full_model_id(model.get("id", ""), provider_key)
            if not full_id or "/" not in full_id or full_id in seen:
                continue
            seen.add(full_id)
            explicit_ids.append(full_id)

    return explicit_ids


def _set_explicit_model_ids(model_ids: list[str]) -> bool:
    normalized: list[str] = []
    seen: set[str] = set()
    for model_id in model_ids:
        full_id = _normalize_full_model_id(model_id)
        if not full_id or "/" not in full_id or full_id in seen:
            continue
        seen.add(full_id)
        normalized.append(full_id)

    if _load_explicit_model_ids() == normalized:
        return False
    _EXPLICIT_MODELS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _EXPLICIT_MODELS_PATH.write_text(
        json.dumps({"explicitModels": normalized}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return True


def _strip_legacy_xsafeclaw_config(config: dict) -> bool:
    legacy = config.get("xsafeclaw")
    if legacy is None:
        return False

    if isinstance(legacy, dict):
        legacy_explicit_models = legacy.get("explicitModels")
        if isinstance(legacy_explicit_models, list):
            _set_explicit_model_ids([str(model_id or "").strip() for model_id in legacy_explicit_models])

    config.pop("xsafeclaw", None)
    return True


def sanitize_legacy_openclaw_config() -> bool:
    """Migrate/remove legacy XSafeClaw-only keys from openclaw.json."""
    if not _CONFIG_PATH.exists():
        return False
    try:
        config = json.loads(_CONFIG_PATH.read_text("utf-8"))
    except Exception:
        return False

    if not isinstance(config, dict):
        return False

    changed = _strip_legacy_xsafeclaw_config(config)
    if not changed:
        return False

    tmp = _CONFIG_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.rename(_CONFIG_PATH)
    return True


def _prune_configured_models_to_explicit_ids(config: dict, explicit_model_ids: list[str]) -> bool:
    normalized_ids: list[str] = []
    explicit_set: set[str] = set()
    for model_id in explicit_model_ids:
        full_id = _normalize_full_model_id(model_id)
        if not full_id or "/" not in full_id or full_id in explicit_set:
            continue
        explicit_set.add(full_id)
        normalized_ids.append(full_id)

    changed = False
    models_cfg = config.setdefault("models", {})
    providers_cfg = models_cfg.setdefault("providers", {})

    for provider_key, provider_cfg in providers_cfg.items():
        models = provider_cfg.get("models")
        if not isinstance(models, list):
            if any(model_id.startswith(f"{provider_key}/") for model_id in explicit_set):
                provider_cfg["models"] = []
                changed = True
            continue

        kept_models = []
        for model in models:
            if not isinstance(model, dict):
                changed = True
                continue
            full_id = _normalize_full_model_id(model.get("id", ""), provider_key)
            if full_id in explicit_set:
                kept_models.append(model)
            else:
                changed = True

        if kept_models != models:
            provider_cfg["models"] = kept_models
            changed = True

    for model_id in normalized_ids:
        if _ensure_selected_model_entry(config, model_id):
            changed = True

    agents = config.setdefault("agents", {})
    defaults = agents.setdefault("defaults", {})
    existing_defaults_models = defaults.get("models")
    next_defaults_models: dict[str, dict] = {}
    for model_id in normalized_ids:
        existing_entry = (
            existing_defaults_models.get(model_id)
            if isinstance(existing_defaults_models, dict)
            else None
        )
        next_defaults_models[model_id] = existing_entry if isinstance(existing_entry, dict) else {}
    if existing_defaults_models != next_defaults_models:
        defaults["models"] = next_defaults_models
        changed = True

    return changed


def _patch_config_extras(body: OnboardConfigRequest) -> None:
    """Merge fields not supported by --non-interactive into openclaw.json."""
    if not _CONFIG_PATH.exists():
        return
    try:
        config = json.loads(_CONFIG_PATH.read_text("utf-8"))
    except Exception:
        return

    changed = False
    if _strip_legacy_xsafeclaw_config(config):
        changed = True

    # Auth-method → (config provider key, baseUrl)
    _BASE_URL_OVERRIDES: dict[str, tuple[str, str]] = {
        # Moonshot
        "moonshot-api-key":          ("moonshot",     "https://api.moonshot.ai/v1"),
        "moonshot-api-key-cn":       ("moonshot",     "https://api.moonshot.cn/v1"),
        "kimi-code-api-key":         ("kimi-coding",  "https://api.kimi.com/coding/"),
        # Z.AI
        "zai-coding-global":         ("zai",          "https://api.z.ai/api/coding/paas/v4"),
        "zai-coding-cn":             ("zai",          "https://open.bigmodel.cn/api/coding/paas/v4"),
        "zai-global":                ("zai",          "https://api.z.ai/api/paas/v4"),
        "zai-cn":                    ("zai",          "https://open.bigmodel.cn/api/paas/v4"),
        # MiniMax
        "minimax-api":               ("minimax",      "https://api.minimax.io/anthropic"),
        "minimax-api-key-cn":        ("minimax-cn",   "https://api.minimaxi.com/anthropic"),
        "minimax-api-lightning":     ("minimax",      "https://api.minimax.io/anthropic"),
        # Model Studio
        "modelstudio-api-key-cn":    ("modelstudio",  "https://coding.dashscope.aliyuncs.com/v1"),
        "modelstudio-api-key":       ("modelstudio",  "https://coding-intl.dashscope.aliyuncs.com/v1"),
        # Other providers with fixed baseUrls
        "mistral-api-key":           ("mistral",      "https://api.mistral.ai/v1"),
        "xai-api-key":               ("xai",          "https://api.x.ai/v1"),
        "synthetic-api-key":         ("synthetic",    "https://api.synthetic.new/anthropic"),
        "venice-api-key":            ("venice",       "https://api.venice.ai/api/v1"),
        "together-api-key":          ("together",     "https://api.together.xyz/v1"),
        "huggingface-api-key":       ("huggingface",  "https://router.huggingface.co/v1"),
        "kilocode-api-key":          ("kilocode",     "https://api.kilo.ai/api/gateway/"),
        "qianfan-api-key":           ("qianfan",      "https://qianfan.baidubce.com/v2"),
        "ai-gateway-api-key":        ("vercel-ai-gateway", "https://ai-gateway.vercel.sh"),
        "opencode-zen":              ("opencode",     "https://opencode.ai/zen/v1"),
    }
    if body.provider in _BASE_URL_OVERRIDES:
        provider_key, base_url = _BASE_URL_OVERRIDES[body.provider]
        models_cfg = config.setdefault("models", {})
        providers = models_cfg.setdefault("providers", {})
        prov = providers.setdefault(provider_key, {})
        prov["baseUrl"] = base_url
        changed = True

    # Cloudflare AI Gateway — dynamic baseUrl from account/gateway IDs
    if body.provider == "cloudflare-ai-gateway-api-key" and body.cf_account_id and body.cf_gateway_id:
        cf_url = f"https://gateway.ai.cloudflare.com/v1/accounts/{body.cf_account_id}/gateways/{body.cf_gateway_id}"
        models_cfg = config.setdefault("models", {})
        providers = models_cfg.setdefault("providers", {})
        prov = providers.setdefault("cloudflare-ai-gateway", {})
        prov["baseUrl"] = cf_url
        changed = True

    # LiteLLM — custom baseUrl (default: http://localhost:4000)
    if body.provider == "litellm-api-key" and body.litellm_base_url:
        models_cfg = config.setdefault("models", {})
        providers = models_cfg.setdefault("providers", {})
        prov = providers.setdefault("litellm", {})
        prov["baseUrl"] = body.litellm_base_url
        changed = True

    # vLLM — full config (interactive-only in CLI, so we write directly)
    if body.provider == "vllm" and body.vllm_base_url:
        models_cfg = config.setdefault("models", {})
        providers = models_cfg.setdefault("providers", {})
        vllm_cfg = providers.setdefault("vllm", {})
        vllm_cfg["baseUrl"] = body.vllm_base_url.rstrip("/")
        vllm_cfg["api"] = "openai-completions"
        if body.api_key:
            vllm_cfg["apiKey"] = body.api_key
        if body.vllm_model_id:
            vllm_cfg["models"] = [{
                "id": body.vllm_model_id,
                "name": f"{body.vllm_model_id} (vLLM)",
                "contextWindow": 128000,
                "maxTokens": 8192,
                "input": ["text"],
                "reasoning": False,
                "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
            }]
            if not body.model_id:
                body.model_id = f"vllm/{body.vllm_model_id}"
        changed = True

    # Custom provider — full config (needs URL + model + compatibility)
    if body.provider == "custom-api-key" and body.custom_base_url and body.custom_model_id:
        prov_id = body.custom_provider_id.strip()
        if not prov_id:
            try:
                from urllib.parse import urlparse
                parsed = urlparse(body.custom_base_url)
                host = re.sub(r"[^a-z0-9]+", "-", parsed.hostname or "custom").strip("-")
                port = f"-{parsed.port}" if parsed.port else ""
                prov_id = f"custom-{host}{port}" or "custom"
            except Exception:
                prov_id = "custom"
        api_type = "anthropic-messages" if body.custom_compatibility == "anthropic" else "openai-completions"
        models_cfg = config.setdefault("models", {})
        providers = models_cfg.setdefault("providers", {})
        custom_cfg = providers.setdefault(prov_id, {})
        custom_cfg["baseUrl"] = body.custom_base_url.rstrip("/")
        custom_cfg["api"] = api_type
        if body.api_key:
            custom_cfg["apiKey"] = body.api_key
        custom_cfg["models"] = [{
            "id": body.custom_model_id,
            "name": f"{body.custom_model_id} (Custom Provider)",
            "contextWindow": 8192,
            "maxTokens": 4096,
            "input": ["text"],
            "reasoning": False,
            "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
        }]
        if not body.model_id:
            body.model_id = f"{prov_id}/{body.custom_model_id}"
        changed = True

    # Model ID override (CLI picks the provider default; user may want a specific model)
    if body.model_id:
        normalized_model_id = _normalize_full_model_id(body.model_id)
        target_provider = normalized_model_id.split("/", 1)[0] if "/" in normalized_model_id else ""
        explicit_model_ids = _collect_explicit_model_ids(config, ignore_provider=target_provider)
        explicit_model_ids.append(normalized_model_id or body.model_id)
        if _set_explicit_model_ids(explicit_model_ids):
            changed = True
        if _prune_configured_models_to_explicit_ids(config, explicit_model_ids):
            changed = True
        agents = config.setdefault("agents", {})
        defaults = agents.setdefault("defaults", {})
        defaults.setdefault("model", {})["primary"] = normalized_model_id or body.model_id
        changed = True

    # Channels — Feishu (full config mirroring source onboarding adapter)
    if "feishu" in body.channels and body.feishu_app_id and body.feishu_app_secret:
        channels = config.setdefault("channels", {})
        feishu_cfg: dict = {**channels.get("feishu", {})}
        feishu_cfg["enabled"] = True
        feishu_cfg["appId"] = body.feishu_app_id
        feishu_cfg["appSecret"] = body.feishu_app_secret
        feishu_cfg["connectionMode"] = body.feishu_connection_mode or "websocket"
        feishu_cfg["domain"] = body.feishu_domain or "feishu"
        feishu_cfg["groupPolicy"] = body.feishu_group_policy or "open"
        if body.feishu_group_policy == "allowlist" and body.feishu_group_allow_from:
            feishu_cfg["groupAllowFrom"] = body.feishu_group_allow_from
        if body.feishu_connection_mode == "webhook":
            if body.feishu_verification_token:
                feishu_cfg["verificationToken"] = body.feishu_verification_token
            feishu_cfg["webhookPath"] = body.feishu_webhook_path or "/feishu/events"
        channels["feishu"] = feishu_cfg
        changed = True

    # Hooks
    if body.hooks:
        config["hooks"] = {
            "internal": {
                "enabled": True,
                "entries": {h: {"enabled": True} for h in body.hooks},
            },
        }
        changed = True

    # Search provider — each provider stores its API key at a different path
    if body.search_provider:
        tools = config.setdefault("tools", {})
        web = tools.setdefault("web", {})
        search: dict = {**web.get("search", {}), "provider": body.search_provider, "enabled": True}
        if body.search_api_key:
            if body.search_provider == "brave":
                search["apiKey"] = body.search_api_key
            else:
                nested = search.setdefault(body.search_provider, {})
                nested["apiKey"] = body.search_api_key
        web["search"] = search
        changed = True

    # XSafeClaw Guard plugin — always register
    plugins = config.setdefault("plugins", {})
    entries = plugins.setdefault("entries", {})
    if "safeclaw-guard" not in entries or not isinstance(entries.get("safeclaw-guard"), dict):
        entries["safeclaw-guard"] = {
            "enabled": True,
            "config": {"safeclawUrl": "http://localhost:6874"},
        }
        changed = True
    elif not entries["safeclaw-guard"].get("enabled"):
        entries["safeclaw-guard"]["enabled"] = True
        changed = True

    if changed:
        tmp = _CONFIG_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(_CONFIG_PATH)
        try:
            _CONFIG_PATH.touch()
        except OSError:
            pass


async def _auto_approve_devices() -> None:
    """Auto-approve any pending OpenClaw device pairing requests."""
    from ...gateway_client import auto_approve_pending_devices
    try:
        approved = await auto_approve_pending_devices()
        if approved:
            print(f"🔑 Auto-approved {len(approved)} device(s) during configuration")
    except Exception as e:
        print(f"⚠️  Device auto-approve skipped: {e}")


def _install_safeclaw_guard_plugin() -> None:
    """Install the XSafeClaw guard plugin for the active platform.

    - **OpenClaw**: copies TS plugin to ``~/.openclaw/extensions/safeclaw-guard/``
    - **Hermes**: copies Python plugin to ``~/.hermes/plugins/safeclaw-guard/``
    """
    plugins_root = Path(__file__).resolve().parent.parent.parent.parent.parent / "plugins"

    if settings.is_hermes:
        src_dir = plugins_root / "safeclaw-guard-hermes"
        if not src_dir.is_dir():
            return
        dst_dir = _HERMES_DIR / "plugins" / "safeclaw-guard"
        dst_dir.mkdir(parents=True, exist_ok=True)
        for fname in ("__init__.py", "plugin.yaml"):
            src_file = src_dir / fname
            if src_file.exists():
                shutil.copy2(src_file, dst_dir / fname)
    else:
        src_dir = plugins_root / "safeclaw-guard"
        if not src_dir.is_dir():
            return
        dst_dir = _OPENCLAW_DIR / "extensions" / "safeclaw-guard"
        dst_dir.mkdir(parents=True, exist_ok=True)
        for fname in ("index.ts", "openclaw.plugin.json", "package.json"):
            src_file = src_dir / fname
            if src_file.exists():
                shutil.copy2(src_file, dst_dir / fname)


def _deploy_safety_files(workspace: str) -> None:
    """Deploy SAFETY.md and PERMISSION.md into the agent workspace.

    Only writes files that don't already exist so user customizations are preserved.
    """
    templates_dir = Path(__file__).resolve().parent.parent.parent / "data" / "templates"
    ws = Path(workspace).expanduser()
    if not ws.is_dir():
        ws.mkdir(parents=True, exist_ok=True)

    for fname in ("SAFETY.md", "PERMISSION.md"):
        dst = ws / fname
        if dst.exists():
            continue
        src = templates_dir / fname
        if src.exists():
            shutil.copy2(src, dst)


class FeishuTestRequest(BaseModel):
    app_id: str
    app_secret: str
    domain: str = "feishu"


@router.post("/feishu-test")
async def feishu_test(body: FeishuTestRequest):
    """Test Feishu/Lark credentials by calling /open-apis/bot/v3/info."""
    import httpx as _httpx

    base_urls = {
        "feishu": "https://open.feishu.cn",
        "lark": "https://open.larksuite.com",
    }
    base = base_urls.get(body.domain, body.domain)
    token_url = f"{base}/open-apis/auth/v3/tenant_access_token/internal"
    bot_url = f"{base}/open-apis/bot/v3/info"

    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                token_url,
                json={"app_id": body.app_id, "app_secret": body.app_secret},
            )
            data = resp.json()
            if data.get("code") != 0:
                return {
                    "ok": False,
                    "error": data.get("msg", f"token error code {data.get('code')}"),
                }
            token = data["tenant_access_token"]

            resp = await client.get(
                bot_url,
                headers={"Authorization": f"Bearer {token}"},
            )
            info = resp.json()
            if info.get("code") != 0:
                return {
                    "ok": False,
                    "error": info.get("msg", f"bot info error code {info.get('code')}"),
                }
            bot = info.get("bot") or (info.get("data") or {}).get("bot") or {}
            return {
                "ok": True,
                "bot_name": bot.get("bot_name"),
                "bot_open_id": bot.get("open_id"),
            }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@router.get("/provider-has-key")
async def provider_has_key(provider: str = ""):
    """Return whether a provider already has a saved API key (no key content exposed)."""
    provider = provider.strip()
    if not provider:
        return {"has_key": False}

    if settings.is_hermes:
        return {"has_key": _hermes_provider_has_key(provider)}

    _AGENT_STATE_DIR = _OPENCLAW_DIR / "agents" / "main" / "agent"

    profiles_path = _AGENT_STATE_DIR / "auth-profiles.json"
    if profiles_path.exists():
        try:
            profiles_data = json.loads(profiles_path.read_text("utf-8"))
            for _pid, profile in (profiles_data.get("profiles") or {}).items():
                if not isinstance(profile, dict):
                    continue
                if profile.get("provider") == provider and str(profile.get("key", "")).strip():
                    return {"has_key": True}
        except Exception:
            pass

    if _CONFIG_PATH.exists():
        try:
            config = json.loads(_CONFIG_PATH.read_text("utf-8"))
            prov_cfg = config.get("models", {}).get("providers", {}).get(provider, {})
            if isinstance(prov_cfg, dict) and str(prov_cfg.get("apiKey", "")).strip():
                return {"has_key": True}
        except Exception:
            pass

    return {"has_key": False}


def _hermes_provider_has_key(provider_or_method: str) -> bool:
    """Check ~/.hermes/.env for a provider's API key."""
    raw_provider = re.sub(r"-api-key$", "", provider_or_method)
    env_var = _HERMES_PROVIDER_ENV_KEYS.get(raw_provider, "")
    if not env_var:
        return False

    hermes_env_path = _HERMES_DIR / ".env"
    if not hermes_env_path.exists():
        return False
    try:
        for line in hermes_env_path.read_text("utf-8").splitlines():
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            if stripped.startswith(f"{env_var}="):
                val = stripped.split("=", 1)[1].strip().strip("'\"")
                if val:
                    return True
    except Exception:
        pass
    return False


class QuickModelConfigRequest(BaseModel):
    provider: str
    api_key: str = ""
    model_id: str
    # Optional Hermes-side endpoint override.  Currently only the ``alibaba``
    # provider consumes it (see §33 — Hermes's hardcoded ``coding-intl``
    # default traps standard DashScope keys); other providers ignore it.  The
    # string is written verbatim into ``~/.hermes/.env`` under the per-provider
    # env var (``DASHSCOPE_BASE_URL`` for alibaba), so callers must pass a
    # fully-qualified URL — no path concatenation, no trailing-slash fixups.
    base_url: str = ""
    # When True (default), Hermes path auto-restarts the API server after
    # writing ~/.hermes/.env + config.yaml and polls /v1/models to confirm
    # the new model is visible. Set False to batch multiple edits and call
    # POST /system/hermes/apply yourself.
    auto_apply: bool = True


class RemoveConfiguredModelRequest(BaseModel):
    """Body for ``POST /system/hermes/configured-models/delete``.

    Either ``model_id`` (the prefixed ``slug/bare_id`` form the CMD-UI
    already carries in its picker state) or the explicit ``slug`` +
    ``bare_id`` pair can be passed.  ``model_id`` takes precedence when
    both are supplied; we split it on the first ``/`` to recover the
    routing slug, which is the same convention §34 / §35 use everywhere
    else in the Hermes branch.
    """

    model_id: str = ""
    slug: str = ""
    bare_id: str = ""


@router.post("/hermes/configured-models/delete")
async def delete_configured_model(body: RemoveConfiguredModelRequest):
    """Remove one entry from XSafeClaw's per-user configured-model ledger.

    Hermes-only.  Refuses to delete the model currently active in
    ``~/.hermes/config.yaml::model.default`` so we never leave Hermes
    pointing at a model the picker won't show.  Does **not** touch
    ``~/.hermes/.env`` — the provider's API key stays so any agent that
    was already created with this ``model_id`` keeps working.

    See §36.
    """
    if not settings.is_hermes:
        raise HTTPException(
            status_code=400,
            detail="Configured-model deletion is only available on the Hermes platform.",
        )

    # 1. Resolve (slug, bare_id) from whichever shape the caller used.
    slug = (body.slug or "").strip()
    bare_id = (body.bare_id or "").strip()
    if body.model_id:
        full = body.model_id.strip()
        if "/" in full:
            split_slug, split_bare = full.split("/", 1)
            slug = slug or split_slug
            bare_id = bare_id or split_bare
        else:
            # No slash: treat the whole thing as bare_id and require
            # callers to also pass an explicit slug.  Hermes-side ids
            # should always be prefixed (post-§35 the ledger normalises
            # this), so this branch is only hit by hand-rolled requests.
            bare_id = bare_id or full
    if not slug or not bare_id:
        raise HTTPException(
            status_code=400,
            detail="Missing model_id (or slug + bare_id).",
        )

    # 2. Refuse if the request targets the currently active model.
    #
    # Why refuse instead of also clearing config.yaml::model.default:
    # leaving model.default empty makes Hermes fall back to its own
    # "auto-detect main provider" path, which is exactly the lottery
    # that produced the §35 Kimi-zombie surprise.  Forcing the user to
    # explicitly switch active first keeps the deletion path side-effect-free.
    active_slug = ""
    active_bare = ""
    if _CONFIG_PATH.exists():
        try:
            import yaml as _yaml_lib
            cfg_yaml = _yaml_lib.safe_load(_CONFIG_PATH.read_text("utf-8")) or {}
            mcfg = cfg_yaml.get("model", "")
            if isinstance(mcfg, dict):
                active_bare = str(mcfg.get("default", "") or mcfg.get("model", "")).strip()
                active_slug = str(mcfg.get("provider", "") or "").strip()
        except Exception:
            pass

    if active_slug == slug and active_bare == bare_id:
        raise HTTPException(
            status_code=409,
            detail=(
                "Cannot delete the model that is currently active in "
                "~/.hermes/config.yaml. Switch to a different model first, "
                "then delete this one."
            ),
        )

    # 3. Remove from the ledger.
    removed = _remove_xs_configured_model(slug=slug, bare_id=bare_id)

    # 4. Drop caches so the next /api/chat/available-models read reflects
    #    the change immediately rather than after the 30 s TTL.  Same
    #    invalidation pair _quick_model_config_hermes uses.
    try:
        from .chat import _available_models_cache
        _available_models_cache["expires_at"] = 0.0
    except Exception:
        pass
    _invalidate_hermes_configured_cache()

    return {
        "success": True,
        "removed": removed,
        "slug": slug,
        "bare_id": bare_id,
    }


@router.post("/quick-model-config")
async def quick_model_config(body: QuickModelConfigRequest):
    """Fast-path model configuration.

    - **Hermes**: writes API key to ``~/.hermes/.env`` and model/provider
      to ``config.yaml`` directly — no CLI needed.
    - **OpenClaw**: runs a minimal ``openclaw onboard`` invocation for the
      key and patches the model into ``openclaw.json``.
    """
    if not body.model_id or not body.provider:
        raise HTTPException(status_code=400, detail="provider and model_id are required")

    if settings.is_hermes:
        return await _quick_model_config_hermes(body)

    # ── OpenClaw path ─────────────────────────────────────────────────────
    openclaw_path = _find_openclaw()
    if not openclaw_path:
        raise HTTPException(status_code=500, detail="openclaw binary not found")

    env = _build_env()

    cli_output = ""
    if body.api_key:
        _, method_cli_flags = _get_auth_providers_and_flags()
        cli_flag = method_cli_flags.get(body.provider)
        if cli_flag:
            current: dict = {}
            if _CONFIG_PATH.exists():
                try:
                    current = json.loads(_CONFIG_PATH.read_text("utf-8"))
                except Exception:
                    pass
            gw = current.get("gateway", {})
            args: list[str] = [
                openclaw_path, "onboard", "--non-interactive", "--accept-risk",
                cli_flag, body.api_key,
                "--gateway-port", str(gw.get("port", 18789)),
                "--gateway-bind", gw.get("bind", "loopback"),
                "--gateway-auth", gw.get("auth", {}).get("mode", "token"),
                "--no-install-daemon",
                "--skip-channels", "--skip-skills",
                "--skip-search", "--skip-health", "--skip-ui",
            ]
            gw_token = gw.get("auth", {}).get("token", "")
            if gw_token:
                args += ["--gateway-token", gw_token]

            try:
                proc = await asyncio.create_subprocess_exec(
                    *args,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    stdin=asyncio.subprocess.DEVNULL,
                    env=env,
                )
                stdout_bytes, _ = await asyncio.wait_for(proc.communicate(), timeout=90)
                cli_output = stdout_bytes.decode("utf-8", errors="replace").strip()
                if proc.returncode != 0:
                    raise HTTPException(
                        status_code=500,
                        detail=f"openclaw key setup failed (exit {proc.returncode}):\n{cli_output}",
                    )
            except asyncio.TimeoutError:
                raise HTTPException(status_code=500, detail="openclaw key setup timed out")

    full_body = OnboardConfigRequest(
        provider=body.provider,
        api_key=body.api_key,
        model_id=body.model_id,
    )
    _patch_config_extras(full_body)

    try:
        from .chat import _available_models_cache
        _available_models_cache["expires_at"] = 0.0
    except Exception:
        pass
    try:
        _CONFIG_PATH.touch()
    except OSError:
        pass

    trigger_onboard_scan_preload(force=True)

    model_ready = False
    if body.model_id:
        from .chat import _extract_runtime_model_list, _runtime_catalog_match
        from ...gateway_client import GatewayClient
        for _attempt in range(5):
            await asyncio.sleep(0.8)
            try:
                client = GatewayClient()
                await asyncio.wait_for(client.connect(), timeout=5)
                raw = await asyncio.wait_for(client.list_models(), timeout=5)
                await client.disconnect()
                catalog = _extract_runtime_model_list(raw)
                found, _ = _runtime_catalog_match(catalog, body.model_id)
                if found:
                    model_ready = True
                    break
            except Exception:
                try:
                    await client.disconnect()
                except Exception:
                    pass

    return {"success": True, "fast_path": True, "model_ready": model_ready, "output": cli_output}


async def _quick_model_config_hermes(body: QuickModelConfigRequest) -> dict:
    """Hermes fast-path: write API key to .env and model to config.yaml."""
    import yaml as _yaml

    # Ensure the Hermes HTTP API listener is enabled before we try to apply
    # the new model config. Without API_SERVER_ENABLED=true, /health never
    # binds and the subsequent restart/readiness probe would time out.
    # Idempotent — only writes when the flag is missing or false.
    _ensure_hermes_api_server_env()

    # Strip the "-api-key" suffix that the frontend auth method ID carries
    # (e.g. "anthropic-api-key" → "anthropic")
    raw_provider = re.sub(r"-api-key$", "", body.provider)

    # --- 1. Write API key to ~/.hermes/.env ---
    env_var_name = _HERMES_PROVIDER_ENV_KEYS.get(raw_provider, "")
    if body.api_key and env_var_name:
        hermes_env_path = _HERMES_DIR / ".env"
        _HERMES_DIR.mkdir(parents=True, exist_ok=True)

        existing_lines: list[str] = []
        if hermes_env_path.exists():
            existing_lines = hermes_env_path.read_text("utf-8").splitlines()

        replaced = False
        new_lines: list[str] = []
        for line in existing_lines:
            stripped = line.strip()
            if stripped.startswith(f"{env_var_name}=") or stripped.startswith(f"# {env_var_name}="):
                new_lines.append(f"{env_var_name}={body.api_key}")
                replaced = True
            else:
                new_lines.append(line)

        if not replaced:
            new_lines.append(f"{env_var_name}={body.api_key}")

        hermes_env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")

    # --- 1b. Persist per-provider base-URL override (§33 — DashScope trap) ---
    #
    # Today only ``alibaba`` uses this branch.  We gate on the provider slug
    # rather than "is base_url non-empty" so a stray value on a request for
    # some other provider can't accidentally write a bogus DASHSCOPE_BASE_URL.
    # When the UI leaves the field blank we *don't* delete an existing value —
    # that would silently regress users who hand-edited the dotenv to some
    # custom proxy URL.  Removal is an explicit action; that can come later.
    base_url_clean = (body.base_url or "").strip()
    if raw_provider == "alibaba" and base_url_clean:
        _upsert_dotenv_line(
            _hermes_env_path(),
            _HERMES_DASHSCOPE_BASE_URL_ENV,
            base_url_clean,
        )

    # --- 2. Write model + provider to config.yaml ---
    config: dict = {}
    if _CONFIG_PATH.exists():
        try:
            config = _yaml.safe_load(_CONFIG_PATH.read_text("utf-8")) or {}
        except Exception:
            config = {}

    # Split the incoming "<slug>/<bare_id>" id back into the two fields
    # Hermes's ``config.yaml`` expects — ``model.provider`` for routing and
    # ``model.default`` for the **bare** id to forward to the upstream API.
    #
    # Prior behaviour wrote the full slug-prefixed string into
    # ``model.default`` (e.g. ``openrouter/anthropic/claude-opus-4.7``).  That
    # mis-matches Hermes's contract: the ``auxiliary_client`` takes
    # ``model.default`` verbatim as the outbound model id, so OpenRouter (and
    # any other provider whose bare ids already contain a ``/``) rejected the
    # double-prefixed string with ``"... is not a valid model ID"`` and the
    # agent returned ``[No response]``.  See §34 for the full trace.
    #
    # ``split("/", 1)`` cuts only the first ``/``, so aggregator bare ids with
    # their own ``vendor/model`` form (``anthropic/claude-opus-4.7``,
    # ``openai/gpt-5.4-mini``) survive intact and get written correctly.
    model_id = body.model_id
    if "/" in model_id:
        hermes_provider, hermes_model = model_id.split("/", 1)
    else:
        hermes_provider = raw_provider
        hermes_model = model_id

    config["model"] = {
        "default": hermes_model,
        "provider": hermes_provider,
    }

    _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    _CONFIG_PATH.write_text(
        _yaml.dump(config, default_flow_style=False, allow_unicode=True),
        encoding="utf-8",
    )

    # --- 2.5. Persist user pick to XSafeClaw ledger (§35) ---
    # ``config.yaml::model.default`` only stores the most recent pick — the
    # next save overwrites it and the previous selection is lost.  We need
    # the CMD-UI's Create-Agent picker to remember **every** model the user
    # has explicitly configured so it survives both restarts and
    # configure-another-provider flows.  See ``_record_xs_configured_model``
    # for the file-format contract.
    _record_xs_configured_model(
        slug=hermes_provider,
        model_id=body.model_id,
        bare_id=hermes_model,
        name=hermes_model,
    )

    # --- 3. Invalidate caches ---
    try:
        from .chat import _available_models_cache
        _available_models_cache["expires_at"] = 0.0
    except Exception:
        pass
    # Drop the Hermes configured-providers probe cache too. Otherwise the
    # CMD-UI could keep showing the pre-edit deck for up to 30s after
    # quick-model-config writes to ~/.hermes/.env + config.yaml.
    _invalidate_hermes_configured_cache()

    # --- 4. Apply: restart Hermes API server + verify readiness ---
    # Mirrors the OpenClaw fast-path, which relies on `openclaw onboard`
    # telling the long-running gateway daemon to reload. Hermes lacks a
    # hot-reload path, so we restart the API server and then poll
    # /v1/models until the newly configured model_id is visible.
    #
    # We always call _restart_hermes_api_server() when auto_apply is True,
    # even if the API wasn't running before. That function's step 4
    # (detached spawn of `hermes gateway`) doubles as a cold-start path —
    # without this, CMD-UI users who have never opened Configure would
    # never get "configure-and-use": the flag would be flipped in .env but
    # nothing would restart to pick it up.
    output = ""
    restart_ok = True
    api_was_running = await _hermes_api_reachable()

    if body.auto_apply:
        restart_ok, output = await _restart_hermes_api_server()
        if restart_ok and body.model_id:
            ready, _ = await _wait_hermes_runtime_ready(body.model_id, timeout_s=8.0)
            model_ready = ready
        else:
            model_ready = restart_ok
        if not restart_ok and not api_was_running:
            # Surface a clearer message when this was a cold-start attempt
            # rather than a restart-of-a-running-server. The detail log from
            # _restart_hermes_api_server is still appended in ``output`` so
            # the frontend can display systemctl/hermes CLI errors verbatim.
            output = (
                f"Hermes API server on 127.0.0.1:{settings.hermes_api_port} was "
                "not running and we could not start it automatically. Config is "
                "saved to ~/.hermes/.env + config.yaml. Open XSafeClaw's "
                "Configure page for a one-click fix, or run `hermes gateway` "
                "manually after making sure ~/.hermes/.env has "
                "API_SERVER_ENABLED=true.\n\n" + output
            )
    else:
        # auto_apply=False: caller will explicitly POST /system/hermes/apply.
        model_ready = False

    return {
        "success": True,
        "fast_path": True,
        "model_ready": model_ready,
        # "applied" now covers both "restarted a live server" and
        # "cold-started a stopped server" — the caller (CMD UI / Configure)
        # only cares whether the new config is live, not which code path
        # produced the running listener.
        "applied": bool(body.auto_apply and restart_ok),
        "api_was_running": api_was_running,
        "api_reachable": await _hermes_api_reachable(),
        "output": output,
    }


@router.post("/onboard-config")
async def onboard_config(body: OnboardConfigRequest):
    """Configure the agent platform.

    - **Hermes**: delegates to the same fast-path as ``quick-model-config``.
    - **OpenClaw**: runs ``openclaw onboard --non-interactive``.
    """
    if settings.is_hermes:
        quick_body = QuickModelConfigRequest(
            provider=body.provider or "",
            api_key=body.api_key or "",
            model_id=body.model_id or "",
        )
        result = await _quick_model_config_hermes(quick_body)
        _install_safeclaw_guard_plugin()
        return {
            "success": True,
            "config_path": str(_CONFIG_PATH),
            "workspace": str(_HERMES_DIR / "workspace"),
            "output": result.get("output", ""),
        }

    openclaw_path = _find_openclaw()
    if not openclaw_path:
        raise HTTPException(
            status_code=500,
            detail="openclaw binary not found. Run Setup first.",
        )

    env = _build_env()

    # ── Build CLI argument list ──────────────────────────────────────────
    args: list[str] = [
        openclaw_path, "onboard",
        "--non-interactive", "--accept-risk",
    ]

    # Mode
    if body.mode:
        args += ["--mode", body.mode]

    # Workspace
    if body.workspace:
        args += ["--workspace", body.workspace]

    # Provider API key (provider field now carries the method ID, e.g. "openai-api-key")
    # vLLM and custom are handled entirely by _patch_config_extras (vLLM rejects non-interactive)
    _PATCH_ONLY_PROVIDERS = {"vllm", "custom-api-key"}
    _, method_cli_flags = _get_auth_providers_and_flags()
    if body.provider and body.provider != "skip" and body.provider not in _PATCH_ONLY_PROVIDERS and body.api_key:
        cli_flag = method_cli_flags.get(body.provider)
        if cli_flag:
            args += [cli_flag, body.api_key]

    # Gateway
    args += ["--gateway-port", str(body.gateway_port)]
    if body.gateway_bind:
        args += ["--gateway-bind", body.gateway_bind]
    if body.gateway_auth_mode:
        args += ["--gateway-auth", body.gateway_auth_mode]
    if body.gateway_token:
        args += ["--gateway-token", body.gateway_token]

    # Remote gateway
    if body.mode == "remote":
        if body.remote_url:
            args += ["--remote-url", body.remote_url]
        if body.remote_token:
            args += ["--remote-token", body.remote_token]

    # Tailscale
    if body.tailscale_mode and body.tailscale_mode != "off":
        args += ["--tailscale", body.tailscale_mode]

    # Daemon
    if body.install_daemon and body.mode == "local":
        args += ["--install-daemon"]
    else:
        args += ["--no-install-daemon"]

    # Skip features handled by _patch_config_extras
    args += [
        "--skip-channels", "--skip-skills",
        "--skip-search", "--skip-health", "--skip-ui",
    ]

    # ── Execute ──────────────────────────────────────────────────────────
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            stdin=asyncio.subprocess.DEVNULL,
            env=env,
        )
        stdout_bytes, _ = await asyncio.wait_for(proc.communicate(), timeout=500)
        output = stdout_bytes.decode("utf-8", errors="replace").strip()

        if proc.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"openclaw onboard failed (exit {proc.returncode}):\n{output}",
            )
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=500,
            detail="openclaw onboard timed out after 120 seconds",
        )

    # ── Post-patch extras not supported by CLI flags ─────────────────────
    _patch_config_extras(body)

    # ── Install XSafeClaw Guard plugin into OpenClaw extensions ─────────
    _install_safeclaw_guard_plugin()

    # ── Deploy SAFETY.md & PERMISSION.md into workspace ──────────────
    _deploy_safety_files(body.workspace)

    # ── Auto-approve pending device pairing requests ─────────────────
    await _auto_approve_devices()

    try:
        from .chat import _available_models_cache
        _available_models_cache["expires_at"] = 0.0
    except Exception:
        pass

    try:
        _CONFIG_PATH.touch()
    except OSError:
        pass

    # Refresh onboard-scan cache in background (don't block the response)
    trigger_onboard_scan_preload(force=True)

    workspace = str(Path(body.workspace).expanduser())
    return {
        "success": True,
        "config_path": str(_CONFIG_PATH),
        "workspace": workspace,
        "output": output,
    }
