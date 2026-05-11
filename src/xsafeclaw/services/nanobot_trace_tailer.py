"""Incremental tailer for Nanobot session JSONL tool trace events."""

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
    tool_name = str(event.get("tool_name") or "tool").strip()
    if event_type == "tool_start":
        marker = event.get("args")
    else:
        marker = event.get("result")
    marker_json = json.dumps(marker, ensure_ascii=False, sort_keys=True, default=str)
    return f"{event_type}:{tool_name}:{marker_json}"


class NanobotJsonlTraceTailer:
    """Poll a Nanobot JSONL file and emit unseen tool events for current turn."""

    def __init__(self, file_path: Path) -> None:
        self.file_path = file_path
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

    def _read_latest_turn_events(self) -> list[dict[str, Any]]:
        path = self.file_path
        if not path.exists() or not path.is_file():
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
                # JSONL may still be flushing this line; skip and retry later.
                continue
            if isinstance(entry, dict):
                entries.append(entry)

        if not entries:
            return []

        last_user_idx = -1
        for index, entry in enumerate(entries):
            if entry.get("role") == "user":
                last_user_idx = index
        if last_user_idx < 0:
            return []

        recent = entries[last_user_idx + 1 :]
        ordered_ids: list[str] = []
        tool_calls: dict[str, dict[str, Any]] = {}
        for entry in recent:
            role = entry.get("role")
            if role == "assistant":
                for block in entry.get("tool_calls") or []:
                    if not isinstance(block, dict):
                        continue
                    function = block.get("function") if isinstance(block.get("function"), dict) else {}
                    tool_id = str(block.get("id") or "").strip()
                    if not tool_id:
                        continue
                    if tool_id not in ordered_ids:
                        ordered_ids.append(tool_id)
                    args = function.get("arguments")
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except Exception:
                            args = {"raw": args}
                    tool_calls[tool_id] = {
                        "tool_id": tool_id,
                        "tool_name": str(function.get("name") or block.get("name") or "tool"),
                        "args": args,
                        "result": None,
                        "is_error": False,
                    }
            elif role == "tool":
                tool_id = str(entry.get("tool_call_id") or "").strip()
                if tool_id and tool_id in tool_calls:
                    result = _result_text(entry.get("content"))
                    tool_calls[tool_id]["result"] = result
                    tool_calls[tool_id]["is_error"] = str(result).startswith("Error")

        events: list[dict[str, Any]] = []
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
