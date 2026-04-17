"""Statistics API endpoints."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_db
from ...models import Message, Session, ToolCall
from ..runtime_helpers import apply_runtime_filters, list_instances, serialize_instance

logger = logging.getLogger(__name__)
router = APIRouter()

_OPENCLAW_DIR = Path.home() / ".openclaw"
_CONFIG_PATH = _OPENCLAW_DIR / "openclaw.json"


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
    platform: str | None = Query(None, description="Filter by runtime platform"),
    instance_id: str | None = Query(None, description="Filter by runtime instance"),
    db: AsyncSession = Depends(get_db),
):
    """Get overall statistics."""
    session_count_stmt = apply_runtime_filters(
        select(func.count(Session.session_id)),
        Session,
        platform=platform,
        instance_id=instance_id,
    )
    session_count = (await db.execute(session_count_stmt)).scalar_one()
    
    message_count_stmt = apply_runtime_filters(
        select(func.count(Message.id)),
        Message,
        platform=platform,
        instance_id=instance_id,
    )
    message_count = (await db.execute(message_count_stmt)).scalar_one()
    
    assistant_count_stmt = apply_runtime_filters(
        select(func.count(Message.id)).where(Message.role == "assistant"),
        Message,
        platform=platform,
        instance_id=instance_id,
    )
    assistant_count = (await db.execute(assistant_count_stmt)).scalar_one()
    
    user_count_stmt = apply_runtime_filters(
        select(func.count(Message.id)).where(Message.role == "user"),
        Message,
        platform=platform,
        instance_id=instance_id,
    )
    user_count = (await db.execute(user_count_stmt)).scalar_one()
    
    tool_result_count_stmt = apply_runtime_filters(
        select(func.count(Message.id)).where(Message.role == "toolResult"),
        Message,
        platform=platform,
        instance_id=instance_id,
    )
    tool_result_count = (await db.execute(tool_result_count_stmt)).scalar_one()
    
    tool_call_count_stmt = apply_runtime_filters(
        select(func.count(ToolCall.id)),
        ToolCall,
        platform=platform,
        instance_id=instance_id,
    )
    tool_call_count = (await db.execute(tool_call_count_stmt)).scalar_one()
    
    token_stats_stmt = select(
        func.sum(Message.total_tokens).label("total"),
        func.sum(Message.input_tokens).label("input"),
        func.sum(Message.output_tokens).label("output"),
    ).where(Message.role == "assistant")
    token_stats_stmt = apply_runtime_filters(
        token_stats_stmt,
        Message,
        platform=platform,
        instance_id=instance_id,
    )
    
    token_stats = (await db.execute(token_stats_stmt)).one()
    
    yesterday = datetime.now(timezone.utc) - timedelta(hours=24)
    active_sessions_stmt = apply_runtime_filters(
        select(func.count(Session.session_id)).where(Session.last_activity_at >= yesterday),
        Session,
        platform=platform,
        instance_id=instance_id,
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
    platform: str | None = Query(None, description="Filter by runtime platform"),
    instance_id: str | None = Query(None, description="Filter by runtime instance"),
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
    stmt = apply_runtime_filters(stmt, Message, platform=platform, instance_id=instance_id)
    
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
    platform: str | None = Query(None, description="Filter by runtime platform"),
    instance_id: str | None = Query(None, description="Filter by runtime instance"),
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
    stmt = apply_runtime_filters(stmt, Message, platform=platform, instance_id=instance_id)
    
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


def _read_openclaw_config() -> dict:
    if _CONFIG_PATH.exists():
        try:
            return json.loads(_CONFIG_PATH.read_text("utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _get_channels_info(config: dict) -> list[dict]:
    channels = config.get("channels", {})
    result = []
    for name, cfg in channels.items():
        result.append({
            "name": name,
            "enabled": cfg.get("enabled", True),
            "accounts": len(cfg.get("accounts", {})),
        })
    return result


def _get_model_info(config: dict) -> dict:
    primary = (
        config.get("agents", {})
        .get("defaults", {})
        .get("model", {})
        .get("primary", "")
    )
    provider = primary.split("/")[0] if "/" in primary else ""
    model_id = primary.split("/", 1)[1] if "/" in primary else primary

    providers_cfg = config.get("models", {}).get("providers", {})
    cost_cfg = {}
    for prov_name, prov_data in providers_cfg.items():
        for m in prov_data.get("models", []):
            if m.get("id") == model_id or prov_name == provider:
                cost_cfg = m.get("cost", {})
                break
        if cost_cfg:
            break

    return {
        "primary": primary,
        "provider": provider,
        "modelId": model_id,
        "cost": cost_cfg,
    }


def _compute_cost(tokens: dict, cost_cfg: dict) -> float:
    if not cost_cfg:
        return 0.0
    inp = (tokens.get("input", 0) or 0) * (cost_cfg.get("input", 0) or 0)
    out = (tokens.get("output", 0) or 0) * (cost_cfg.get("output", 0) or 0)
    cr = (tokens.get("cacheRead", 0) or 0) * (cost_cfg.get("cacheRead", 0) or 0)
    cw = (tokens.get("cacheWrite", 0) or 0) * (cost_cfg.get("cacheWrite", 0) or 0)
    return (inp + out + cr + cw) / 1_000_000


@router.get("/dashboard")
async def get_dashboard(
    platform: str | None = Query(None, description="Filter by runtime platform"),
    instance_id: str | None = Query(None, description="Filter by runtime instance"),
    db: AsyncSession = Depends(get_db),
):
    """Aggregated dashboard: sessions, channels, tokens, cost, model info."""
    instances = await list_instances()
    selected_instance = next(
        (
            instance
            for instance in instances
            if (not instance_id or instance.instance_id == instance_id)
            and (not platform or instance.platform == platform)
            and instance.enabled
        ),
        next((instance for instance in instances if instance.is_default and instance.enabled), None),
    )
    config = _read_openclaw_config() if selected_instance and selected_instance.platform == "openclaw" else {}

    session_count = (
        await db.execute(
            apply_runtime_filters(
                select(func.count(Session.session_id)),
                Session,
                platform=platform,
                instance_id=instance_id,
            )
        )
    ).scalar_one() or 0
    message_count = (
        await db.execute(
            apply_runtime_filters(
                select(func.count(Message.id)),
                Message,
                platform=platform,
                instance_id=instance_id,
            )
        )
    ).scalar_one() or 0
    assistant_count = (
        await db.execute(
            apply_runtime_filters(
                select(func.count(Message.id)).where(Message.role == "assistant"),
                Message,
                platform=platform,
                instance_id=instance_id,
            )
        )
    ).scalar_one() or 0
    user_count = (
        await db.execute(
            apply_runtime_filters(
                select(func.count(Message.id)).where(Message.role == "user"),
                Message,
                platform=platform,
                instance_id=instance_id,
            )
        )
    ).scalar_one() or 0
    tool_call_count = (
        await db.execute(
            apply_runtime_filters(
                select(func.count(ToolCall.id)),
                ToolCall,
                platform=platform,
                instance_id=instance_id,
            )
        )
    ).scalar_one() or 0

    token_row = (await db.execute(
        apply_runtime_filters(
            select(
                func.sum(Message.total_tokens).label("total"),
                func.sum(Message.input_tokens).label("input"),
                func.sum(Message.output_tokens).label("output"),
            ).where(Message.role == "assistant"),
            Message,
            platform=platform,
            instance_id=instance_id,
        )
    )).one()

    yesterday = datetime.now(timezone.utc) - timedelta(hours=24)
    active_24h = (await db.execute(
        apply_runtime_filters(
            select(func.count(Session.session_id)).where(Session.last_activity_at >= yesterday),
            Session,
            platform=platform,
            instance_id=instance_id,
        )
    )).scalar_one() or 0

    tokens = {
        "total": token_row.total or 0,
        "input": token_row.input or 0,
        "output": token_row.output or 0,
    }

    if selected_instance and selected_instance.platform != "openclaw":
        model_info = {
            "primary": str(selected_instance.meta.get("model") or ""),
            "provider": str(selected_instance.meta.get("provider") or ""),
            "modelId": str(selected_instance.meta.get("model") or "").split("/", 1)[-1],
            "cost": {},
        }
    else:
        model_info = _get_model_info(config)
    cost = _compute_cost(tokens, model_info.get("cost", {}))

    channels = _get_channels_info(config) if selected_instance and selected_instance.platform == "openclaw" else []

    model_stats_stmt = (
        select(
            Message.provider,
            Message.model_id,
            func.count(Message.id).label("count"),
            func.sum(Message.total_tokens).label("tokens"),
        )
        .where(Message.role == "assistant")
        .where(Message.provider.isnot(None))
        .group_by(Message.provider, Message.model_id)
        .order_by(func.count(Message.id).desc())
    )
    model_stats_stmt = apply_runtime_filters(
        model_stats_stmt,
        Message,
        platform=platform,
        instance_id=instance_id,
    )
    model_rows = (await db.execute(model_stats_stmt)).all()
    models = [
        {
            "provider": r.provider or "unknown",
            "modelId": r.model_id or "unknown",
            "messages": r.count or 0,
            "tokens": r.tokens or 0,
        }
        for r in model_rows
    ]

    return {
        "sessions": {
            "total": session_count,
            "active24h": active_24h,
        },
        "messages": {
            "total": message_count,
            "assistant": assistant_count,
            "user": user_count,
        },
        "toolCalls": tool_call_count,
        "tokens": tokens,
        "cost": round(cost, 6),
        "channels": channels,
        "model": model_info,
        "models": models,
        "runtime": serialize_instance(selected_instance) if selected_instance else None,
        "features": {
            "channels": bool(selected_instance and selected_instance.platform == "openclaw"),
        },
    }
