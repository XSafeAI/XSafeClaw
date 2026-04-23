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
        model: str | None = None,
    ):
        """Async generator that streams chat response via SSE.

        Yields dicts compatible with ``GatewayClient.stream_chat()``:
          {"type": "delta",   "text": "<cumulative text so far>"}
          {"type": "final",   "text": "<final text>", "stop_reason": ...}
          {"type": "error",   "text": "<error message>"}
          {"type": "timeout", "text": "<partial text>"}

        ``model`` (§43f / §43i) — **cosmetic only**. Verified against
        ``hermes-agent/gateway/platforms/api_server.py::_handle_chat_completions``
        L715 (``model_name = body.get("model", self._model_name)``): this
        value is used solely to fill the ``"model"`` field in the response
        for OpenAI-client compatibility. It is NEVER passed to ``_run_agent``
        or ``_create_agent`` and has zero effect on routing.
        Real per-session routing is implemented in ``chat.py`` (§43i):
        before each ``stream_chat`` call, ``chat.py`` rewrites
        ``~/.hermes/config.yaml::model.default + provider`` under the
        ``_HermesYamlRWLock`` to the session's bound model. Hermes re-reads
        the yaml on every request via ``_create_agent`` (verified
        ``api_server.py`` L529-534), so the rewrite takes effect on the
        next outbound call with no restart and no hot-reload polling wait.
        We still write ``body["model"]`` so the response echoes the right
        id back to compliant OpenAI clients.
        """
        client = await self._ensure_client()

        messages: list[dict[str, str]] = [{"role": "user", "content": message}]

        body: dict[str, Any] = {
            "model": (model or "").strip() or "hermes-agent",
            "messages": messages,
            "stream": True,
        }

        headers = self._headers()
        headers["X-Hermes-Session-Id"] = session_key

        cumulative_text = ""
        final_yielded = False

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
                        final_yielded = True
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
                        final_yielded = True
                        return

        except httpx.TimeoutException:
            yield {"type": "timeout", "text": cumulative_text}
            return
        except Exception as exc:
            yield {"type": "error", "text": str(exc)}
            return

        # §49 — Stream closed without [DONE] / finish_reason. This is the
        # "[No response]" trap: Hermes (and some upstream adapters) silently
        # drop the SSE body when the upstream API errors AFTER returning 200
        # OK. The most common trigger is a Google quota-exceeded 429 on
        # Gemini — ``stream=False`` puts the error message in
        # ``choices[0].message.content`` (verified end-to-end with curl), but
        # ``stream=True`` returns *nothing* on the wire. Without this
        # fallback the user just sees the frontend's "[No response]" placeholder
        # and has no way to learn that their key is out of quota / the model
        # name is invalid / billing isn't set up.
        if not final_yielded:
            if cumulative_text:
                # Stream had real content but no terminator — emit a final so
                # callers see the same shape as a clean run.
                yield {
                    "type": "final",
                    "text": cumulative_text,
                    "stop_reason": "stop",
                    "usage": None,
                }
                return

            # Empty stream → retry the same request with ``stream=False`` and
            # hand the recovered ``message.content`` back to the caller. Only
            # fires for already-failed requests, so the doubled outbound call
            # never affects the happy path. Any text we recover is treated as
            # the assistant turn (it's typically an upstream error message,
            # which is exactly what the user needs to see).
            try:
                fallback = await self.send_chat(
                    session_key=session_key,
                    message=message,
                    timeout_ms=timeout_ms,
                    model=model,
                )
            except Exception as exc:
                yield {
                    "type": "error",
                    "text": (
                        "Hermes streamed an empty response and the non-stream "
                        f"fallback also failed: {exc}"
                    ),
                }
                return

            recovered = (fallback.get("response_text") or "").strip()
            if recovered:
                yield {"type": "delta", "text": recovered}
                yield {
                    "type": "final",
                    "text": recovered,
                    "stop_reason": fallback.get("stop_reason") or "stop",
                    "usage": fallback.get("usage"),
                }
            else:
                yield {
                    "type": "error",
                    "text": (
                        "Hermes returned no content in either streaming or "
                        "non-streaming mode. Common causes: upstream API "
                        "quota exceeded (check your provider dashboard), an "
                        "invalid model name, or Hermes failed to start the "
                        "agent (see ~/.hermes/gateway.log or "
                        "`journalctl --user -u 'hermes-*'`)."
                    ),
                }

    async def send_chat(
        self,
        session_key: str,
        message: str,
        thinking: str | None = None,
        timeout_ms: int | None = None,
        model: str | None = None,
    ) -> dict:
        """Send a message and wait for the complete response (non-streaming).

        ``model`` (§43f / §43i) — see ``stream_chat`` docstring; same contract.
        Cosmetic only; routing comes from ``chat.py``'s yaml-pin under
        ``_HermesYamlRWLock``.
        """
        client = await self._ensure_client()

        messages: list[dict[str, str]] = [{"role": "user", "content": message}]
        body: dict[str, Any] = {
            "model": (model or "").strip() or "hermes-agent",
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
