"""Normalized session parsing structures."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(slots=True)
class ParsedToolCall:
    """Normalized tool-call record."""

    source_tool_call_id: str
    tool_name: str
    arguments: dict[str, Any] | None = None


@dataclass(slots=True)
class ParsedToolResult:
    """Normalized tool-result record."""

    source_tool_call_id: str
    result_text: str | None = None
    result_json: dict[str, Any] | list[Any] | None = None
    is_error: bool = False
    exit_code: int | None = None
    cwd: str | None = None
    duration_seconds: float | None = None


@dataclass(slots=True)
class ParsedMessage:
    """Normalized message record."""

    source_message_id: str
    source_parent_message_id: str | None
    role: str
    timestamp: datetime
    content_text: str | None
    content_json: list[dict[str, Any]] | dict[str, Any] | None = None
    provider: str | None = None
    model_id: str | None = None
    model_api: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None
    stop_reason: str | None = None
    error_message: str | None = None
    raw_entry: dict[str, Any] | None = None
    tool_calls: list[ParsedToolCall] = field(default_factory=list)
    tool_result: ParsedToolResult | None = None


@dataclass(slots=True)
class ParsedSessionInfo:
    """Normalized session metadata."""

    source_session_id: str
    session_key: str | None
    first_seen_at: datetime
    last_activity_at: datetime | None = None
    cwd: str | None = None
    current_model_provider: str | None = None
    current_model_name: str | None = None
    jsonl_file_path: str | None = None


@dataclass(slots=True)
class ParsedSessionBatch:
    """Parsed session metadata plus newly read messages."""

    session: ParsedSessionInfo
    messages: list[ParsedMessage]
    total_lines: int
