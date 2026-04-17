"""Trace API — aggregated view for Agent Town frontend.

Returns a unified { agents, events } payload that maps directly
to the data model expected by the PixiJS Agent Town visualization.

Session agent status (three states, same rules as dashboard docs):
- pending: unresolved guard approval AND last activity within 24h
- working: last activity within 24h, excluding pending
- offline: no activity within 24h (pending is never classified here)
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from ...config import settings
from ...database import get_db
from ...models import Message, Session, ToolCall
from ...models.event import Event
from ...services import guard_service

router = APIRouter()

RUNNING_CUTOFF = dt.timedelta(hours=1)
IDLE_CUTOFF = dt.timedelta(hours=24)

if settings.is_hermes:
    _SESSIONS_JSON = settings.hermes_sessions_dir / "sessions.json"
else:
    _SESSIONS_JSON = Path.home() / ".openclaw" / "agents" / "main" / "sessions" / "sessions.json"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _short_id(session_id: str) -> str:
    return session_id[:8] if session_id else ""


def _classify_sessions(
    latest_event_ts: dict[str, dt.datetime],
) -> tuple[set[str], set[str]]:
    """Return (active_ids, today_ids) using the same monitor cutoffs."""
    now = dt.datetime.now(dt.timezone.utc)
    active: set[str] = set()
    today: set[str] = set()
    for sid, ts in latest_event_ts.items():
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=dt.timezone.utc)
        diff = now - ts
        if diff <= RUNNING_CUTOFF:
            active.add(sid)
        if diff <= IDLE_CUTOFF:
            today.add(sid)
    return active, today


def _session_ids_with_unresolved_guard_approval(
    session_map: dict[str, Session],
    session_store_index: dict[str, dict[str, Any]],
) -> set[str]:
    """Session IDs that have at least one unresolved in-memory guard approval (session_key match)."""
    pending_keys = {
        p.session_key
        for p in guard_service.get_all_pending()
        if not p.resolved and p.session_key
    }
    if not pending_keys:
        return set()
    out: set[str] = set()
    for sid, sess in session_map.items():
        sk = sess.session_key
        if sk and sk in pending_keys:
            out.add(sid)
    for sid, meta in session_store_index.items():
        sk = meta.get("session_key")
        if sk and sk in pending_keys:
            out.add(sid)
    return out


def _agent_status_from_buckets(
    session_id: str,
    today_ids: set[str],
    guard_unresolved_session_ids: set[str],
) -> str:
    """pending = guard unresolved ∧ 24h active; working = 24h active \\ pending; offline = else."""
    in_today = session_id in today_ids
    if session_id in guard_unresolved_session_ids and in_today:
        return "pending"
    if in_today:
        return "working"
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


def _to_utc(value: dt.datetime | None) -> dt.datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc)


def _build_activity_heat_24h(
    timestamps: list[dt.datetime],
    *,
    now: dt.datetime,
) -> list[int]:
    """Count ``Event.started_at`` per hour over the last 24h (Monitor timeline semantics).

    Bin ``i`` gets events with ``floor((now-ts)/1h) == 23 - i`` (``i=0`` oldest hour slice, ``i=23`` last hour).
    """
    bins = [0] * 24
    for ts in timestamps:
        utc_ts = _to_utc(ts)
        if utc_ts is None:
            continue
        diff = now - utc_ts
        if diff < dt.timedelta(0) or diff > IDLE_CUTOFF:
            continue
        hour_index = 23 - int(diff.total_seconds() // 3600)
        hour_index = max(0, min(23, hour_index))
        bins[hour_index] += 1
    return bins


def _score_activity_heat(
    bins: list[int],
    *,
    latest_ts: dt.datetime | None,
    is_active: bool,
) -> tuple[int, str]:
    total = sum(bins)
    recent_2h = sum(bins[-2:])
    recent_6h = sum(bins[-6:])

    score = 0
    if total > 0:
        score = 1
    if total >= 3 or recent_6h >= 2:
        score = 2
    if total >= 6 or recent_6h >= 4:
        score = 3
    if is_active or recent_2h >= 2 or total >= 10:
        score = 4

    latest_utc = _to_utc(latest_ts)
    if latest_utc is not None and (dt.datetime.now(dt.timezone.utc) - latest_utc) > IDLE_CUTOFF:
        score = 0

    label_map = {
        0: "dormant",
        1: "low",
        2: "warm",
        3: "hot",
        4: "peak",
    }
    return score, label_map[score]


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

    Per-turn ``status`` is taken **only** from the persisted :class:`~...models.event.Event`
    row (same field as ``GET /api/events``), so Agent Town counts match Monitor.
    Session status buckets use the **events** table and mirror the monitor's
    active / today / all semantics. "All" means every session that has events.
    """

    # ── 1. Load all non-deleted sessions ────────────────────────────
    sess_result = await db.execute(
        select(Session)
        .options(
            load_only(
                Session.session_id,
                Session.session_key,
                Session.channel,
                Session.first_seen_at,
                Session.current_model_provider,
                Session.current_model_name,
                Session.last_activity_at,
                Session.deleted_at,
            )
        )
        .where(Session.deleted_at.is_(None))
        .order_by(Session.last_activity_at.desc())
    )
    sessions = sess_result.scalars().all()

    if not sessions:
        return {"agents": [], "events": []}

    session_map = {s.session_id: s for s in sessions}

    # ── 2. Determine active set via events table (= Timeline logic) ─
    latest_stmt = (
        select(Event.session_id, func.max(Event.started_at).label("latest"))
        .where(Event.session_id.in_(session_map.keys()))
        .group_by(Event.session_id)
    )
    latest_rows = (await db.execute(latest_stmt)).all()
    latest_event_ts: dict[str, dt.datetime] = {
        row.session_id: row.latest for row in latest_rows if row.latest
    }

    active_ids, today_ids = _classify_sessions(latest_event_ts)
    session_ids = sorted(
        latest_event_ts.keys(),
        key=lambda sid: latest_event_ts[sid],
        reverse=True,
    )

    event_rows_result = await db.execute(
        select(Event.session_id, Event.started_at)
        .where(Event.session_id.in_(session_ids))
        .order_by(Event.session_id, Event.started_at)
    )
    event_rows = event_rows_result.all()
    event_timestamps_by_session: dict[str, list[dt.datetime]] = {}
    dialog_turns_by_session: dict[str, int] = {}
    for row in event_rows:
        if not row.started_at:
            continue
        event_timestamps_by_session.setdefault(row.session_id, []).append(row.started_at)
        dialog_turns_by_session[row.session_id] = dialog_turns_by_session.get(row.session_id, 0) + 1

    # ── Guard: unresolved approvals (in-memory queue) + session store ─
    latest_guard_by_session = guard_service.get_latest_results_by_session()
    all_pending_items = guard_service.get_all_pending()
    session_store_index = _load_session_store_index()
    guard_unresolved_session_ids = _session_ids_with_unresolved_guard_approval(
        session_map, session_store_index
    )
    intervention_counts_by_session_key: dict[str, int] = {}
    for pending_item in all_pending_items:
        if not pending_item.session_key:
            continue
        intervention_counts_by_session_key[pending_item.session_key] = (
            intervention_counts_by_session_key.get(pending_item.session_key, 0) + 1
        )

    now = dt.datetime.now(dt.timezone.utc)

    # ── 3. Build agents for all monitor-visible sessions ───────────
    agents: list[dict[str, Any]] = []
    for sid in session_ids:
        s = session_map.get(sid)
        if s is None:
            continue
        status = _agent_status_from_buckets(sid, today_ids, guard_unresolved_session_ids)
        session_store = session_store_index.get(sid, {})
        session_key = session_store.get("session_key") or s.session_key or ""
        activity_heat_24h = _build_activity_heat_24h(
            event_timestamps_by_session.get(sid, []),
            now=now,
        )
        heat_score, heat_label = _score_activity_heat(
            activity_heat_24h,
            latest_ts=latest_event_ts.get(sid),
            is_active=sid in active_ids,
        )
        human_interventions_total = intervention_counts_by_session_key.get(session_key, 0)
        agents.append({
            "id": sid,
            "name": f"Agent-{_short_id(sid)}",
            "pid": _short_id(sid),
            "provider": session_store.get("model_provider") or s.current_model_provider or "unknown",
            "model": session_store.get("model") or s.current_model_name or "",
            "status": status,
            "first_seen_at": _iso(s.first_seen_at),
            "session_key": session_key,
            "channel": session_store.get("channel") or s.channel,
            "dialog_turns_total": dialog_turns_by_session.get(sid, 0),
            "human_interventions_total": human_interventions_total,
            "activity_heat_24h": activity_heat_24h,
            "working_heat_score": heat_score,
            "working_heat_label": heat_label,
        })

    if not session_ids:
        return {"agents": [], "events": []}

    # ── 4. Messages for all monitor-visible sessions ────────────────
    msg_result = await db.execute(
        select(Message)
        .options(
            load_only(
                Message.id,
                Message.session_id,
                Message.message_id,
                Message.role,
                Message.timestamp,
                Message.content_text,
            )
        )
        .where(Message.session_id.in_(session_ids))
        .order_by(Message.session_id, Message.timestamp)
    )
    all_messages = msg_result.scalars().all()

    # ── 5. Tool calls ──────────────────────────────────────────────
    tc_result = await db.execute(
        select(ToolCall)
        .options(
            load_only(
                ToolCall.id,
                ToolCall.message_db_id,
                ToolCall.tool_name,
                ToolCall.arguments,
                ToolCall.result_text,
                ToolCall.status,
                ToolCall.is_error,
                ToolCall.started_at,
                ToolCall.completed_at,
                ToolCall.duration_seconds,
                ToolCall.error_message,
            )
        )
        .join(Message, ToolCall.message_db_id == Message.id)
        .where(Message.session_id.in_(session_ids))
    )
    tc_by_msg: dict[int, list[ToolCall]] = {}
    for tc in tc_result.scalars().all():
        tc_by_msg.setdefault(tc.message_db_id, []).append(tc)

    # ── 6. Group messages by session ────────────────────────────────
    msgs_by_session: dict[str, list[Message]] = {}
    for m in all_messages:
        msgs_by_session.setdefault(m.session_id, []).append(m)

    # Event.id == triggering user_message_id — same status Monitor and /api/events use
    event_status_result = await db.execute(
        select(Event.id, Event.status).where(Event.session_id.in_(session_ids))
    )
    event_status_by_user_message_id: dict[str, str] = {
        row.id: row.status for row in event_status_result.all()
    }

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

        latest_turn_index = len(turns) - 1
        session_guard = latest_guard_by_session.get(session_id)

        for turn_index, turn in enumerate(turns):
            if not turn:
                continue
            event_counter += 1

            start_time = turn[0].timestamp
            end_time = turn[-1].timestamp

            conversations: list[dict[str, Any]] = []
            tool_names: set[str] = set()

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

            event_type = ", ".join(sorted(tool_names)) if tool_names else "chat"

            user_message_id = turn[0].message_id
            status = event_status_by_user_message_id.get(user_message_id, "running")

            duration = None
            if start_time and end_time:
                try:
                    duration = round(
                        (end_time - start_time).total_seconds(), 2
                    )
                except Exception:
                    pass

            guard_result = None
            if (
                status == "pending"
                and turn_index == latest_turn_index
                and session_guard
            ):
                guard_result = {
                    "verdict": session_guard.verdict,
                    "mode": session_guard.mode,
                    "risk_source": session_guard.risk_source,
                    "failure_mode": session_guard.failure_mode,
                    "real_world_harm": session_guard.real_world_harm,
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
