"""Hermes runtime discovery and JSONL parsing helpers."""

from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from ..config import settings
from .parsing import (
    ParsedMessage,
    ParsedSessionBatch,
    ParsedSessionInfo,
    ParsedToolCall,
    ParsedToolResult,
)


def discover_hermes_instance() -> dict[str, Any] | None:
    """Best-effort discovery of the default local Hermes runtime."""
    hermes_path = shutil.which("hermes")
    home = settings.hermes_home
    sessions_path = settings.hermes_sessions_dir
    config_path = settings.hermes_config_path
    if not (hermes_path or home.exists() or sessions_path.exists() or config_path.exists()):
        return None

    return {
        "instance_id": "hermes-default",
        "platform": "hermes",
        "display_name": "Hermes Agent",
        "config_path": str(config_path),
        "workspace_path": str(home),
        "sessions_path": str(sessions_path),
        "gateway_base_url": f"http://127.0.0.1:{settings.hermes_api_port}",
        "serve_base_url": None,
        "meta": {
            "binary_path": hermes_path,
            "api_port": settings.hermes_api_port,
            "api_key_configured": bool(settings.hermes_api_key),
        },
    }


def hermes_capabilities() -> dict[str, bool]:
    return {
        "monitoring": True,
        "history": True,
        "chat": True,
        "model_list": True,
        "health_check": True,
        "guard_observe": False,
        "guard_blocking": False,
        "onboard": True,
        "multi_instance": False,
    }


async def check_hermes_health() -> tuple[str, bool]:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"http://127.0.0.1:{settings.hermes_api_port}/health")
            if resp.status_code == 200:
                return "healthy", True
    except Exception:
        pass
    return "unreachable", False


def _parse_timestamp(value: Any, fallback: datetime) -> datetime:
    if isinstance(value, str) and value.strip():
        raw = value.strip()
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            pass
    return fallback


def _message_id(raw: dict[str, Any], line_number: int) -> str:
    explicit = raw.get("id") or raw.get("message_id") or raw.get("messageId")
    if explicit:
        return str(explicit)
    blob = json.dumps(raw, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(blob + str(line_number).encode("ascii")).hexdigest()[:24]


def _normalize_content(content: Any) -> tuple[str, Any, list[ParsedToolCall], ParsedToolResult | None]:
    text_parts: list[str] = []
    tool_calls: list[ParsedToolCall] = []
    tool_result: ParsedToolResult | None = None

    if isinstance(content, str):
        text_parts.append(content)
    elif isinstance(content, list):
        for item in content:
            if not isinstance(item, dict):
                continue
            item_type = item.get("type")
            if item_type == "text" and item.get("text"):
                text_parts.append(str(item["text"]))
            elif item_type in {"toolCall", "tool_call"}:
                tool_id = item.get("id") or item.get("tool_call_id")
                if tool_id:
                    tool_calls.append(
                        ParsedToolCall(
                            source_tool_call_id=str(tool_id),
                            tool_name=str(item.get("name") or item.get("toolName") or "unknown"),
                            arguments=item.get("arguments") if isinstance(item.get("arguments"), dict) else None,
                        )
                    )
    elif isinstance(content, dict):
        if content.get("text"):
            text_parts.append(str(content["text"]))

    return " ".join(part.strip() for part in text_parts if part).strip(), content, tool_calls, tool_result


async def parse_hermes_session_file(
    file_path: Path,
    *,
    start_line: int = 0,
) -> ParsedSessionBatch:
    """Parse Hermes JSONL files into the normalized runtime schema."""
    lines = file_path.read_text(encoding="utf-8", errors="replace").splitlines()
    total_lines = len(lines)
    source_session_id = file_path.stem
    fallback_ts = datetime.fromtimestamp(file_path.stat().st_mtime, tz=timezone.utc)
    session = ParsedSessionInfo(
        source_session_id=source_session_id,
        session_key=source_session_id,
        first_seen_at=fallback_ts,
        last_activity_at=fallback_ts,
        current_model_provider="hermes",
        current_model_name="hermes-agent",
        jsonl_file_path=str(file_path),
    )

    messages: list[ParsedMessage] = []
    for line_number, line in enumerate(lines[start_line:], start=start_line + 1):
        if not line.strip():
            continue
        try:
            raw = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(raw, dict):
            continue

        msg_data = raw.get("message") if isinstance(raw.get("message"), dict) else raw
        role = str(msg_data.get("role") or raw.get("role") or "unknown")
        timestamp = _parse_timestamp(
            msg_data.get("timestamp") or raw.get("timestamp") or raw.get("created_at"),
            fallback_ts,
        )
        content = msg_data.get("content")
        content_text, content_json, tool_calls, tool_result = _normalize_content(content)
        source_message_id = _message_id(raw, line_number)

        if role == "tool":
            tool_call_id = (
                msg_data.get("tool_call_id")
                or msg_data.get("toolCallId")
                or raw.get("tool_call_id")
                or raw.get("toolCallId")
            )
            if tool_call_id:
                tool_result = ParsedToolResult(
                    source_tool_call_id=str(tool_call_id),
                    result_text=content_text,
                    result_json=content if isinstance(content, (dict, list)) else None,
                    is_error=bool(msg_data.get("is_error") or msg_data.get("isError")),
                )

        parsed = ParsedMessage(
            source_message_id=source_message_id,
            source_parent_message_id=msg_data.get("parent_id") or raw.get("parent_id"),
            role="toolResult" if role == "tool" else role,
            timestamp=timestamp,
            content_text=content_text,
            content_json=content_json if isinstance(content_json, (dict, list)) else None,
            provider=msg_data.get("provider") or "hermes",
            model_id=msg_data.get("model") or "hermes-agent",
            raw_entry=raw,
            tool_calls=tool_calls,
            tool_result=tool_result,
        )
        messages.append(parsed)
        session.last_activity_at = parsed.timestamp
        if parsed.model_id:
            session.current_model_name = parsed.model_id

    return ParsedSessionBatch(session=session, messages=messages, total_lines=total_lines)
