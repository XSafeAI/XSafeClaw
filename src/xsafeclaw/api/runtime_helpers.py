"""Shared runtime helpers for API routes."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy import Select

from ..runtime import RuntimeInstance, RuntimeRegistry, decode_chat_session_key

runtime_registry = RuntimeRegistry()


def serialize_instance(instance: RuntimeInstance) -> dict[str, Any]:
    """Serialize a runtime instance for API responses."""
    return {
        "instance_id": instance.instance_id,
        "platform": instance.platform,
        "display_name": instance.display_name,
        "config_path": instance.config_path,
        "workspace_path": instance.workspace_path,
        "sessions_path": instance.sessions_path,
        "serve_base_url": instance.serve_base_url,
        "gateway_base_url": instance.gateway_base_url,
        "discovery_mode": instance.discovery_mode,
        "enabled": instance.enabled,
        "is_default": instance.is_default,
        "capabilities": instance.capabilities,
        "attach_state": instance.attach_state,
        "health_status": instance.health_status,
        "meta": instance.meta,
    }


async def list_instances() -> list[RuntimeInstance]:
    """Return all known runtime instances."""
    return await runtime_registry.get_instances()


async def get_instance(instance_id: str) -> RuntimeInstance:
    """Resolve one runtime instance or raise 404."""
    instance = await runtime_registry.get_instance(instance_id)
    if instance is None:
        raise HTTPException(status_code=404, detail=f"Runtime instance not found: {instance_id}")
    return instance


async def get_default_instance(*, require_enabled: bool = True) -> RuntimeInstance:
    """Resolve the default instance or raise 503."""
    instance = await runtime_registry.get_default_instance()
    if instance is None:
        raise HTTPException(status_code=503, detail="No runtime instance is configured")
    if require_enabled and not instance.enabled:
        raise HTTPException(status_code=503, detail=f"Runtime instance is disabled: {instance.instance_id}")
    return instance


def require_capability(instance: RuntimeInstance, capability: str) -> None:
    """Ensure an instance exposes a capability."""
    if instance.capabilities.get(capability):
        return
    raise HTTPException(
        status_code=400,
        detail=(
            f"Runtime '{instance.display_name}' does not support capability '{capability}'"
        ),
    )


async def resolve_instance(
    *,
    instance_id: str | None = None,
    session_key: str | None = None,
    require_enabled: bool = True,
    capability: str | None = None,
) -> RuntimeInstance:
    """Resolve an instance from explicit selection or encoded session key."""
    decoded_instance_id = None
    if session_key:
        _, decoded_instance_id, _ = decode_chat_session_key(session_key)

    if instance_id:
        instance = await get_instance(instance_id)
    elif decoded_instance_id:
        instance = await get_instance(decoded_instance_id)
    else:
        instance = await get_default_instance(require_enabled=require_enabled)

    if require_enabled and not instance.enabled:
        raise HTTPException(status_code=503, detail=f"Runtime instance is disabled: {instance.instance_id}")
    if capability:
        require_capability(instance, capability)
    return instance


def apply_runtime_filters(
    stmt: Select[Any],
    model: Any,
    *,
    platform: str | None = None,
    instance_id: str | None = None,
) -> Select[Any]:
    """Apply optional runtime filters to a SQLAlchemy select."""
    if platform:
        stmt = stmt.where(model.platform == platform)
    if instance_id:
        stmt = stmt.where(model.instance_id == instance_id)
    return stmt


def unavailable_payload(
    *,
    instance: RuntimeInstance | None,
    reason: str,
    key: str,
) -> dict[str, Any]:
    """Standard payload for unsupported runtime-specific features."""
    return {
        key: [],
        "unavailable": True,
        "reason": reason,
        "instance": serialize_instance(instance) if instance else None,
    }
