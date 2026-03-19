"""Guard API routes — AgentDoG safety verification for agent trajectories.

Provides endpoints to:
- Check a full session trajectory (all messages).
- Check up to a specific event (incremental verification).
- Retrieve cached guard results.
- Health-check the guard model endpoints.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_db
from ...models import Event, Message, Session, ToolCall
from ...services import guard_service

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class CheckRequest(BaseModel):
    mode: str = "base"       # "base" | "fg" | "both"
    profile: str = "OpenClaw AI Agent"


class GuardResultResponse(BaseModel):
    session_id: str
    event_id: str | None = None
    mode: str
    verdict: str
    risk_source: str | None = None
    failure_mode: str | None = None
    real_world_harm: str | None = None
    raw_output: str = ""
    checked_at: float = 0.0
    duration_ms: int = 0
    trajectory_rounds: int = 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _fetch_session_messages(
    db: AsyncSession,
    session_id: str,
    up_to_event_id: str | None = None,
) -> list[dict[str, Any]]:
    """Fetch messages for a session, optionally truncated to a specific event."""
    stmt = select(Session).where(Session.session_id == session_id)
    session = (await db.execute(stmt)).scalar_one_or_none()
    if not session:
        raise HTTPException(404, f"Session {session_id} not found")

    msg_query = (
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.timestamp)
    )

    if up_to_event_id:
        event = (
            await db.execute(select(Event).where(Event.id == up_to_event_id))
        ).scalar_one_or_none()
        if not event:
            raise HTTPException(404, f"Event {up_to_event_id} not found")
        if event.completed_at:
            msg_query = msg_query.where(Message.timestamp <= event.completed_at)
        elif event.started_at:
            next_user = (
                await db.execute(
                    select(Message.timestamp)
                    .where(
                        Message.session_id == session_id,
                        Message.role == "user",
                        Message.timestamp > event.started_at,
                    )
                    .order_by(Message.timestamp)
                    .limit(1)
                )
            ).scalar_one_or_none()
            if next_user:
                msg_query = msg_query.where(Message.timestamp < next_user)

    messages_raw = (await db.execute(msg_query)).scalars().all()

    msg_ids = [m.id for m in messages_raw]
    tc_by_msg: dict[int, list[dict]] = {}
    if msg_ids:
        tc_result = await db.execute(
            select(ToolCall).where(ToolCall.message_db_id.in_(msg_ids))
        )
        for tc in tc_result.scalars().all():
            tc_by_msg.setdefault(tc.message_db_id, []).append({
                "tool_name": tc.tool_name,
                "arguments": tc.arguments,
            })

    result: list[dict[str, Any]] = []
    for m in messages_raw:
        result.append({
            "role": m.role,
            "content_text": m.content_text or "",
            "tool_calls": tc_by_msg.get(m.id, []),
        })
    return result


async def _run_check(
    db: AsyncSession,
    session_id: str,
    event_id: str | None,
    body: CheckRequest,
) -> list[GuardResultResponse]:
    """Run guard check(s) and return results."""
    messages = await _fetch_session_messages(db, session_id, event_id)
    if not messages:
        raise HTTPException(400, "No messages to check")

    modes = ["base", "fg"] if body.mode == "both" else [body.mode]
    results: list[GuardResultResponse] = []

    for m in modes:
        r = await guard_service.check_messages(
            messages,
            session_id=session_id,
            event_id=event_id,
            mode=m,
            profile=body.profile,
        )
        results.append(GuardResultResponse(**r.to_dict()))

    return results


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/check/{session_id}", response_model=list[GuardResultResponse])
async def check_session(
    session_id: str,
    body: CheckRequest = CheckRequest(),
    db: AsyncSession = Depends(get_db),
):
    """Run guard check on a full session trajectory."""
    return await _run_check(db, session_id, event_id=None, body=body)


@router.post(
    "/check/{session_id}/event/{event_id}",
    response_model=list[GuardResultResponse],
)
async def check_event(
    session_id: str,
    event_id: str,
    body: CheckRequest = CheckRequest(),
    db: AsyncSession = Depends(get_db),
):
    """Run guard check on trajectory up to (and including) a specific event."""
    return await _run_check(db, session_id, event_id=event_id, body=body)


@router.get("/results", response_model=list[GuardResultResponse])
async def list_results(
    session_id: str | None = Query(None),
    verdict: str | None = Query(None),
):
    """List cached guard results, optionally filtered."""
    all_results = guard_service.get_all_results()
    if session_id:
        all_results = [r for r in all_results if r.session_id == session_id]
    if verdict:
        all_results = [r for r in all_results if r.verdict == verdict]
    return [GuardResultResponse(**r.to_dict()) for r in all_results]


@router.get("/unsafe-sessions")
async def list_unsafe_sessions():
    """Return session IDs flagged as unsafe."""
    return {"unsafe_session_ids": sorted(guard_service.get_unsafe_session_ids())}


@router.get("/pending-sessions")
async def list_pending_sessions():
    """Return session IDs whose latest guard verdict is still unsafe."""
    return {"pending_session_ids": sorted(guard_service.get_pending_session_ids())}


@router.get("/status")
async def guard_status():
    """Health check for guard model endpoints."""
    return await guard_service.health_check()


@router.post("/clear")
async def clear_results_cache():
    """Clear all cached guard results."""
    guard_service.clear_results()
    return {"message": "Guard results cache cleared"}


# ---------------------------------------------------------------------------
# Tool-call Guard — real-time check (called by OpenClaw plugin)
# ---------------------------------------------------------------------------

class ToolCheckRequest(BaseModel):
    tool_name: str
    params: dict = {}
    session_key: str = ""


class ToolCheckResponse(BaseModel):
    action: str               # "allow" | "block" | "modify"
    reason: str | None = None
    params: dict | None = None


@router.post("/tool-check", response_model=ToolCheckResponse)
async def tool_check(body: ToolCheckRequest):
    """Real-time tool-call guard.  Long-polls if the call needs approval."""
    result = await guard_service.check_tool_call(
        tool_name=body.tool_name,
        params=body.params,
        session_key=body.session_key,
    )
    return ToolCheckResponse(**result)


# ---------------------------------------------------------------------------
# Pending Approvals — list / resolve / cleanup
# ---------------------------------------------------------------------------

class PendingApprovalResponse(BaseModel):
    id: str
    session_key: str
    tool_name: str
    params: dict
    guard_verdict: str
    guard_raw: str = ""
    session_context: str = ""
    risk_source: str | None = None
    failure_mode: str | None = None
    real_world_harm: str | None = None
    created_at: float = 0.0
    resolved: bool = False
    resolution: str = ""
    resolved_at: float = 0.0
    modified_params: dict | None = None


@router.get("/pending", response_model=list[PendingApprovalResponse])
async def list_pending(resolved: bool | None = Query(None)):
    """List pending approval items."""
    items = guard_service.get_all_pending()
    if resolved is not None:
        items = [i for i in items if i.resolved == resolved]
    return [PendingApprovalResponse(**i.to_dict()) for i in items]


class ResolveRequest(BaseModel):
    resolution: str             # "approved" | "rejected" | "modified"
    modified_params: dict | None = None


@router.post("/pending/{pending_id}/resolve", response_model=PendingApprovalResponse)
async def resolve_pending(pending_id: str, body: ResolveRequest):
    """Resolve a pending approval — approve, reject, or modify params."""
    p = guard_service.resolve_pending(
        pending_id=pending_id,
        resolution=body.resolution,
        modified_params=body.modified_params,
    )
    if not p:
        raise HTTPException(404, f"Pending item {pending_id} not found or already resolved")
    return PendingApprovalResponse(**p.to_dict())


@router.post("/pending/cleanup")
async def cleanup_pending():
    """Remove old resolved pending items."""
    removed = guard_service.cleanup_resolved()
    return {"removed": removed}


@router.get("/enabled")
async def guard_enabled_status():
    """Return whether the guard is currently enabled."""
    return {"enabled": guard_service.is_guard_enabled()}


@router.post("/enabled")
async def set_guard_enabled(body: dict):
    """Toggle guard on/off. Body: { "enabled": true/false }"""
    enabled = body.get("enabled", True)
    guard_service.set_guard_enabled(bool(enabled))
    return {"enabled": guard_service.is_guard_enabled()}
