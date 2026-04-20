"""Nanobot lifecycle hook that delegates tool-call checks to XSafeClaw."""

from __future__ import annotations

import logging
from typing import Any

import httpx

try:
    from nanobot.agent.hook import AgentHook, AgentHookContext
except Exception:  # pragma: no cover - lets XSafeClaw import without nanobot installed.
    AgentHookContext = Any

    class AgentHook:  # type: ignore[no-redef]
        def __init__(self, reraise: bool = False) -> None:
            self._reraise = reraise


logger = logging.getLogger(__name__)


class XSafeClawHook(AgentHook):
    """Guard nanobot tool calls through XSafeClaw before execution."""

    def __init__(
        self,
        config: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        options = {**(config if isinstance(config, dict) else {}), **kwargs}
        super().__init__(reraise=bool(options.get("reraise", False)))
        self.mode = str(options.get("mode") or "observe").strip().lower()
        if self.mode not in {"observe", "blocking"}:
            self.mode = "observe"
        self.base_url = str(options.get("base_url") or "http://127.0.0.1:6874").rstrip("/")
        self.instance_id = str(options.get("instance_id") or "nanobot-default")
        self.session_key = str(options.get("session_key") or "")
        try:
            self.timeout_s = float(options.get("timeout_s") or 305.0)
        except (TypeError, ValueError):
            self.timeout_s = 305.0
        self.channel = str(options.get("channel") or "")
        self.chat_id = str(options.get("chat_id") or "")
        self.message_id = str(options.get("message_id") or "")

    def set_runtime_context(
        self,
        *,
        session_key: str = "",
        channel: str = "",
        chat_id: str = "",
        message_id: str | None = None,
    ) -> None:
        """Receive per-turn nanobot context from the autoload patch."""
        if session_key:
            self.session_key = session_key
        self.channel = channel
        self.chat_id = chat_id
        self.message_id = message_id or ""

    async def before_execute_tools(self, context: AgentHookContext) -> None:
        tool_calls = list(getattr(context, "tool_calls", []) or [])
        if not tool_calls:
            return

        remaining = []
        blocked_ids: set[str] = set()
        for tool_call in tool_calls:
            try:
                verdict = await self._check_tool_call(context, tool_call)
            except Exception:
                logger.exception("XSafeClaw nanobot guard check failed; allowing tool call")
                remaining.append(tool_call)
                continue

            if verdict.get("action") == "block":
                blocked_ids.add(str(getattr(tool_call, "id", "")))
                self._append_blocked_tool_result(
                    context,
                    tool_call,
                    str(verdict.get("reason") or "Blocked by XSafeClaw"),
                )
            else:
                remaining.append(tool_call)

        if not blocked_ids:
            return

        context.tool_calls = remaining
        response = getattr(context, "response", None)
        if response is not None and hasattr(response, "tool_calls"):
            response.tool_calls = remaining

    async def _check_tool_call(
        self,
        context: AgentHookContext,
        tool_call: Any,
    ) -> dict[str, Any]:
        payload = {
            "platform": "nanobot",
            "instance_id": self.instance_id,
            "guard_mode": self.mode,
            "session_key": self.session_key,
            "tool_name": str(getattr(tool_call, "name", "tool")),
            "params": getattr(tool_call, "arguments", {}) or {},
            "messages": list(getattr(context, "messages", []) or []),
            "metadata": {
                "channel": self.channel,
                "chat_id": self.chat_id,
                "message_id": self.message_id,
            },
        }
        async with httpx.AsyncClient(timeout=self.timeout_s, trust_env=False) as client:
            response = await client.post(
                f"{self.base_url}/api/guard/runtime-tool-check",
                json=payload,
            )
        response.raise_for_status()
        data = response.json()
        return data if isinstance(data, dict) else {"action": "allow"}

    def _append_blocked_tool_result(
        self,
        context: AgentHookContext,
        tool_call: Any,
        reason: str,
    ) -> None:
        tool_call_id = str(getattr(tool_call, "id", "") or "")
        if not tool_call_id:
            return
        messages = getattr(context, "messages", None)
        if not isinstance(messages, list):
            return
        messages.append(
            {
                "role": "tool",
                "tool_call_id": tool_call_id,
                "name": str(getattr(tool_call, "name", "tool")),
                "content": f"Error: XSafeClaw blocked this tool call. {reason}",
            }
        )
