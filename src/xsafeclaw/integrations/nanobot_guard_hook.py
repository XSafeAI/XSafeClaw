"""Nanobot lifecycle hook that delegates prompt and tool checks to XSafeClaw."""

from __future__ import annotations

import logging
from pathlib import Path
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

SAFETY_FILES = ("SAFETY.md", "PERMISSION.md")
PROMPT_CONTEXT_MARKER = "<!-- XSafeClaw nanobot safety context -->"


class XSafeClawHook(AgentHook):
    """Guard nanobot prompts and tool calls through XSafeClaw."""

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
        self.inject_prompts = bool(options.get("inject_prompts", True))

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

    def prepare_initial_messages(
        self,
        initial_messages: list[dict[str, Any]],
        *,
        workspace: str | Path | None = None,
    ) -> list[dict[str, Any]]:
        """Inject SAFETY.md and PERMISSION.md into nanobot's system prompt."""
        if not self.inject_prompts:
            return initial_messages

        sections = self._policy_sections(workspace)
        if not sections:
            return initial_messages

        marker = PROMPT_CONTEXT_MARKER
        for message in initial_messages:
            if message.get("role") != "system":
                continue
            if marker in self._content_text(message.get("content")):
                return initial_messages

        context = f"{marker}\n# XSafeClaw Safety Context\n\n" + "\n\n".join(sections)
        messages = [dict(message) for message in initial_messages]
        for message in messages:
            if message.get("role") != "system":
                continue
            content = message.get("content")
            if isinstance(content, str):
                message["content"] = f"{content.rstrip()}\n\n---\n\n{context}" if content else context
            elif isinstance(content, list):
                message["content"] = [*content, {"type": "text", "text": context}]
            else:
                message["content"] = context
            return messages

        return [{"role": "system", "content": context}, *messages]

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

    def _policy_sections(self, workspace: str | Path | None) -> list[str]:
        sections = self._read_policy_sections(Path(workspace).expanduser()) if workspace else []
        if sections:
            return sections
        return self._read_policy_sections(Path(__file__).resolve().parent.parent / "data" / "templates")

    @staticmethod
    def _read_policy_sections(directory: Path) -> list[str]:
        sections: list[str] = []
        if not directory.is_dir():
            return sections
        for filename in SAFETY_FILES:
            path = directory / filename
            try:
                content = path.read_text(encoding="utf-8").strip()
            except OSError:
                continue
            if content:
                sections.append(f"## {filename}\n{content}")
        return sections

    @staticmethod
    def _content_text(content: Any) -> str:
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "\n".join(
                str(item.get("text") or item.get("content") or item)
                if isinstance(item, dict)
                else str(item)
                for item in content
            )
        return str(content or "")
