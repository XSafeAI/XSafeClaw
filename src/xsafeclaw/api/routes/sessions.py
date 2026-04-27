"""Session API endpoints."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_db
from ...models import Message, Session, ToolCall
from ..runtime_helpers import apply_runtime_filters

router = APIRouter()


class SessionResponse(BaseModel):
    """Session response model."""

    session_id: str
    platform: str
    instance_id: str
    source_session_id: str | None
    display_session_id: str
    session_key: str | None
    first_seen_at: datetime
    last_activity_at: datetime | None
    cwd: str | None
    current_model_provider: str | None
    current_model_name: str | None
    total_runs: int
    total_tokens: int
    created_at: datetime
    updated_at: datetime


class SessionListResponse(BaseModel):
    """Session list response."""

    sessions: list[SessionResponse]
    total: int
    page: int
    page_size: int


def _infer_runtime_identity(session: Session) -> tuple[str, str]:
    """Best-effort runtime inference for legacy mis-tagged rows."""
    platform = session.platform or "openclaw"
    instance_id = session.instance_id or "openclaw-default"

    if not (platform == "openclaw" and instance_id == "openclaw-default"):
        return platform, instance_id

    candidates = [
        session.session_id or "",
        session.session_key or "",
        session.source_session_id or "",
    ]
    for raw in candidates:
        parts = str(raw).split("::")
        if len(parts) < 2:
            continue
        maybe_platform = parts[0].strip().lower()
        if maybe_platform in {"openclaw", "hermes", "nanobot"}:
            maybe_instance = parts[1].strip() or instance_id
            return maybe_platform, maybe_instance

    return platform, instance_id


def _to_session_response(
    session: Session,
    *,
    total_runs: int,
    total_tokens: int,
) -> SessionResponse:
    platform, instance_id = _infer_runtime_identity(session)
    return SessionResponse(
        session_id=session.session_id,
        platform=platform,
        instance_id=instance_id,
        source_session_id=session.source_session_id,
        display_session_id=session.source_session_id or session.session_id,
        session_key=session.session_key,
        first_seen_at=session.first_seen_at,
        last_activity_at=session.last_activity_at,
        cwd=session.cwd,
        current_model_provider=session.current_model_provider,
        current_model_name=session.current_model_name,
        total_runs=total_runs,
        total_tokens=total_tokens,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.get("/", response_model=SessionListResponse)
async def list_sessions(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    platform: str | None = Query(None, description="Filter by runtime platform"),
    instance_id: str | None = Query(None, description="Filter by runtime instance"),
    db: AsyncSession = Depends(get_db),
):
    """List all sessions with pagination."""
    base_stmt = apply_runtime_filters(select(Session), Session, platform=platform, instance_id=instance_id)

    count_stmt = select(func.count()).select_from(base_stmt.subquery())
    total_result = await db.execute(count_stmt)
    total = total_result.scalar_one()

    offset = (page - 1) * page_size
    stmt = (
        base_stmt
        .order_by(Session.last_activity_at.desc().nullslast(), Session.updated_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    result = await db.execute(stmt)
    sessions = result.scalars().all()

    session_responses = []
    for session in sessions:
        message_count_stmt = select(func.count(Message.id)).where(Message.session_id == session.session_id)
        message_count_result = await db.execute(message_count_stmt)
        message_count = message_count_result.scalar_one() or 0

        token_sum_stmt = select(func.sum(Message.total_tokens)).where(
            Message.session_id == session.session_id,
            Message.role == "assistant",
        )
        token_sum_result = await db.execute(token_sum_stmt)
        token_sum = token_sum_result.scalar_one() or 0

        session_responses.append(
            _to_session_response(
                session,
                total_runs=message_count,
                total_tokens=token_sum,
            )
        )

    return SessionListResponse(
        sessions=session_responses,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a specific session by ID."""
    stmt = select(Session).where(Session.session_id == session_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    message_count_stmt = select(func.count(Message.id)).where(Message.session_id == session_id)
    message_count_result = await db.execute(message_count_stmt)
    message_count = message_count_result.scalar_one() or 0

    token_sum_stmt = select(func.sum(Message.total_tokens)).where(
        Message.session_id == session_id,
        Message.role == "assistant",
    )
    token_sum_result = await db.execute(token_sum_stmt)
    token_sum = token_sum_result.scalar_one() or 0

    return _to_session_response(
        session,
        total_runs=message_count,
        total_tokens=token_sum,
    )


class ToolCallSummary(BaseModel):
    """Tool call summary for message response."""

    id: str
    source_tool_call_id: str | None = None
    tool_name: str
    status: str
    is_error: bool
    arguments: dict | None = None
    result_text: str | None = None

    class Config:
        from_attributes = True


class SessionMessageResponse(BaseModel):
    """Message response within a session."""

    id: int
    session_id: str
    message_id: str
    platform: str
    instance_id: str
    source_session_id: str | None
    source_message_id: str | None
    parent_message_id: str | None
    role: str
    timestamp: datetime
    content_text: str | None
    provider: str | None
    model_id: str | None
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None
    stop_reason: str | None
    error_message: str | None
    created_at: datetime
    tool_calls: list[ToolCallSummary] = []


class SessionMessagesListResponse(BaseModel):
    """Session messages list response."""

    messages: list[SessionMessageResponse]
    total: int
    page: int
    page_size: int


@router.get("/{session_id}/messages", response_model=SessionMessagesListResponse)
async def get_session_messages(
    session_id: str,
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    db: AsyncSession = Depends(get_db),
):
    """Get all messages for a specific session with pagination."""
    session_stmt = select(Session).where(Session.session_id == session_id)
    session_result = await db.execute(session_stmt)
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    count_stmt = select(func.count(Message.id)).where(Message.session_id == session_id)
    total_result = await db.execute(count_stmt)
    total = total_result.scalar_one() or 0

    offset = (page - 1) * page_size
    stmt = (
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.timestamp.asc(), Message.id.asc())
        .offset(offset)
        .limit(page_size)
    )
    result = await db.execute(stmt)
    messages = result.scalars().all()

    message_responses = []
    for msg in messages:
        tool_calls = []
        if msg.role == "assistant":
            tc_stmt = select(ToolCall).where(ToolCall.initiating_message_id == msg.message_id)
            tc_result = await db.execute(tc_stmt)
            tool_calls = tc_result.scalars().all()

        message_responses.append(
            SessionMessageResponse(
                id=msg.id,
                session_id=msg.session_id,
                message_id=msg.message_id,
                platform=msg.platform,
                instance_id=msg.instance_id,
                source_session_id=msg.source_session_id,
                source_message_id=msg.source_message_id,
                parent_message_id=msg.parent_message_id,
                role=msg.role,
                timestamp=msg.timestamp,
                content_text=msg.content_text,
                provider=msg.provider,
                model_id=msg.model_id,
                input_tokens=msg.input_tokens,
                output_tokens=msg.output_tokens,
                total_tokens=msg.total_tokens,
                stop_reason=msg.stop_reason,
                error_message=msg.error_message,
                created_at=msg.created_at,
                tool_calls=[ToolCallSummary.model_validate(tc, from_attributes=True) for tc in tool_calls],
            )
        )

    return SessionMessagesListResponse(
        messages=message_responses,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.delete("/{session_id}")
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a session and all associated data."""
    stmt = select(Session).where(Session.session_id == session_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await db.delete(session)
    await db.commit()
    return {"message": f"Session {session_id} deleted successfully"}
