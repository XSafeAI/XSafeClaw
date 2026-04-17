"""Stable ID helpers for multi-runtime namespacing."""

from __future__ import annotations

from .models import RuntimeInstance, RuntimePlatform


def _join(*parts: str) -> str:
    return "::".join(str(part) for part in parts if part is not None)


def namespace_session_id(
    platform: RuntimePlatform,
    instance_id: str,
    source_session_id: str,
) -> str:
    """Build a stable internal session ID."""
    return _join(platform, instance_id, "session", source_session_id)


def namespace_message_id(
    platform: RuntimePlatform,
    instance_id: str,
    source_session_id: str,
    source_message_id: str,
) -> str:
    """Build a stable internal message ID."""
    return _join(platform, instance_id, "message", source_session_id, source_message_id)


def namespace_tool_call_id(
    platform: RuntimePlatform,
    instance_id: str,
    source_session_id: str,
    source_tool_call_id: str,
) -> str:
    """Build a stable internal tool-call ID."""
    return _join(platform, instance_id, "tool", source_session_id, source_tool_call_id)


def encode_chat_session_key(instance: RuntimeInstance, local_session_key: str) -> str:
    """Encode a chat session key so it survives server restarts."""
    return _join(instance.platform, instance.instance_id, local_session_key)


def decode_chat_session_key(session_key: str) -> tuple[str | None, str | None, str]:
    """Decode an encoded session key, falling back to the original value."""
    parts = session_key.split("::", 2)
    if len(parts) == 3 and parts[0] in {"openclaw", "nanobot"}:
        return parts[0], parts[1], parts[2]
    return None, None, session_key
