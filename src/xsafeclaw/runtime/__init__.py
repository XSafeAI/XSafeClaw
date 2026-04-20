"""Runtime discovery and multi-platform helpers."""

from .ids import (
    decode_chat_session_key,
    encode_chat_session_key,
    namespace_message_id,
    namespace_session_id,
    namespace_tool_call_id,
)
from .models import CAPABILITY_KEYS, RuntimeInstance, RuntimePlatform, empty_capabilities
from .registry import RuntimeRegistry

__all__ = [
    "CAPABILITY_KEYS",
    "RuntimeInstance",
    "RuntimePlatform",
    "RuntimeRegistry",
    "decode_chat_session_key",
    "encode_chat_session_key",
    "empty_capabilities",
    "namespace_message_id",
    "namespace_session_id",
    "namespace_tool_call_id",
]
