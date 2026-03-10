"""Statistics API endpoints."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_db
from ...models import Message, Session, ToolCall

router = APIRouter()


@router.post("/resync")
async def trigger_resync():
    """
    Manually trigger a full re-scan and sync of all session JSONL files.

    Useful when new session files appeared during the service startup gap and
    were not picked up by the file watcher. This endpoint directly calls
    _initial_scan() on the running MessageSyncService.
    """
    from ..main import get_message_sync_service
    svc = get_message_sync_service()
    if not svc:
        return {"status": "skipped", "reason": "MessageSyncService not running"}
    await svc._initial_scan()
    return {"status": "ok", "message": "Re-scan completed"}


class OverallStats(BaseModel):
    """Overall statistics."""

    total_sessions: int
    total_messages: int
    total_assistant_messages: int
    total_user_messages: int
    total_tool_results: int
    total_tool_calls: int
    total_tokens: int
    total_input_tokens: int
    total_output_tokens: int
    active_sessions_24h: int


class ModelStats(BaseModel):
    """Statistics by model."""

    provider: str
    model_id: str
    message_count: int
    total_tokens: int
    total_input_tokens: int
    total_output_tokens: int


class DailyStats(BaseModel):
    """Daily statistics."""

    date: str
    message_count: int
    assistant_message_count: int
    user_message_count: int
    total_tokens: int


@router.get("/overview", response_model=OverallStats)
async def get_overall_stats(
    db: AsyncSession = Depends(get_db),
):
    """Get overall statistics."""
    
    # Total sessions
    session_count_stmt = select(func.count(Session.session_id))
    session_count = (await db.execute(session_count_stmt)).scalar_one()
    
    # Total messages
    message_count_stmt = select(func.count(Message.id))
    message_count = (await db.execute(message_count_stmt)).scalar_one()
    
    # Messages by role
    assistant_count_stmt = select(func.count(Message.id)).where(Message.role == "assistant")
    assistant_count = (await db.execute(assistant_count_stmt)).scalar_one()
    
    user_count_stmt = select(func.count(Message.id)).where(Message.role == "user")
    user_count = (await db.execute(user_count_stmt)).scalar_one()
    
    tool_result_count_stmt = select(func.count(Message.id)).where(Message.role == "toolResult")
    tool_result_count = (await db.execute(tool_result_count_stmt)).scalar_one()
    
    # Total tool calls
    tool_call_count_stmt = select(func.count(ToolCall.id))
    tool_call_count = (await db.execute(tool_call_count_stmt)).scalar_one()
    
    # Token statistics (from assistant messages)
    token_stats_stmt = select(
        func.sum(Message.total_tokens).label("total"),
        func.sum(Message.input_tokens).label("input"),
        func.sum(Message.output_tokens).label("output"),
    ).where(Message.role == "assistant")
    
    token_stats = (await db.execute(token_stats_stmt)).one()
    
    # Active sessions in last 24h
    yesterday = datetime.now(timezone.utc) - timedelta(hours=24)
    active_sessions_stmt = select(func.count(Session.session_id)).where(
        Session.last_activity_at >= yesterday
    )
    active_sessions = (await db.execute(active_sessions_stmt)).scalar_one()
    
    return OverallStats(
        total_sessions=session_count or 0,
        total_messages=message_count or 0,
        total_assistant_messages=assistant_count or 0,
        total_user_messages=user_count or 0,
        total_tool_results=tool_result_count or 0,
        total_tool_calls=tool_call_count or 0,
        total_tokens=token_stats.total or 0,
        total_input_tokens=token_stats.input or 0,
        total_output_tokens=token_stats.output or 0,
        active_sessions_24h=active_sessions or 0,
    )


@router.get("/by-model", response_model=list[ModelStats])
async def get_stats_by_model(
    db: AsyncSession = Depends(get_db),
):
    """Get statistics grouped by model."""
    
    stmt = (
        select(
            Message.provider,
            Message.model_id,
            func.count(Message.id).label("message_count"),
            func.sum(Message.total_tokens).label("total_tokens"),
            func.sum(Message.input_tokens).label("total_input_tokens"),
            func.sum(Message.output_tokens).label("total_output_tokens"),
        )
        .where(Message.role == "assistant")
        .where(Message.provider.isnot(None))
        .group_by(Message.provider, Message.model_id)
        .order_by(func.count(Message.id).desc())
    )
    
    result = await db.execute(stmt)
    rows = result.all()
    
    return [
        ModelStats(
            provider=row.provider or "unknown",
            model_id=row.model_id or "unknown",
            message_count=row.message_count or 0,
            total_tokens=row.total_tokens or 0,
            total_input_tokens=row.total_input_tokens or 0,
            total_output_tokens=row.total_output_tokens or 0,
        )
        for row in rows
    ]


@router.get("/daily", response_model=list[DailyStats])
async def get_daily_stats(
    days: int = Query(7, ge=1, le=90, description="Number of days to look back"),
    db: AsyncSession = Depends(get_db),
):
    """Get daily statistics for the last N days."""
    
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    stmt = (
        select(
            func.date(Message.timestamp).label("date"),
            func.count(Message.id).label("message_count"),
            func.sum(
                func.cast(Message.role == "assistant", type_=func.Integer())
            ).label("assistant_count"),
            func.sum(
                func.cast(Message.role == "user", type_=func.Integer())
            ).label("user_count"),
            func.sum(Message.total_tokens).label("total_tokens"),
        )
        .where(Message.timestamp >= start_date)
        .group_by(func.date(Message.timestamp))
        .order_by(func.date(Message.timestamp))
    )
    
    result = await db.execute(stmt)
    rows = result.all()
    
    return [
        DailyStats(
            date=str(row.date),
            message_count=row.message_count or 0,
            assistant_message_count=row.assistant_count or 0,
            user_message_count=row.user_count or 0,
            total_tokens=row.total_tokens or 0,
        )
        for row in rows
    ]
