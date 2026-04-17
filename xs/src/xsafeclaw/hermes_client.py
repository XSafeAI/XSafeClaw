"""
Hermes Agent HTTP client for Python.

Connects to the local Hermes API server (OpenAI-compatible HTTP endpoints)
so that XSafeClaw can send chat messages, list models, and stream responses.

This is the Hermes counterpart of ``gateway_client.py`` (OpenClaw WebSocket).
"""

import asyncio
import json
import uuid
from typing import Any

import httpx

from .config import settings


class HermesClient:
    """Async HTTP client for the Hermes API server."""

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
    ):
        self._base_url = (base_url or f"http://127.0.0.1:{settings.hermes_api_port}").rstrip("/")
        self._api_key = api_key
        self._client: httpx.AsyncClient | None = None
        self._session_id: str | None = None

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        if self._session_id:
            headers["X-Hermes-Session-Id"] = self._session_id
        return headers

    async def connect(self) -> None:
        """Verify the Hermes API server is reachable."""
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(300, connect=10))
        try:
            resp = await self._client.get(
                f"{self._base_url}/health",
                headers=self._headers(),
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            await self.disconnect()
            raise Exception(
                f"Failed to connect to Hermes API server at {self._base_url}. "
                "Is the gateway running? Check with 'hermes status'."
            ) from exc

    async def disconnect(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            await self.connect()
        assert self._client is not None
        return self._client

    # ── Chat ────────────────────────────────────────────────────────────────

    async def stream_chat(
        self,
        session_key: str,
        message: str,
        thinking: str | None = None,
        timeout_ms: int | None = None,
        attachments: list[dict] | None = None,
    ):
        """Async generator that streams chat response via SSE.

        Yields dicts compatible with ``GatewayClient.stream_chat()``:
          {"type": "delta",   "text": "<cumulative text so far>"}
          {"type": "final",   "text": "<final text>", "stop_reason": ...}
          {"type": "error",   "text": "<error message>"}
          {"type": "timeout", "text": "<partial text>"}
        """
        client = await self._ensure_client()

        messages: list[dict[str, str]] = [{"role": "user", "content": message}]

        body: dict[str, Any] = {
            "model": "hermes-agent",
            "messages": messages,
            "stream": True,
        }

        headers = self._headers()
        headers["X-Hermes-Session-Id"] = session_key

        cumulative_text = ""

        try:
            async with client.stream(
                "POST",
                f"{self._base_url}/v1/chat/completions",
                json=body,
                headers=headers,
                timeout=httpx.Timeout(
                    timeout_ms / 1000 if timeout_ms else 300,
                    connect=10,
                ),
            ) as resp:
                if resp.status_code != 200:
                    error_body = await resp.aread()
                    yield {"type": "error", "text": f"HTTP {resp.status_code}: {error_body.decode(errors='replace')}"}
                    return

                session_id = resp.headers.get("X-Hermes-Session-Id")
                if session_id:
                    self._session_id = session_id

                async for raw_line in resp.aiter_lines():
                    line = raw_line.strip()
                    if not line:
                        continue
                    if line == "data: [DONE]":
                        yield {
                            "type": "final",
                            "text": cumulative_text,
                            "stop_reason": "stop",
                            "usage": None,
                        }
                        return
                    if not line.startswith("data: "):
                        continue

                    try:
                        chunk = json.loads(line[6:])
                    except json.JSONDecodeError:
                        continue

                    choices = chunk.get("choices", [])
                    if not choices:
                        continue

                    delta = choices[0].get("delta", {})
                    finish_reason = choices[0].get("finish_reason")

                    content = delta.get("content")
                    if content:
                        cumulative_text += content
                        yield {"type": "delta", "text": cumulative_text}

                    if finish_reason:
                        yield {
                            "type": "final",
                            "text": cumulative_text,
                            "stop_reason": finish_reason,
                            "usage": chunk.get("usage"),
                        }
                        return

        except httpx.TimeoutException:
            yield {"type": "timeout", "text": cumulative_text}
        except Exception as exc:
            yield {"type": "error", "text": str(exc)}

    async def send_chat(
        self,
        session_key: str,
        message: str,
        thinking: str | None = None,
        timeout_ms: int | None = None,
    ) -> dict:
        """Send a message and wait for the complete response (non-streaming)."""
        client = await self._ensure_client()

        messages: list[dict[str, str]] = [{"role": "user", "content": message}]
        body: dict[str, Any] = {
            "model": "hermes-agent",
            "messages": messages,
            "stream": False,
        }

        headers = self._headers()
        headers["X-Hermes-Session-Id"] = session_key

        run_id = str(uuid.uuid4())

        try:
            resp = await client.post(
                f"{self._base_url}/v1/chat/completions",
                json=body,
                headers=headers,
                timeout=httpx.Timeout(
                    timeout_ms / 1000 if timeout_ms else 120,
                    connect=10,
                ),
            )

            session_id = resp.headers.get("X-Hermes-Session-Id")
            if session_id:
                self._session_id = session_id

            if resp.status_code != 200:
                return {
                    "run_id": run_id,
                    "state": "error",
                    "response_text": f"HTTP {resp.status_code}: {resp.text}",
                    "usage": None,
                    "stop_reason": None,
                }

            data = resp.json()
            choices = data.get("choices", [])
            response_text = ""
            stop_reason = None
            if choices:
                response_text = choices[0].get("message", {}).get("content", "")
                stop_reason = choices[0].get("finish_reason")

            usage = data.get("usage")

            return {
                "run_id": run_id,
                "state": "final",
                "response_text": response_text,
                "usage": usage,
                "stop_reason": stop_reason,
            }

        except httpx.TimeoutException:
            return {
                "run_id": run_id,
                "state": "timeout",
                "response_text": "[Timeout] Agent did not respond in time.",
                "usage": None,
                "stop_reason": None,
            }
        except Exception as exc:
            return {
                "run_id": run_id,
                "state": "error",
                "response_text": f"[Error] {exc}",
                "usage": None,
                "stop_reason": None,
            }

    @property
    def last_session_id(self) -> str | None:
        """The most recent Hermes-assigned session ID (from ``X-Hermes-Session-Id`` header)."""
        return self._session_id

    # ── Models ──────────────────────────────────────────────────────────────

    async def list_models(self) -> dict | list:
        """Return the Hermes API server's model catalog."""
        client = await self._ensure_client()
        resp = await client.get(
            f"{self._base_url}/v1/models",
            headers=self._headers(),
        )
        resp.raise_for_status()
        return resp.json()

    # ── Session helpers (compatibility shims for GatewayClient API) ───────

    async def enable_verbose(self, session_key: str) -> None:
        """No-op for Hermes (verbose mode is not applicable to HTTP API)."""
        pass

    async def patch_session(
        self,
        session_key: str,
        *,
        label: str | None = None,
        model_override: str | None = None,
        provider_override: str | None = None,
        verbose_level: str | None = None,
        model: str | None = None,
        thinking_level: str | None = None,
    ) -> dict | None:
        """No-op shim — Hermes API server is stateless per-request.

        Model selection is passed via the ``model`` field in each request body,
        not via a session patch.
        """
        return None

    async def load_history(self, session_key: str, limit: int = 50) -> list:
        """Load chat history is not supported via Hermes HTTP API.

        History is read from session JSONL files instead.
        """
        return []
