"""In-memory Hermes event bridge for chat SSE merging.

This module is intentionally Hermes-only:
- No DB writes
- No guard decision involvement
- Best-effort event buffering by session
"""

from __future__ import annotations

import json
import threading
import time
from collections import defaultdict, deque
from typing import Any

_ALLOWED_TYPES = {
    "tool_start",
    "tool_result",
    "tool_blocked",
    "status",
    "trace_start",
    "trace_step",
    "trace_status",
    "reasoning_summary",
    "approval_pending",
    "approval_resolved",
    "trace_end",
}

_TIMELINE_METADATA_KEYS = ("tool_category", "tool_action", "timeline_kind", "risk_level")


def _bounded_text(value: Any, *, max_chars: int) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        if len(value) <= max_chars:
            return value
        return f"{value[:max_chars]}... [truncated {len(value) - max_chars} chars]"
    try:
        rendered = json.dumps(value, ensure_ascii=False)
    except Exception:
        rendered = str(value)
    if len(rendered) <= max_chars:
        return value
    return f"{rendered[:max_chars]}... [truncated {len(rendered) - max_chars} chars]"


class HermesEventBridge:
    """Session-scoped memory queue for Hermes runtime events."""

    def __init__(
        self,
        *,
        session_ttl_s: float = 15 * 60.0,
        max_events_per_session: int = 200,
        max_result_chars: int = 20_000,
        max_text_chars: int = 4_000,
    ) -> None:
        self._session_ttl_s = float(session_ttl_s)
        self._max_events_per_session = int(max(1, max_events_per_session))
        self._max_result_chars = int(max(128, max_result_chars))
        self._max_text_chars = int(max(128, max_text_chars))
        self._events: dict[str, deque[dict[str, Any]]] = defaultdict(deque)
        self._last_seen_at: dict[str, float] = {}
        self._sequence_by_session: dict[str, int] = defaultdict(int)
        self._pending_tool_ids: dict[str, dict[str, deque[str]]] = defaultdict(
            lambda: defaultdict(deque)
        )
        self._lock = threading.Lock()

    def _cleanup_expired(self, now: float) -> None:
        expired = [
            session_key
            for session_key, seen_at in self._last_seen_at.items()
            if now - seen_at > self._session_ttl_s
        ]
        for session_key in expired:
            self._events.pop(session_key, None)
            self._last_seen_at.pop(session_key, None)
            self._sequence_by_session.pop(session_key, None)
            self._pending_tool_ids.pop(session_key, None)

    def _next_tool_id(self, session_key: str) -> str:
        self._sequence_by_session[session_key] += 1
        return f"hermes-{session_key}-{self._sequence_by_session[session_key]}"

    def _normalize_event(
        self,
        *,
        session_key: str,
        event: dict[str, Any],
    ) -> dict[str, Any] | None:
        event_type = str(event.get("type") or event.get("event_type") or "").strip()
        if event_type not in _ALLOWED_TYPES:
            return None

        normalized: dict[str, Any] = {"type": event_type}
        if event_type == "status":
            text = str(event.get("text") or "").strip()
            if not text:
                return None
            normalized["text"] = _bounded_text(text, max_chars=self._max_text_chars)
            return normalized

        if event_type in {
            "trace_start",
            "trace_step",
            "trace_status",
            "reasoning_summary",
            "approval_pending",
            "approval_resolved",
            "trace_end",
        }:
            text = str(event.get("text") or "").strip()
            summary = str(event.get("summary") or "").strip()
            phase = str(event.get("phase") or "").strip()
            if text:
                normalized["text"] = _bounded_text(text, max_chars=self._max_text_chars)
            if summary:
                normalized["summary"] = _bounded_text(
                    summary,
                    max_chars=self._max_text_chars,
                )
            if phase:
                normalized["phase"] = phase
            step = event.get("step")
            if isinstance(step, int):
                normalized["step"] = step
            tool_name = str(event.get("tool_name") or "").strip()
            if tool_name:
                normalized["tool_name"] = tool_name
            tool_id = str(event.get("tool_id") or event.get("tool_call_id") or "").strip()
            if tool_id:
                normalized["tool_id"] = tool_id
            if event_type == "reasoning_summary":
                normalized["reasoning_chars"] = int(
                    max(0, int(event.get("reasoning_chars") or 0))
                )
            return normalized

        tool_name = str(event.get("tool_name") or "tool").strip() or "tool"
        normalized["tool_name"] = tool_name
        tool_id = str(event.get("tool_id") or event.get("tool_call_id") or "").strip()
        pending = self._pending_tool_ids[session_key][tool_name]

        if event_type == "tool_start":
            if not tool_id:
                tool_id = self._next_tool_id(session_key)
            normalized["tool_id"] = tool_id
            normalized["args"] = event.get("args") if isinstance(event.get("args"), (dict, list, str, int, float, bool, type(None))) else str(event.get("args"))
            for key in _TIMELINE_METADATA_KEYS:
                if event.get(key):
                    normalized[key] = event[key]
            pending.append(tool_id)
            return normalized

        if event_type == "tool_result":
            if not tool_id and pending:
                tool_id = pending.popleft()
            if not tool_id:
                tool_id = self._next_tool_id(session_key)
            normalized["tool_id"] = tool_id
            normalized["result"] = _bounded_text(
                event.get("result"),
                max_chars=self._max_result_chars,
            )
            normalized["is_error"] = bool(event.get("is_error"))
            for key in _TIMELINE_METADATA_KEYS:
                if event.get(key):
                    normalized[key] = event[key]
            return normalized

        # tool_blocked
        if tool_id:
            normalized["tool_id"] = tool_id
        reason = str(event.get("reason") or "").strip()
        if reason:
            normalized["reason"] = reason
        text = str(event.get("text") or "").strip()
        if text:
            normalized["text"] = text
        for key in _TIMELINE_METADATA_KEYS:
            if event.get(key):
                normalized[key] = event[key]
        return normalized

    def publish(self, session_key: str, event: dict[str, Any]) -> bool:
        if not session_key:
            return False
        now = time.monotonic()
        with self._lock:
            self._cleanup_expired(now)
            normalized = self._normalize_event(session_key=session_key, event=event)
            if normalized is None:
                return False
            queue = self._events[session_key]
            queue.append(normalized)
            while len(queue) > self._max_events_per_session:
                queue.popleft()
            self._last_seen_at[session_key] = now
            return True

    def drain(self, session_key: str, *, max_items: int = 64) -> list[dict[str, Any]]:
        if not session_key:
            return []
        now = time.monotonic()
        with self._lock:
            self._cleanup_expired(now)
            queue = self._events.get(session_key)
            if not queue:
                return []
            items: list[dict[str, Any]] = []
            for _ in range(max(1, max_items)):
                if not queue:
                    break
                items.append(queue.popleft())
            self._last_seen_at[session_key] = now
            return items

    def reset(self) -> None:
        with self._lock:
            self._events.clear()
            self._last_seen_at.clear()
            self._sequence_by_session.clear()
            self._pending_tool_ids.clear()


hermes_event_bridge = HermesEventBridge()
