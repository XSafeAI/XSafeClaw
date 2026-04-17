"""WebSocket client for nanobot gateway chat sessions."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


def _with_query_params(url: str, params: dict[str, str]) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query.update({key: value for key, value in params.items() if value})
    return urlunsplit(
        (
            parts.scheme,
            parts.netloc,
            parts.path or "/",
            urlencode(query),
            parts.fragment,
        )
    )


def _ws_is_open(ws: object | None) -> bool:
    if ws is None:
        return False
    try:
        from websockets.connection import State

        return getattr(ws, "state", None) == State.OPEN
    except Exception:
        return not bool(getattr(ws, "closed", False))


class NanobotGatewayClient:
    """Small adapter over nanobot gateway's websocket channel."""

    def __init__(
        self,
        websocket_url: str,
        *,
        client_id: str = "xsafeclaw",
        token: str | None = None,
        connect_timeout_s: float = 10.0,
        message_timeout_s: float = 120.0,
    ) -> None:
        self.websocket_url = websocket_url
        self.client_id = client_id
        self.token = token or ""
        self.connect_timeout_s = connect_timeout_s
        self.message_timeout_s = message_timeout_s
        self.chat_id: str | None = None
        self._ws: Any | None = None

    @property
    def is_open(self) -> bool:
        return _ws_is_open(self._ws)

    async def connect(self) -> None:
        """Open the websocket and wait for nanobot's ready event."""
        import websockets

        url = _with_query_params(
            self.websocket_url,
            {"client_id": self.client_id, "token": self.token},
        )
        self._ws = await asyncio.wait_for(
            websockets.connect(url),
            timeout=self.connect_timeout_s,
        )
        ready = await asyncio.wait_for(self._recv_json(), timeout=self.connect_timeout_s)
        if ready.get("event") != "ready":
            await self.disconnect()
            raise RuntimeError(f"nanobot gateway did not send ready event: {ready}")
        self.chat_id = str(ready.get("chat_id") or "").strip() or None

    async def disconnect(self) -> None:
        ws = self._ws
        self._ws = None
        if ws is not None:
            try:
                await ws.close()
            except Exception:
                pass

    async def _recv_json(self) -> dict[str, Any]:
        if self._ws is None:
            raise RuntimeError("nanobot gateway websocket is not connected")
        raw = await self._ws.recv()
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="replace")
        if not isinstance(raw, str):
            return {"event": "message", "text": str(raw)}
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return {"event": "message", "text": raw}
        return payload if isinstance(payload, dict) else {"event": "message", "text": raw}

    async def stream_chat(
        self,
        message: str,
        *,
        timeout_s: float | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Send one user message and yield cumulative delta/final/error chunks."""
        if self._ws is None or not self.is_open:
            raise RuntimeError("nanobot gateway websocket is not connected")

        await self._ws.send(json.dumps({"content": message}, ensure_ascii=False))
        deadline = timeout_s or self.message_timeout_s
        accumulated = ""
        while True:
            payload = await asyncio.wait_for(self._recv_json(), timeout=deadline)
            event = str(payload.get("event") or "").strip()
            text = str(payload.get("text") or "")

            if event == "delta":
                accumulated += text
                yield {"type": "delta", "text": accumulated}
                continue
            if event == "stream_end":
                yield {
                    "type": "final",
                    "text": accumulated,
                    "run_id": self.chat_id or "",
                    "stop_reason": "stop",
                }
                return
            if event == "message":
                accumulated = text or accumulated
                yield {
                    "type": "final",
                    "text": accumulated,
                    "run_id": self.chat_id or "",
                    "stop_reason": "stop",
                }
                return
            if event == "error":
                raise RuntimeError(text or json.dumps(payload, ensure_ascii=False))

    async def send_chat(
        self,
        message: str,
        *,
        timeout_s: float | None = None,
    ) -> dict[str, Any]:
        final_text = ""
        stop_reason = "stop"
        async for chunk in self.stream_chat(message, timeout_s=timeout_s):
            if chunk.get("type") in {"delta", "final"}:
                final_text = str(chunk.get("text") or final_text)
            if chunk.get("type") == "final":
                stop_reason = str(chunk.get("stop_reason") or stop_reason)
        return {
            "run_id": self.chat_id or "",
            "state": "final",
            "response_text": final_text,
            "usage": None,
            "stop_reason": stop_reason,
        }
