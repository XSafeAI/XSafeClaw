"""Routes for launching the desktop Sidebar host process."""

from __future__ import annotations

import os
import subprocess
import sys

from fastapi import APIRouter

router = APIRouter()

_sidebar_process: subprocess.Popen[bytes] | None = None


def _is_running(process: subprocess.Popen[bytes] | None) -> bool:
    return process is not None and process.poll() is None


def _start_sidebar_process() -> subprocess.Popen[bytes]:
    creationflags = 0
    start_new_session = False
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    else:
        start_new_session = True

    return subprocess.Popen(
        [sys.executable, "-m", "xsafeclaw.desktop_sidebar"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creationflags,
        start_new_session=start_new_session,
    )


@router.post("/desktop-sidebar/open")
async def open_desktop_sidebar() -> dict[str, int | bool | str]:
    """Launch the native floating Sidebar if it is not already running."""
    global _sidebar_process

    if _is_running(_sidebar_process):
        assert _sidebar_process is not None
        return {"ok": True, "already_running": True, "pid": _sidebar_process.pid}

    _sidebar_process = _start_sidebar_process()
    return {"ok": True, "already_running": False, "pid": _sidebar_process.pid}


@router.get("/desktop-sidebar/status")
async def desktop_sidebar_status() -> dict[str, int | bool | None]:
    """Return whether the native floating Sidebar process is still alive."""
    return {
        "running": _is_running(_sidebar_process),
        "pid": _sidebar_process.pid if _is_running(_sidebar_process) and _sidebar_process else None,
    }
