"""Incremental tailer for OpenClaw session JSONL tool trace events."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _result_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            str(item.get("text", ""))
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        ]
        if parts:
            return "".join(parts)
    if isinstance(content, (dict, list)):
        return json.dumps(content, ensure_ascii=False)
    return str(content or "")


def _event_dedupe_key(event: dict[str, Any]) -> str:
    event_type = str(event.get("type") or "").strip().lower()
    tool_id = str(event.get("tool_id") or "").strip()
    if tool_id:
        return f"{event_type}:{tool_id}"
    if event_type not in {"tool_start", "tool_result"}:
        marker_json = json.dumps(
            {
                "text": event.get("text"),
                "phase": event.get("phase"),
                "step": event.get("step"),
            },
            ensure_ascii=False,
            sort_keys=True,
            default=str,
        )
        return f"{event_type}:{marker_json}"
    tool_name = str(event.get("tool_name") or "tool").strip()
    marker = event.get("args") if event_type == "tool_start" else event.get("result")
    marker_json = json.dumps(marker, ensure_ascii=False, sort_keys=True, default=str)
    return f"{event_type}:{tool_name}:{marker_json}"


def _loads_maybe_json(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text:
        return value
    try:
        return json.loads(text)
    except Exception:
        return value


class OpenClawJsonlTraceTailer:
    """Poll an OpenClaw session JSONL file and emit unseen current-turn tool events."""

    def __init__(self, *, sessions_json: Path, sessions_dir: Path, session_key: str) -> None:
        self.sessions_json = sessions_json
        self.sessions_dir = sessions_dir
        self.session_key = session_key
        self._seen_keys: set[str] = set()

    def poll(self, *, max_events: int = 32) -> list[dict[str, Any]]:
        events = self._read_latest_turn_events()
        if not events:
            return []
        fresh: list[dict[str, Any]] = []
        for event in events:
            key = _event_dedupe_key(event)
            if key in self._seen_keys:
                continue
            self._seen_keys.add(key)
            fresh.append(event)
            if len(fresh) >= max_events:
                break
        return fresh

    def _resolve_jsonl_path(self) -> Path | None:
        if not self.sessions_json.exists() or not self.sessions_json.is_file():
            return None
        try:
            sessions_index = json.loads(self.sessions_json.read_text(encoding="utf-8"))
        except Exception:
            return None
        if not isinstance(sessions_index, dict):
            return None

        session_info = (
            sessions_index.get(self.session_key)
            or sessions_index.get(f"agent:main:{self.session_key}")
        )
        if not isinstance(session_info, dict):
            return None
        session_id = session_info.get("sessionId") or session_info.get("session_id")
        if not session_id:
            return None
        return self.sessions_dir / f"{session_id}.jsonl"

    def _read_latest_turn_events(self) -> list[dict[str, Any]]:
        path = self._resolve_jsonl_path()
        if path is None or not path.exists() or not path.is_file():
            return []
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except Exception:
            return []

        entries: list[dict[str, Any]] = []
        for raw_line in lines:
            line = raw_line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(entry, dict):
                entries.append(entry)
        if not entries:
            return []

        last_user_idx = -1
        for index, entry in enumerate(entries):
            msg = _unwrap_message(entry)
            if isinstance(msg, dict) and msg.get("role") == "user":
                last_user_idx = index
        if last_user_idx < 0:
            return []

        ordered_ids: list[str] = []
        trace_events: list[dict[str, Any]] = []
        tool_calls: dict[str, dict[str, Any]] = {}
        for entry in entries[last_user_idx + 1 :]:
            msg = _unwrap_message(entry)
            if not isinstance(msg, dict):
                continue
            role = str(msg.get("role") or "")
            trace_events.extend(_trace_events_from_message(msg))

            if role == "assistant":
                for block in _assistant_tool_blocks(msg):
                    tool_id = str(block.get("id") or block.get("toolCallId") or "").strip()
                    if not tool_id:
                        continue
                    if tool_id not in ordered_ids:
                        ordered_ids.append(tool_id)
                    tool_calls[tool_id] = {
                        "tool_id": tool_id,
                        "tool_name": str(block.get("name") or block.get("toolName") or "tool"),
                        "args": _loads_maybe_json(block.get("input") or block.get("arguments")),
                        "result": None,
                        "is_error": False,
                    }
            elif role in {"toolResult", "tool"}:
                tool_id = str(msg.get("toolCallId") or msg.get("tool_call_id") or "").strip()
                if tool_id and tool_id in tool_calls:
                    result = _result_text(msg.get("content"))
                    tool_calls[tool_id]["result"] = result
                    tool_calls[tool_id]["is_error"] = _tool_result_is_error(msg, result)

        events: list[dict[str, Any]] = [*trace_events]
        for tool_id in ordered_ids:
            tool_call = tool_calls.get(tool_id)
            if not tool_call:
                continue
            events.append(
                {
                    "type": "tool_start",
                    "tool_id": tool_call["tool_id"],
                    "tool_name": tool_call["tool_name"],
                    "args": tool_call["args"],
                }
            )
            if tool_call["result"] is not None:
                events.append(
                    {
                        "type": "tool_result",
                        "tool_id": tool_call["tool_id"],
                        "tool_name": tool_call["tool_name"],
                        "result": tool_call["result"],
                        "is_error": bool(tool_call["is_error"]),
                    }
                )
        return events


def _unwrap_message(entry: dict[str, Any]) -> dict[str, Any] | None:
    if isinstance(entry.get("message"), dict):
        wrapped_type = str(entry.get("type") or "").strip().lower()
        if wrapped_type and wrapped_type != "message":
            return None
        return entry["message"]
    if "role" in entry:
        return entry
    return None


def _assistant_tool_blocks(msg: dict[str, Any]) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    content = msg.get("content")
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "toolCall":
                blocks.append(block)
    return blocks


def _trace_events_from_message(msg: dict[str, Any]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for key in ("reasoning_summary", "reasoning", "thinking", "trace"):
        value = msg.get(key)
        if value is not None:
            events.extend(_trace_events_from_value(value, phase=key))

    content = msg.get("content")
    if isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):
                continue
            block_type = str(block.get("type") or "").strip()
            if block_type in {"reasoning_summary", "reasoning", "thinking", "trace", "trace_step"}:
                value = block.get("text") or block.get("content") or block.get("summary")
                events.extend(_trace_events_from_value(value, phase=block_type))
    return events


def _trace_events_from_value(value: Any, *, phase: str) -> list[dict[str, Any]]:
    if value is None:
        return []
    event_type = "reasoning_summary" if phase == "reasoning_summary" else "trace_step"
    if isinstance(value, str):
        text = value.strip()
        return [{"type": event_type, "text": text, "phase": phase}] if text else []
    if isinstance(value, list):
        events: list[dict[str, Any]] = []
        for index, item in enumerate(value, start=1):
            if isinstance(item, dict):
                text = str(item.get("text") or item.get("content") or item.get("summary") or "").strip()
                item_type = str(item.get("type") or event_type)
                if item_type not in {"trace_start", "trace_step", "trace_status", "reasoning_summary", "trace_end"}:
                    item_type = event_type
                if text:
                    events.append(
                        {
                            "type": item_type,
                            "text": text,
                            "phase": str(item.get("phase") or phase),
                            "step": item.get("step") or index,
                        }
                    )
            elif item:
                text = str(item).strip()
                if text:
                    events.append({"type": event_type, "text": text, "phase": phase, "step": index})
        return events
    if isinstance(value, dict):
        text = str(value.get("text") or value.get("content") or value.get("summary") or "").strip()
        if text:
            item_type = str(value.get("type") or event_type)
            if item_type not in {"trace_start", "trace_step", "trace_status", "reasoning_summary", "trace_end"}:
                item_type = event_type
            return [
                {
                    "type": item_type,
                    "text": text,
                    "phase": str(value.get("phase") or phase),
                    **({"step": value["step"]} if "step" in value else {}),
                }
            ]
    return []


def _tool_result_is_error(msg: dict[str, Any], result_text: str) -> bool:
    if bool(msg.get("isError") or msg.get("is_error", False)):
        return True
    try:
        parsed = json.loads(str(result_text or ""))
    except Exception:
        return False
    return isinstance(parsed, dict) and bool(parsed.get("error"))
