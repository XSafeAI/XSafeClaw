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
from .usage import attach_usage_metadata, has_usage, normalize_usage


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


def _read_hermes_active_model() -> tuple[str | None, str | None]:
    """Read provider/model from Hermes config.yaml model.default."""
    config_path = settings.hermes_config_path
    if not config_path.exists():
        return None, None
    try:
        import yaml

        raw = config_path.read_text(encoding="utf-8", errors="replace")
        config = yaml.safe_load(raw) or {}
    except Exception:
        return None, None

    model_cfg = config.get("model", "")
    if isinstance(model_cfg, dict):
        default_model_raw = str(
            model_cfg.get("default", "") or model_cfg.get("model", "")
        ).strip()
        cfg_provider = str(model_cfg.get("provider", "")).strip()
    else:
        default_model_raw = str(model_cfg).strip()
        cfg_provider = ""
    if not default_model_raw:
        return None, None

    if cfg_provider and cfg_provider != "auto":
        provider = cfg_provider
    elif "/" in default_model_raw:
        provider = default_model_raw.split("/", 1)[0]
    else:
        provider = "hermes"

    model_id = default_model_raw
    if provider and not model_id.startswith(f"{provider}/") and provider != "hermes":
        model_id = f"{provider}/{default_model_raw}"
    return provider, model_id


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
    default_provider, default_model_id = _read_hermes_active_model()
    session = ParsedSessionInfo(
        source_session_id=source_session_id,
        session_key=source_session_id,
        first_seen_at=fallback_ts,
        last_activity_at=fallback_ts,
        current_model_provider=default_provider or "hermes",
        current_model_name=default_model_id or "hermes-agent",
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
        usage_raw = (
            msg_data.get("usage")
            if isinstance(msg_data.get("usage"), dict)
            else raw.get("usage")
        )
        usage_norm = normalize_usage(usage_raw if isinstance(usage_raw, dict) else None)
        usage_source = "runtime_log" if has_usage(usage_raw if isinstance(usage_raw, dict) else None) else "unknown"

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
            provider=msg_data.get("provider") or default_provider or "hermes",
            model_id=msg_data.get("model") or default_model_id or "hermes-agent",
            input_tokens=usage_norm["input_tokens"],
            output_tokens=usage_norm["output_tokens"],
            total_tokens=usage_norm["total_tokens"],
            cache_read_tokens=usage_norm["cache_read_tokens"],
            cache_write_tokens=usage_norm["cache_write_tokens"],
            raw_entry=attach_usage_metadata(
                raw,
                usage_source=usage_source,
                usage_estimated=False,
            ),
            tool_calls=tool_calls,
            tool_result=tool_result,
        )
        messages.append(parsed)
        session.last_activity_at = parsed.timestamp
        if parsed.model_id:
            session.current_model_name = parsed.model_id

    return ParsedSessionBatch(session=session, messages=messages, total_lines=total_lines)
