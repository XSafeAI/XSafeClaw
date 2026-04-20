"""Shared server-start supervisor (§38).

Both entry points into XSafeClaw — ``xsafeclaw start`` (``cli.py``) and
``python -m xsafeclaw`` (``__main__.py``, invoked by ``start.sh``) — need the
same behaviour:

  * when only one agent framework is installed, or ``--platform`` / the
    ``PLATFORM`` env var pins a choice, launch the main uvicorn server
    directly (preserves the pre-§38 behaviour);
  * when both frameworks are installed and no pin is set, spawn a picker
    subprocess with ``XSAFECLAW_PICKER_MODE=1``, wait for the user to choose
    a framework via the SelectFramework page, then spawn the main server
    with ``PLATFORM`` fixed to the chosen value.

Keeping this logic in a module that imports neither ``typer`` nor ``fastapi``
avoids a circular dependency between ``cli.py`` / ``__main__.py`` / the API
package, and keeps ``python -m xsafeclaw`` startup cost low.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional


DATA_DIR = Path.home() / ".xsafeclaw"

# Kept in sync with ``api/main.py`` and ``api/routes/system.py``.
PICKER_EXIT_CODE = 42
PICKER_MODE_ENV = "XSAFECLAW_PICKER_MODE"


def _ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def runtime_platform_pin_path() -> Path:
    return DATA_DIR / ".runtime-platform-pin"


def detect_installed_platforms() -> list[str]:
    """Return the agent frameworks installed on this machine.

    Matches the heuristic in ``xsafeclaw.config._detect_platform``: a framework
    is considered installed when either its binary is on PATH or its home
    directory exists. Kept free of FastAPI / pydantic imports so the CLI path
    stays fast.
    """
    installed: list[str] = []
    openclaw_home = Path.home() / ".openclaw"
    hermes_home = Path.home() / ".hermes"

    if openclaw_home.is_dir() or shutil.which("openclaw"):
        installed.append("openclaw")
    if hermes_home.is_dir() or shutil.which("hermes"):
        installed.append("hermes")
    return installed


def read_and_clear_pin() -> Optional[str]:
    """Return the user's platform choice and delete the pin file.

    Always deletes the file on the way out so a stale pin from a previous
    aborted session cannot silently override a later picker result. Only
    returns a value when the pin contents are strictly ``"openclaw"`` or
    ``"hermes"``.
    """
    pin = runtime_platform_pin_path()
    if not pin.is_file():
        return None
    try:
        value = pin.read_text(encoding="utf-8").strip()
    except OSError:
        value = ""
    finally:
        try:
            pin.unlink()
        except OSError:
            pass
    return value if value in {"openclaw", "hermes"} else None


def _run_picker_subprocess(host: str, port: int) -> int:
    """Spawn the picker server as a child process and return its exit code.

    The child inherits stdout/stderr so uvicorn logs still reach whatever
    file/terminal the parent was writing to (including ``nohup ... > log``
    from ``start.sh``). The parent's own environment is left untouched so
    the main-server run that follows is free of picker-mode state.
    """
    env = os.environ.copy()
    env[PICKER_MODE_ENV] = "1"
    cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "xsafeclaw.api.main:app",
        "--host",
        host,
        "--port",
        str(port),
        "--log-level",
        "info",
    ]
    proc = subprocess.Popen(cmd, env=env)
    try:
        return proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        raise


def _log(msg: str, *, stderr: bool = False) -> None:
    """Minimal logger that survives being run under nohup / daemon mode.

    We deliberately avoid rich.console here because ``__main__.py`` may run
    with stdout redirected to a file that doesn't support ANSI, and rich's
    wide-character handling has surprised us in the past on some terminals.
    """
    print(msg, file=(sys.stderr if stderr else sys.stdout), flush=True)


def run_server_with_supervisor(
    *,
    host: str,
    port: int,
    reload: bool = False,
    platform_override: Optional[str] = None,
    on_picker_start: Optional[callable] = None,
    on_server_start: Optional[callable] = None,
) -> None:
    """Run the picker (if needed) then the main uvicorn server.

    Parameters
    ----------
    host, port:
        Passed through to uvicorn for both the picker subprocess and the main
        server. The picker binds to the same port so the frontend only needs
        one proxy target.
    reload:
        Forwarded to the main server's uvicorn.run. The picker never uses
        reload — it's a short-lived one-shot.
    platform_override:
        When set to ``"openclaw"`` or ``"hermes"``, skip the picker entirely
        and go straight to the main server with ``PLATFORM`` pinned. Invalid
        values raise ``ValueError``.
    on_picker_start / on_server_start:
        Optional zero-arg callables used by ``cli.py`` to open the browser at
        the right moment. Kept as callbacks so this module has no
        ``webbrowser`` dependency.
    """
    import uvicorn

    _ensure_data_dir()

    if platform_override is not None:
        platform_override = platform_override.strip().lower()
        if platform_override not in ("openclaw", "hermes"):
            raise ValueError(
                f"Invalid platform override {platform_override!r}; "
                "expected 'openclaw' or 'hermes'."
            )

    chosen_platform = platform_override
    installed = detect_installed_platforms()
    should_pick = chosen_platform is None and len(installed) >= 2

    if should_pick:
        _log(
            "🧭 Both OpenClaw and Hermes detected — launching framework picker"
        )
        _log(
            f"   Picker URL: http://{host}:{port}/select-framework"
        )

        # Clear any stale pin from a previous aborted session before we start.
        stale = runtime_platform_pin_path()
        if stale.is_file():
            try:
                stale.unlink()
            except OSError:
                pass

        if on_picker_start is not None:
            try:
                on_picker_start()
            except Exception:  # noqa: BLE001 — browser failures are cosmetic
                pass

        rc = _run_picker_subprocess(host, port)
        if rc == PICKER_EXIT_CODE:
            chosen = read_and_clear_pin()
            if chosen:
                _log(f"✓ Platform selected: {chosen}")
                chosen_platform = chosen
            else:
                _log(
                    "⚠ Picker exited with the success code but no pin was "
                    "found; falling back to auto-detection.",
                    stderr=True,
                )
        else:
            _log(
                f"⚠ Picker exited with code {rc}; falling back to "
                "auto-detection.",
                stderr=True,
            )

    # ── Main server ──────────────────────────────────────────────────────
    # Propagate the pin via env var so ``config.Settings`` picks it up for
    # any *future* instantiation (e.g. uvicorn reload workers). We also
    # explicitly clear the picker-mode flag in case some outer shell set it
    # by mistake; otherwise the middleware would block everything on the
    # real server too.
    if chosen_platform is not None:
        os.environ["PLATFORM"] = chosen_platform

        # Critical: ``config.py`` creates a module-level ``settings`` singleton
        # at first import, snapshotting ``PLATFORM`` at that moment. ``__main__``
        # (and ``cli``) imports ``settings`` BEFORE this supervisor runs, so
        # by now the singleton already has ``platform="auto"`` cached — and
        # because the rest of the app does ``from .config import settings``
        # (binding by name), replacing the module attribute wouldn't reach
        # them either. So we mutate the existing instance in place. Pydantic
        # v2 ``BaseSettings`` fields are mutable by default, and the derived
        # ``resolved_platform`` / ``is_openclaw`` / ``is_hermes`` properties
        # read ``self.platform`` on every access, so this is sufficient.
        try:
            from . import config as _cfg

            existing = getattr(_cfg, "settings", None)
            if existing is not None:
                existing.platform = chosen_platform
                _log(
                    f"✓ Settings singleton updated: platform={chosen_platform} "
                    f"(resolved_platform={existing.resolved_platform})"
                )
        except Exception as exc:  # noqa: BLE001
            _log(
                f"⚠ Could not propagate platform={chosen_platform!r} into "
                f"config.settings singleton: {exc!r}. The app will likely "
                f"fall back to _detect_platform() — re-export PLATFORM in "
                f"your .env to work around.",
                stderr=True,
            )
    os.environ.pop(PICKER_MODE_ENV, None)

    if on_server_start is not None:
        try:
            on_server_start()
        except Exception:  # noqa: BLE001
            pass

    uvicorn.run(
        "xsafeclaw.api.main:app",
        host=host,
        port=port,
        reload=reload,
        log_level="info",
    )
