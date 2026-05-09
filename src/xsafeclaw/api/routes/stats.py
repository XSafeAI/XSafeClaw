"""Statistics API endpoints."""

from __future__ import annotations

from collections import defaultdict
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
from ...runtime.pricing import get_builtin_catalog, lookup_price
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

    if not cost_cfg:
        cost_cfg = lookup_price(provider, model_id) or {}

    return {
        "primary": primary,
        "provider": provider,
        "modelId": model_id,
        "cost": cost_cfg,
    }


def _compute_cost(tokens: dict, cost_cfg: dict) -> float:
    cost, _ = _compute_cost_with_method(tokens, cost_cfg)
    return cost


def _compute_cost_with_method(tokens: dict, cost_cfg: dict) -> tuple[float, str]:
    if not cost_cfg:
        return 0.0, "unpriced"
    input_tokens = int(tokens.get("input", 0) or 0)
    output_tokens = int(tokens.get("output", 0) or 0)
    cache_read_tokens = int(tokens.get("cacheRead", 0) or 0)
    cache_write_tokens = int(tokens.get("cacheWrite", 0) or 0)
    total_tokens = int(tokens.get("total", 0) or 0)

    inp = input_tokens * (cost_cfg.get("input", 0) or 0)
    out = output_tokens * (cost_cfg.get("output", 0) or 0)
    cr = cache_read_tokens * (cost_cfg.get("cacheRead", 0) or 0)
    cw = cache_write_tokens * (cost_cfg.get("cacheWrite", 0) or 0)
    direct_cost = (inp + out + cr + cw) / 1_000_000
    if direct_cost > 0:
        return direct_cost, "direct"

    # Some runtimes only persist total_tokens. Keep cost non-zero when a
    # concrete price exists by applying a blended input/output rate.
    if total_tokens > 0:
        in_price = float(cost_cfg.get("input", 0) or 0)
        out_price = float(cost_cfg.get("output", 0) or 0)
        blended_price = (in_price + out_price) / 2.0
        if blended_price > 0:
            return (total_tokens * blended_price) / 1_000_000, "estimated_from_total"

    return 0.0, "direct"


def _normalize_model_key(value: str | None) -> str:
    return str(value or "").strip().lower()


def _build_price_catalog(config: dict) -> dict:
    builtin = get_builtin_catalog()
    by_provider_model: dict[tuple[str, str], dict] = dict(builtin["by_provider_model"])
    by_model: dict[str, list[dict]] = defaultdict(list)
    for k, v in builtin["by_model"].items():
        by_model[k].extend(v)

    # User-provided OpenClaw config overrides built-in prices.
    providers_cfg = config.get("models", {}).get("providers", {})
    for provider_name, provider_data in providers_cfg.items():
        provider_key = _normalize_model_key(provider_name)
        for model in provider_data.get("models", []):
            model_id = _normalize_model_key(model.get("id"))
            if not model_id:
                continue
            cost_cfg = model.get("cost") if isinstance(model.get("cost"), dict) else {}
            if not cost_cfg:
                continue
            by_provider_model[(provider_key, model_id)] = cost_cfg
            by_model[model_id] = [cost_cfg]
            if "/" in model_id:
                split_provider, bare_model = model_id.split("/", 1)
                by_provider_model[(split_provider, bare_model)] = cost_cfg
                by_model[bare_model] = [cost_cfg]
    return {"by_provider_model": by_provider_model, "by_model": by_model}


def _resolve_cost_config(catalog: dict, provider: str | None, model_id: str | None) -> dict:
    provider_key = _normalize_model_key(provider)
    model_key = _normalize_model_key(model_id)
    if not model_key:
        return {}
    by_provider_model = catalog.get("by_provider_model", {})
    by_model = catalog.get("by_model", {})
    direct = by_provider_model.get((provider_key, model_key))
    if isinstance(direct, dict):
        return direct

    if "/" in model_key:
        split_provider, bare_model = model_key.split("/", 1)
        direct = by_provider_model.get((split_provider, bare_model))
        if isinstance(direct, dict):
            return direct

    candidates = [entry for entry in by_model.get(model_key, []) if isinstance(entry, dict)]
    if len(candidates) == 1:
        return candidates[0]

    # Final fallback: fuzzy match via the built-in pricing module.
    # This covers models whose DB-recorded name doesn't exactly match
    # any catalog key but can be resolved by prefix/alias matching
    # (e.g. "gpt-4o-2024-11-20" → "gpt-4o").
    fuzzy = lookup_price(provider, model_id)
    if fuzzy:
        return fuzzy
    return {}


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
    config = _read_openclaw_config()
    price_catalog = _build_price_catalog(config)

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
                func.sum(Message.cache_read_tokens).label("cache_read"),
                func.sum(Message.cache_write_tokens).label("cache_write"),
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
        "cacheRead": token_row.cache_read or 0,
        "cacheWrite": token_row.cache_write or 0,
    }

    if selected_instance and selected_instance.platform != "openclaw":
        _non_oc_provider = str(selected_instance.meta.get("provider") or "")
        _non_oc_model = str(selected_instance.meta.get("model") or "")
        _non_oc_model_id = _non_oc_model.split("/", 1)[-1] if _non_oc_model else ""
        _non_oc_cost = (
            lookup_price(_non_oc_provider, _non_oc_model)
            or lookup_price(_non_oc_provider, _non_oc_model_id)
            or {}
        )
        model_info = {
            "primary": _non_oc_model,
            "provider": _non_oc_provider,
            "modelId": _non_oc_model_id,
            "cost": _non_oc_cost,
        }
    else:
        model_info = _get_model_info(config)
    grouped_stmt = (
        select(
            Message.provider,
            Message.model_id,
            Session.current_model_provider,
            Session.current_model_name,
            func.count(Message.id).label("count"),
            func.sum(Message.total_tokens).label("total_tokens"),
            func.sum(Message.input_tokens).label("input_tokens"),
            func.sum(Message.output_tokens).label("output_tokens"),
            func.sum(Message.cache_read_tokens).label("cache_read_tokens"),
            func.sum(Message.cache_write_tokens).label("cache_write_tokens"),
        )
        .join(Session, Message.session_id == Session.session_id, isouter=True)
        .where(Message.role == "assistant")
        .group_by(
            Message.provider,
            Message.model_id,
            Session.current_model_provider,
            Session.current_model_name,
        )
    )
    grouped_stmt = apply_runtime_filters(
        grouped_stmt,
        Message,
        platform=platform,
        instance_id=instance_id,
    )
    grouped_rows = (await db.execute(grouped_stmt)).all()

    estimated_tokens = 0
    estimated_stmt = apply_runtime_filters(
        select(Message.total_tokens, Message.raw_entry).where(Message.role == "assistant"),
        Message,
        platform=platform,
        instance_id=instance_id,
    )
    for row in (await db.execute(estimated_stmt)).all():
        meta = row.raw_entry.get("_xsafeclaw_usage") if isinstance(row.raw_entry, dict) else None
        if isinstance(meta, dict) and bool(meta.get("estimated")):
            estimated_tokens += int(row.total_tokens or 0)

    cost_breakdown = []
    unknown_cost_tokens = 0
    unknown_cost_models = 0
    total_cost = 0.0
    for row in grouped_rows:
        row_tokens = {
            "total": row.total_tokens or 0,
            "input": row.input_tokens or 0,
            "output": row.output_tokens or 0,
            "cacheRead": row.cache_read_tokens or 0,
            "cacheWrite": row.cache_write_tokens or 0,
        }
        resolved_cost_cfg = _resolve_cost_config(price_catalog, row.provider, row.model_id)
        resolved_provider = row.provider
        resolved_model_id = row.model_id
        if not resolved_cost_cfg:
            fallback_provider = row.current_model_provider
            fallback_model = row.current_model_name
            resolved_cost_cfg = _resolve_cost_config(price_catalog, fallback_provider, fallback_model)
            if resolved_cost_cfg:
                resolved_provider = fallback_provider or resolved_provider
                resolved_model_id = fallback_model or resolved_model_id

        row_cost, cost_method = _compute_cost_with_method(row_tokens, resolved_cost_cfg)
        priced = bool(resolved_cost_cfg)
        if not priced:
            unknown_cost_tokens += int(row_tokens["total"] or 0)
            unknown_cost_models += 1
        total_cost += row_cost
        cost_breakdown.append(
            {
                "provider": row.provider or "unknown",
                "modelId": row.model_id or "unknown",
                "messages": row.count or 0,
                "tokens": row_tokens,
                "priced": priced,
                "costMethod": cost_method,
                "resolvedProvider": resolved_provider or "unknown",
                "resolvedModelId": resolved_model_id or "unknown",
                "estimated_cost": round(row_cost, 6),
            }
        )

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
        "cost": round(total_cost, 6),
        "estimatedTokens": estimated_tokens,
        "costUnknownTokens": unknown_cost_tokens,
        "costUnknownModels": unknown_cost_models,
        "costBreakdown": cost_breakdown,
        "channels": channels,
        "model": model_info,
        "models": models,
        "runtime": serialize_instance(selected_instance) if selected_instance else None,
        "features": {
            "channels": bool(selected_instance and selected_instance.platform == "openclaw"),
        },
    }
