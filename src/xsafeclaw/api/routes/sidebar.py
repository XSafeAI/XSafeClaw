"""Routes for launching the desktop Sidebar host process."""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...config import settings
from ...database import get_db
from ...models import Message, Session
from ...services import guard_service

router = APIRouter()

_sidebar_process: subprocess.Popen[bytes] | None = None
_SIDEBAR_RUNTIME_LABELS: dict[str, str] = {
    "openclaw": "OpenClaw",
    "hermes": "Hermes",
    "nanobot": "Nanobot",
}
_SIDEBAR_SOURCE_FALLBACKS: dict[str, str] = {
    "openclaw": "~/.openclaw/agents/main/sessions",
    "hermes": "~/.hermes/sessions",
    "nanobot": "~/.nanobot/workspace/sessions",
}


def _normalize_session_key(key: str | None) -> str:
    if not key:
        return ""
    if "::" in key:
        key = key.rsplit("::", 1)[-1]
    if ":" in key:
        key = key.rsplit(":", 1)[-1]
    return key


def _session_key_matches(left: str | None, right: str | None) -> bool:
    if not left or not right:
        return False
    if left == right:
        return True
    return _normalize_session_key(left) == _normalize_session_key(right)


def _elapsed_text(ts: datetime | None) -> str:
    if ts is None:
        return "暂无活动"
    now = datetime.now(timezone.utc)
    value = ts if ts.tzinfo is not None else ts.replace(tzinfo=timezone.utc)
    delta = now - value
    seconds = max(0, int(delta.total_seconds()))
    if seconds < 60:
        return "刚刚活跃"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} 分钟前活跃"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} 小时前活跃"
    return f"{hours // 24} 天前活跃"


def _session_runtime(ts: datetime | None) -> str:
    if ts is None:
        return "idle"
    now = datetime.now(timezone.utc)
    value = ts if ts.tzinfo is not None else ts.replace(tzinfo=timezone.utc)
    return "running" if (now - value).total_seconds() <= 24 * 3600 else "idle"


def _session_source_text(session: Session) -> str:
    jsonl_path = str(session.jsonl_file_path or "").strip()
    if jsonl_path:
        return str(Path(jsonl_path).expanduser().parent)
    return _SIDEBAR_SOURCE_FALLBACKS.get(session.platform, "~/.sessions")


def _model_text(session: Session) -> str:
    provider = str(session.current_model_provider or "").strip()
    model = str(session.current_model_name or "").strip()
    if provider and model:
        return f"{provider}/{model}" if "/" not in model else model
    if model:
        return model
    if provider:
        return provider
    return "未知模型"


def _latest_message_text(message: Message | None) -> str:
    if message is None:
        return "暂无最近消息"
    text = str(message.content_text or "").strip()
    if not text:
        return "暂无最近消息"
    return text if len(text) <= 140 else f"{text[:139]}..."


def _is_running(process: subprocess.Popen[bytes] | None) -> bool:
    return process is not None and process.poll() is None


def _desktop_sidebar_api_base() -> str:
    host = settings.api_host
    if host in {"0.0.0.0", "::", ""}:
        host = "127.0.0.1"
    return f"http://{host}:{settings.api_port}/api"


def _start_sidebar_process(api_base: str | None = None) -> subprocess.Popen[bytes]:
    creationflags = 0
    start_new_session = False
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    else:
        start_new_session = True

    resolved_api_base = api_base or _desktop_sidebar_api_base()
    return subprocess.Popen(
        [
            sys.executable,
            "-m",
            "xsafeclaw.desktop_sidebar",
            "--parent-pid",
            str(os.getpid()),
            "--api-base",
            resolved_api_base,
        ],
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


@router.get("/desktop-sidebar/sessions")
async def desktop_sidebar_sessions(
    platform: str = Query(..., pattern="^(openclaw|hermes|nanobot)$"),
    limit: int | None = Query(None, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return sidebar-ready session cards for one runtime platform."""
    count_result = await db.execute(
        select(func.count(Session.session_id)).where(
            Session.deleted_at.is_(None),
            Session.platform == platform,
        )
    )
    total = count_result.scalar_one() or 0

    stmt = (
        select(Session)
        .where(Session.deleted_at.is_(None), Session.platform == platform)
        .order_by(Session.last_activity_at.desc().nullslast(), Session.updated_at.desc())
    )
    if limit is not None:
        stmt = stmt.limit(limit)

    rows = await db.execute(stmt)
    sessions = rows.scalars().all()
    pending_items = [item for item in guard_service.get_all_pending() if not item.resolved]

    payload_sessions: list[dict[str, Any]] = []
    for session in sessions:
        latest_message_result = await db.execute(
            select(Message)
            .where(Message.session_id == session.session_id)
            .order_by(Message.timestamp.desc(), Message.id.desc())
            .limit(1)
        )
        latest_message = latest_message_result.scalars().first()

        pending_count = 0
        for item in pending_items:
            if _session_key_matches(getattr(item, "session_key", None), session.session_key):
                pending_count += 1

        app_name = _SIDEBAR_RUNTIME_LABELS.get(platform, "OpenClaw")
        payload_sessions.append(
            {
                "id": session.session_id,
                "app_name": app_name,
                "display_session_id": session.source_session_id or session.session_id,
                "icon_type": platform,
                "status": _session_runtime(session.last_activity_at),
                "activity_text": _elapsed_text(session.last_activity_at),
                "latest_message": _latest_message_text(latest_message),
                "model_text": _model_text(session),
                "source_text": _session_source_text(session),
                "pending_risk_count": pending_count,
                "risk_state": "pending" if pending_count > 0 else "safe",
            }
        )

    return {
        "platform": platform,
        "app_name": _SIDEBAR_RUNTIME_LABELS.get(platform, "OpenClaw"),
        "sessions": payload_sessions,
        "total": total,
    }
