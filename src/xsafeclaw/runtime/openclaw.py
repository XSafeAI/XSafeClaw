"""OpenClaw runtime helpers."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..config import settings
from ..parsers import JSONLParser
from .parsing import (
    ParsedMessage,
    ParsedSessionBatch,
    ParsedSessionInfo,
    ParsedToolCall,
    ParsedToolResult,
)

OPENCLAW_HOME = Path.home() / ".openclaw"
OPENCLAW_CONFIG_PATH = OPENCLAW_HOME / "openclaw.json"


def _read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def discover_openclaw_instance() -> dict[str, Any] | None:
    """Best-effort discovery of the default OpenClaw runtime."""
    sessions_path = Path(settings.OPENCLAW_SESSIONS_DIR).expanduser()
    config = _read_json(OPENCLAW_CONFIG_PATH) if OPENCLAW_CONFIG_PATH.exists() else {}
    workspace = config.get("workspace")
    gateway = config.get("gateway", {}) if isinstance(config, dict) else {}
    host = str(gateway.get("bind") or "127.0.0.1")
    if host in {"loopback", "0.0.0.0"}:
        host = "127.0.0.1"
    port = int(gateway.get("port") or 18789)

    if not OPENCLAW_CONFIG_PATH.exists() and not sessions_path.exists():
        return None

    return {
        "instance_id": "openclaw-default",
        "platform": "openclaw",
        "display_name": "OpenClaw",
        "config_path": str(OPENCLAW_CONFIG_PATH),
        "workspace_path": str(Path(workspace).expanduser()) if workspace else None,
        "sessions_path": str(sessions_path),
        "gateway_base_url": f"ws://{host}:{port}",
        "serve_base_url": None,
        "meta": {
            "workspace": workspace,
            "config_exists": OPENCLAW_CONFIG_PATH.exists(),
        },
    }


def openclaw_capabilities() -> dict[str, bool]:
    """Return OpenClaw's static capability map."""
    return {
        "monitoring": True,
        "history": True,
        "chat": True,
        "model_list": True,
        "health_check": True,
        "guard_observe": True,
        "guard_blocking": True,
        "onboard": True,
        "multi_instance": False,
    }


def _normalize_text_content(content: Any) -> tuple[str, list[dict[str, Any]] | None]:
    blocks: list[dict[str, Any]] = []
    text_parts: list[str] = []
    if isinstance(content, list):
        for item in content:
            if not isinstance(item, dict):
                continue
            blocks.append(item)
            if item.get("type") == "text" and item.get("text"):
                text_parts.append(str(item["text"]))
    elif isinstance(content, str):
        text_parts.append(content)
        blocks = [{"type": "text", "text": content}] if content else []
    return " ".join(part for part in text_parts if part).strip(), blocks or None


async def parse_openclaw_session_file(
    file_path: Path,
    *,
    start_line: int = 0,
) -> ParsedSessionBatch:
    """Parse one OpenClaw session JSONL file."""
    parser = JSONLParser(file_path)
    total_lines = parser.get_line_count()
    session_entry = await parser.get_session_info()
    source_session_id = file_path.stem
    first_seen_at = (
        session_entry.timestamp if session_entry else datetime.now(timezone.utc)
    )
    session = ParsedSessionInfo(
        source_session_id=source_session_id,
        session_key=source_session_id,
        first_seen_at=first_seen_at,
        last_activity_at=first_seen_at,
        cwd=session_entry.cwd if session_entry else None,
        jsonl_file_path=str(file_path),
    )

    messages: list[ParsedMessage] = []
    async for entry in parser.parse_entries(start_line=start_line):
        if entry.entry_type == "model_change":
            session.current_model_provider = entry.raw_data.get("provider")
            session.current_model_name = entry.raw_data.get("modelId")
            session.last_activity_at = entry.timestamp
            continue

        if entry.entry_type != "message":
            continue

        message_id = entry.entry_id or f"line-{len(messages) + start_line + 1}"
        msg_data = entry.raw_data.get("message", {})
        role = msg_data.get("role", "unknown")
        content = msg_data.get("content")
        content_text, blocks = _normalize_text_content(content)

        tool_calls: list[ParsedToolCall] = []
        if isinstance(content, list):
            for item in content:
                if not isinstance(item, dict) or item.get("type") != "toolCall":
                    continue
                tool_call_id = item.get("id")
                if not tool_call_id:
                    continue
                tool_calls.append(
                    ParsedToolCall(
                        source_tool_call_id=str(tool_call_id),
                        tool_name=str(item.get("name") or "unknown"),
                        arguments=(
                            item.get("arguments")
                            if isinstance(item.get("arguments"), dict)
                            else item.get("input")
                        ),
                    )
                )

        tool_result = None
        if role == "toolResult":
            details = (
                msg_data.get("details", {})
                if isinstance(msg_data.get("details"), dict)
                else {}
            )
            tool_result = ParsedToolResult(
                source_tool_call_id=str(msg_data.get("toolCallId") or ""),
                result_text=content_text,
                result_json=details or None,
                is_error=bool(msg_data.get("isError", False)),
                exit_code=details.get("exitCode"),
                cwd=details.get("cwd"),
                duration_seconds=(
                    float(details.get("durationMs")) / 1000.0
                    if details.get("durationMs") is not None
                    else None
                ),
            )

        usage = msg_data.get("usage", {}) if isinstance(msg_data.get("usage"), dict) else {}
        normalized_role = "toolResult" if role == "toolResult" else role
        parsed = ParsedMessage(
            source_message_id=str(message_id),
            source_parent_message_id=entry.parent_id,
            role=normalized_role,
            timestamp=entry.timestamp,
            content_text=content_text,
            content_json=blocks,
            provider=msg_data.get("provider"),
            model_id=msg_data.get("model"),
            model_api=msg_data.get("api"),
            input_tokens=usage.get("input"),
            output_tokens=usage.get("output"),
            total_tokens=usage.get("totalTokens"),
            cache_read_tokens=usage.get("cacheRead"),
            cache_write_tokens=usage.get("cacheWrite"),
            stop_reason=msg_data.get("stopReason"),
            raw_entry=entry.raw_data,
            tool_calls=tool_calls,
            tool_result=tool_result,
        )
        messages.append(parsed)
        session.last_activity_at = parsed.timestamp

    return ParsedSessionBatch(session=session, messages=messages, total_lines=total_lines)
