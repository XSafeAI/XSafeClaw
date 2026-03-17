"""Trace API — aggregated view for Agent Town frontend.

Returns a unified { agents, events } payload that maps directly
to the data model expected by the PixiJS Agent Town visualization.

Agent "active" classification mirrors Monitor.tsx's Timeline logic
exactly: a session is "active" when its most-recent event.started_at
falls within the cutoff window, with the same fallback chain
(active → today → all).
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_db
from ...models import Message, Session, ToolCall
from ...models.event import Event
from ...services import guard_service

router = APIRouter()

ACTIVE_CUTOFF = dt.timedelta(hours=1)
TODAY_CUTOFF = dt.timedelta(hours=24)
_SESSIONS_JSON = Path.home() / ".openclaw" / "agents" / "main" / "sessions" / "sessions.json"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _short_id(session_id: str) -> str:
    return session_id[:8] if session_id else ""


def _classify_sessions(
    latest_event_ts: dict[str, dt.datetime],
) -> tuple[set[str], set[str]]:
    """Return (active_ids, today_ids) using the same algorithm as
    ``classifyActiveSessions`` in Monitor.tsx."""
    now = dt.datetime.now(dt.timezone.utc)
    active: set[str] = set()
    today: set[str] = set()
    for sid, ts in latest_event_ts.items():
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=dt.timezone.utc)
        diff = now - ts
        if diff <= ACTIVE_CUTOFF:
            active.add(sid)
        if diff <= TODAY_CUTOFF:
            today.add(sid)
    return active, today


def _resolve_visible_ids(
    all_ids: list[str],
    active_ids: set[str],
    today_ids: set[str],
) -> set[str]:
    """Same fallback chain as Monitor.tsx visibleRows:
    active → today → all."""
    if active_ids:
        return active_ids
    if today_ids:
        return today_ids
    return set(all_ids)


def _agent_status_from_event(
    latest_ts: dt.datetime | None,
) -> str:
    """running / idle / offline — matches Timeline's visual cues."""
    if latest_ts is None:
        return "offline"
    now = dt.datetime.now(dt.timezone.utc)
    if latest_ts.tzinfo is None:
        latest_ts = latest_ts.replace(tzinfo=dt.timezone.utc)
    diff = (now - latest_ts).total_seconds()
    if diff < 300:
        return "running"
    if diff < 3600:
        return "idle"
    return "offline"


def _iso(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, dt.datetime):
        return value.isoformat()
    return str(value)


def _truncate(text: str, length: int = 2000) -> str:
    if not text:
        return ""
    return text[:length] + "…" if len(text) > length else text


def _load_session_store_index() -> dict[str, dict[str, Any]]:
    """Map session_id -> gateway session metadata from sessions.json."""
    if not _SESSIONS_JSON.exists():
        return {}

    try:
        raw = json.loads(_SESSIONS_JSON.read_text(encoding="utf-8"))
    except Exception:
        return {}

    index: dict[str, dict[str, Any]] = {}
    for session_key, entry in raw.items():
        if not isinstance(entry, dict):
            continue

        session_id = entry.get("sessionId")
        if not session_id:
            continue

        delivery = entry.get("deliveryContext") or {}
        origin = entry.get("origin") or {}
        index[session_id] = {
            "session_key": session_key,
            "model_provider": entry.get("modelProvider"),
            "model": entry.get("model"),
            "channel": delivery.get("channel") or entry.get("lastChannel") or origin.get("provider"),
        }

    return index


def _serialize_tool_call(tc: "ToolCall") -> dict[str, Any]:
    """Serialize a ToolCall ORM object to a JSON-friendly dict."""
    return {
        "id": tc.id,
        "tool_name": tc.tool_name,
        "arguments": tc.arguments,
        "result_text": _truncate(tc.result_text or "", 2000),
        "status": tc.status,
        "is_error": tc.is_error,
        "started_at": _iso(tc.started_at),
        "completed_at": _iso(tc.completed_at),
        "duration_seconds": tc.duration_seconds,
        "error_message": tc.error_message,
    }


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/")
async def get_trace(
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Aggregated trace data consumed by the Agent Town frontend.

    Returns ``{ agents: [...], events: [...] }`` where each *agent*
    corresponds to a database session and each *event* is one
    user-message turn with its full conversation chain.

    Session visibility uses the **events** table (same data source as
    the Monitor Timeline) so the two views always agree on which
    sessions are shown.
    """

    # ── 1. Load all non-deleted sessions ────────────────────────────
    sess_result = await db.execute(
        select(Session)
        .where(Session.deleted_at.is_(None))
        .order_by(Session.last_activity_at.desc())
    )
    sessions = sess_result.scalars().all()

    if not sessions:
        return {"agents": [], "events": []}

    session_ids = [s.session_id for s in sessions]
    session_map = {s.session_id: s for s in sessions}

    # ── 2. Determine active set via events table (= Timeline logic) ─
    latest_stmt = (
        select(Event.session_id, func.max(Event.started_at).label("latest"))
        .where(Event.session_id.in_(session_ids))
        .group_by(Event.session_id)
    )
    latest_rows = (await db.execute(latest_stmt)).all()
    latest_event_ts: dict[str, dt.datetime] = {
        row.session_id: row.latest for row in latest_rows if row.latest
    }

    active_ids, today_ids = _classify_sessions(latest_event_ts)
    visible_ids = _resolve_visible_ids(session_ids, active_ids, today_ids)

    # ── Guard: sessions flagged as unsafe ──────────────────────────
    unsafe_ids = guard_service.get_unsafe_session_ids()
    session_store_index = _load_session_store_index()

    # ── 3. Build agents (only visible ones) ────────────────────────
    agents: list[dict[str, Any]] = []
    visible_session_ids: list[str] = []
    for s in sessions:
        sid = s.session_id
        if sid not in visible_ids:
            continue
        visible_session_ids.append(sid)
        base_status = _agent_status_from_event(latest_event_ts.get(sid))
        status = "waiting" if sid in unsafe_ids else base_status
        session_store = session_store_index.get(sid, {})
        agents.append({
            "id": sid,
            "name": f"Agent-{_short_id(sid)}",
            "pid": _short_id(sid),
            "provider": session_store.get("model_provider") or s.current_model_provider or "unknown",
            "model": session_store.get("model") or s.current_model_name or "",
            "status": status,
            "first_seen_at": _iso(s.first_seen_at),
            "session_key": session_store.get("session_key"),
            "channel": session_store.get("channel") or s.channel,
        })

    if not visible_session_ids:
        return {"agents": [], "events": []}

    # ── 4. Messages for visible sessions ────────────────────────────
    msg_result = await db.execute(
        select(Message)
        .where(Message.session_id.in_(visible_session_ids))
        .order_by(Message.session_id, Message.timestamp)
    )
    all_messages = msg_result.scalars().all()

    # ── 5. Tool calls ──────────────────────────────────────────────
    tc_result = await db.execute(
        select(ToolCall)
        .join(Message, ToolCall.message_db_id == Message.id)
        .where(Message.session_id.in_(visible_session_ids))
    )
    tc_by_msg: dict[int, list[ToolCall]] = {}
    for tc in tc_result.scalars().all():
        tc_by_msg.setdefault(tc.message_db_id, []).append(tc)

    # ── 6. Group messages by session ────────────────────────────────
    msgs_by_session: dict[str, list[Message]] = {}
    for m in all_messages:
        msgs_by_session.setdefault(m.session_id, []).append(m)

    # ── 7. Build events (one per user-message turn) ─────────────────
    events: list[dict[str, Any]] = []
    event_counter = 0

    for session_id, sess_msgs in msgs_by_session.items():
        agent_name = f"Agent-{_short_id(session_id)}"

        turns: list[list[Message]] = []
        current_turn: list[Message] = []

        for msg in sess_msgs:
            if msg.role == "user":
                if current_turn:
                    turns.append(current_turn)
                current_turn = [msg]
            else:
                current_turn.append(msg)
        if current_turn:
            turns.append(current_turn)

        for turn in turns:
            if not turn:
                continue
            event_counter += 1

            start_time = turn[0].timestamp
            end_time = turn[-1].timestamp

            conversations: list[dict[str, Any]] = []
            tool_names: set[str] = set()
            has_error = False

            for msg in turn:
                role = "tool" if msg.role == "toolResult" else msg.role
                msg_tool_calls = tc_by_msg.get(msg.id, [])

                conv_entry: dict[str, Any] = {
                    "role": role,
                    "text": _truncate(msg.content_text or "", 2000),
                    "content_text": _truncate(msg.content_text or "", 2000),
                    "timestamp": _iso(msg.timestamp),
                }

                if msg_tool_calls:
                    conv_entry["tool_calls"] = [
                        _serialize_tool_call(tc) for tc in msg_tool_calls
                    ]

                conversations.append(conv_entry)

                for tc in msg_tool_calls:
                    tool_names.add(tc.tool_name)
                    if tc.is_error:
                        has_error = True

            event_type = ", ".join(sorted(tool_names)) if tool_names else "chat"

            if has_error:
                status = "error"
            elif end_time and end_time != start_time:
                status = "ok"
            else:
                status = "running"

            duration = None
            if start_time and end_time:
                try:
                    duration = round(
                        (end_time - start_time).total_seconds(), 2
                    )
                except Exception:
                    pass

            guard_result = None
            if session_id in unsafe_ids:
                gr = guard_service.get_result(session_id)
                if gr and gr.verdict == "unsafe":
                    status = "waiting"
                    guard_result = {
                        "verdict": gr.verdict,
                        "mode": gr.mode,
                        "risk_source": gr.risk_source,
                        "failure_mode": gr.failure_mode,
                        "real_world_harm": gr.real_world_harm,
                    }

            evt: dict[str, Any] = {
                "event_id": f"evt-{event_counter:04d}",
                "agent_id": session_id,
                "agent_name": agent_name,
                "event_type": event_type,
                "status": status,
                "start_time": _iso(start_time),
                "end_time": _iso(end_time),
                "duration": duration,
                "conversations": conversations,
            }
            if guard_result:
                evt["guard"] = guard_result
            events.append(evt)

    events.sort(key=lambda e: e.get("start_time", ""), reverse=True)

    return {"agents": agents, "events": events}
