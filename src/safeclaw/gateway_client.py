"""
OpenClaw Gateway WebSocket client for Python.

Connects to the local OpenClaw gateway using device identity (Ed25519 signing)
so that the gateway grants the requested scopes (including operator.write).
"""

import asyncio
import base64
import json
import uuid
from pathlib import Path
from typing import Any


# ─── Helpers ────────────────────────────────────────────────────────────────

async def _load_gateway_config() -> dict:
    """Load gateway config from ~/.openclaw/openclaw.json."""
    p = Path.home() / ".openclaw" / "openclaw.json"
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8")).get("gateway", {})


def _load_device_identity() -> dict | None:
    """Load device identity (Ed25519 key) from ~/.openclaw/identity/device.json."""
    p = Path.home() / ".openclaw" / "identity" / "device.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def _b64url_encode(data: bytes) -> str:
    """URL-safe base64 without padding (same as OpenClaw's base64UrlEncode)."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _sign_payload(private_key_pem: str, payload: str) -> str:
    """Sign payload string with Ed25519 private key → base64url signature."""
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    key = load_pem_private_key(private_key_pem.encode(), password=None)
    sig = key.sign(payload.encode("utf-8"))  # type: ignore[arg-type]
    return _b64url_encode(sig)


def _public_key_raw_b64url(private_key_pem: str) -> str:
    """Derive raw public key bytes from PEM private key → base64url."""
    from cryptography.hazmat.primitives.serialization import (
        load_pem_private_key, Encoding, PublicFormat,
    )
    key = load_pem_private_key(private_key_pem.encode(), password=None)
    raw = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)  # type: ignore
    return _b64url_encode(raw)


def _build_device_auth_payload(
    device_id: str,
    client_id: str,
    client_mode: str,
    role: str,
    scopes: list[str],
    signed_at_ms: int,
    token: str | None,
    nonce: str | None,
) -> str:
    """
    Reproduces OpenClaw's buildDeviceAuthPayload().

    Format (v2 with nonce):
      v2|deviceId|clientId|clientMode|role|scope1,scope2|signedAtMs|token|nonce
    """
    version = "v2" if nonce else "v1"
    parts = [
        version,
        device_id,
        client_id,
        client_mode,
        role,
        ",".join(scopes),
        str(signed_at_ms),
        token or "",
    ]
    if version == "v2":
        parts.append(nonce or "")
    return "|".join(parts)


# ─── GatewayClient ──────────────────────────────────────────────────────────

class GatewayClient:
    """Async WebSocket client for the OpenClaw gateway with device identity auth."""

    def __init__(self, url: str | None = None, token: str | None = None):
        self._url = url
        self._token = token
        self._device: dict | None = None          # device.json contents
        self._ws: Any = None
        self._pending: dict[str, asyncio.Future] = {}
        self._event_handlers: list = []
        self._connected = asyncio.Event()
        self._reader_task: asyncio.Task | None = None

    async def connect(self) -> None:
        """Connect to the gateway and complete the HelloOk handshake."""
        import websockets

        if not self._url or not self._token:
            cfg = await _load_gateway_config()
            if not self._url:
                port = cfg.get("port", 18789)
                self._url = f"ws://127.0.0.1:{port}"
            if not self._token:
                self._token = cfg.get("auth", {}).get("token")

        # Load device identity for signing
        self._device = _load_device_identity()

        self._ws = await websockets.connect(
            self._url, max_size=25 * 1024 * 1024, close_timeout=5,
        )
        self._reader_task = asyncio.create_task(self._read_loop())

        # _read_loop will fire _send_connect when the challenge arrives.
        # If no challenge within 2 s, send connect without nonce.
        try:
            await asyncio.wait_for(self._connected.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            await self._send_connect(nonce=None)
            await asyncio.wait_for(self._connected.wait(), timeout=5.0)

    async def disconnect(self) -> None:
        if self._reader_task:
            self._reader_task.cancel()
            try:
                await self._reader_task
            except (asyncio.CancelledError, Exception):
                pass
        if self._ws:
            await self._ws.close()
            self._ws = None

    # ── Internal ────────────────────────────────────────────────────────────

    async def _send_connect(self, nonce: str | None) -> None:
        """Build and send the 'connect' frame with device signature."""
        client_id   = "gateway-client"
        client_mode = "ui"
        role        = "operator"
        scopes      = ["operator.admin", "operator.write", "operator.read"]
        signed_at   = int(__import__("time").time() * 1000)

        params: dict[str, Any] = {
            "minProtocol": 3,
            "maxProtocol": 3,
            "client": {
                "id":          client_id,
                "displayName": "SafeClaw",
                "version":     "1.0.0",
                "platform":    (__import__("os").environ.get("SAFECLAW_CLIENT_PLATFORM") or __import__("platform").system().lower()),
                "mode":        client_mode,
                "instanceId":  str(uuid.uuid4()),
            },
            "caps":   [],
            "role":   role,
            "scopes": scopes,
        }

        # Token auth
        if self._token:
            params["auth"] = {"token": self._token}

        # Device identity auth (provides signed scopes the gateway will trust)
        if self._device:
            try:
                device_id      = self._device["deviceId"]
                private_key_pem = self._device["privateKeyPem"]

                payload = _build_device_auth_payload(
                    device_id=device_id,
                    client_id=client_id,
                    client_mode=client_mode,
                    role=role,
                    scopes=scopes,
                    signed_at_ms=signed_at,
                    token=self._token,
                    nonce=nonce,
                )
                signature  = _sign_payload(private_key_pem, payload)
                public_key = _public_key_raw_b64url(private_key_pem)

                params["device"] = {
                    "id":        device_id,
                    "publicKey": public_key,
                    "signature": signature,
                    "signedAt":  signed_at,
                    **({"nonce": nonce} if nonce else {}),
                }
            except Exception as e:
                # If signing fails, fall back to token-only (may have limited scopes)
                print(f"⚠️  Device signing failed: {e}; falling back to token-only")

        await self._request("connect", params, is_connect=True)

    async def _request(self, method: str, params: Any = None, is_connect: bool = False) -> Any:
        req_id = str(uuid.uuid4())
        frame  = {"type": "req", "id": req_id, "method": method, "params": params or {}}
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[req_id] = future
        await self._ws.send(json.dumps(frame))
        result = await asyncio.wait_for(future, timeout=30.0)
        if is_connect:
            self._connected.set()
        return result

    async def _read_loop(self) -> None:
        try:
            async for raw in self._ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                msg_type = msg.get("type")

                if msg_type == "event":
                    event_name = msg.get("event", "")
                    if event_name == "connect.challenge":
                        nonce = msg.get("payload", {}).get("nonce")
                        asyncio.create_task(self._send_connect(nonce=nonce))
                        continue
                    for handler in list(self._event_handlers):
                        try:
                            handler(msg)
                        except Exception:
                            pass
                    continue

                if msg_type == "res":
                    req_id = msg.get("id")
                    future = self._pending.get(req_id)
                    if future and not future.done():
                        self._pending.pop(req_id, None)
                        if msg.get("ok"):
                            future.set_result(msg.get("payload"))
                        else:
                            err = msg.get("error", {}).get("message", "unknown error")
                            future.set_exception(Exception(err))
                    continue

        except asyncio.CancelledError:
            raise
        except Exception:
            pass

    # ── Chat ────────────────────────────────────────────────────────────────

    async def stream_chat(
        self,
        session_key: str,
        message: Any,
        attachments: list[dict] | None = None,
        thinking: str | None = None,
        timeout_ms: int | None = None,
    ):
        """
        Async generator that streams chat response as delta chunks.

        Yields dicts:
          {"type": "delta",   "text": "<cumulative text so far>"}
          {"type": "final",   "text": "<final text>", "stop_reason": ...}
          {"type": "aborted", "text": ""}
          {"type": "error",   "text": "<error message>"}
          {"type": "timeout", "text": "<partial text>"}

        NOTE: OpenClaw delta events are CUMULATIVE — each delta contains the
        full response text accumulated so far (not just the new chunk).
        """
        run_id = str(uuid.uuid4())
        queue: asyncio.Queue = asyncio.Queue()

        def _extract_text(msg_data: Any) -> str:
            if not isinstance(msg_data, dict):
                return ""
            content = msg_data.get("content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                parts = [
                    block.get("text", "")
                    for block in content
                    if isinstance(block, dict) and block.get("type") == "text"
                ]
                return "".join(parts)
            text = msg_data.get("text")
            return text if isinstance(text, str) else ""

        def on_event(evt: dict) -> None:
            event_name = evt.get("event", "")
            payload    = evt.get("payload", {})

            # ── Chat events (text streaming) ──────────────────────────────
            if event_name == "chat":
                if payload.get("runId") != run_id:
                    return
                state = payload.get("state")
                if state == "delta":
                    text = _extract_text(payload.get("message"))
                    queue.put_nowait({"type": "delta", "text": text, "payload": payload})
                elif state in ("final", "aborted", "error"):
                    queue.put_nowait({"type": state, "payload": payload})
                return

            # ── Agent events (tool calls) ─────────────────────────────────
            # agent events are keyed by runId; filter to our run.
            if event_name == "agent":
                if payload.get("runId") != run_id:
                    return
                stream = payload.get("stream", "")
                data   = payload.get("data") or {}
                if stream == "tool":
                    phase       = data.get("phase", "")
                    tool_id     = data.get("toolCallId", "")
                    tool_name   = data.get("name", "tool")
                    if phase == "start":
                        queue.put_nowait({
                            "type":       "tool_start",
                            "tool_id":    tool_id,
                            "tool_name":  tool_name,
                            "args":       data.get("args"),
                        })
                    elif phase == "result":
                        queue.put_nowait({
                            "type":       "tool_result",
                            "tool_id":    tool_id,
                            "tool_name":  tool_name,
                            "result":     data.get("result"),
                            "is_error":   bool(data.get("isError")),
                        })
                return

        self._event_handlers.append(on_event)
        last_text = ""

        try:
            params: dict[str, Any] = {
                "sessionKey":     session_key,
                "message":        message,
                "idempotencyKey": run_id,
            }
            if attachments:
                params["attachments"] = attachments
            if thinking:
                params["thinking"] = thinking
            if timeout_ms:
                params["timeoutMs"] = timeout_ms

            await self._request("chat.send", params)

            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=120.0)
                except asyncio.TimeoutError:
                    yield {"type": "timeout", "text": last_text}
                    return

                event_type = item["type"]
                payload    = item.get("payload", {})

                if event_type == "delta":
                    text = item["text"]
                    if text and len(text) >= len(last_text):
                        last_text = text
                        yield {"type": "delta", "text": text}

                elif event_type == "tool_start":
                    yield item   # {type, tool_id, tool_name, args}

                elif event_type == "tool_result":
                    yield item   # {type, tool_id, tool_name, result, is_error}

                elif event_type == "final":
                    final_text = _extract_text(payload.get("message")) or last_text
                    yield {
                        "type":        "final",
                        "text":        final_text,
                        "stop_reason": payload.get("stopReason"),
                        "usage":       payload.get("usage"),
                    }
                    return

                elif event_type == "aborted":
                    yield {"type": "aborted", "text": last_text}
                    return

                elif event_type == "error":
                    yield {"type": "error", "text": payload.get("errorMessage", "Unknown error")}
                    return

        except Exception as e:
            yield {"type": "error", "text": str(e)}

        finally:
            if on_event in self._event_handlers:
                self._event_handlers.remove(on_event)

    async def send_chat(
        self,
        session_key: str,
        message: Any,
        attachments: list[dict] | None = None,
        thinking: str | None = None,
        timeout_ms: int | None = None,
    ) -> dict:
        """Send a message and wait for the complete response (non-streaming)."""
        last_delta = ""
        final_event: dict | None = None
        done = asyncio.Event()

        def _extract_text(msg_data: Any) -> str:
            if not isinstance(msg_data, dict):
                return ""
            content = msg_data.get("content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                parts = [
                    block.get("text", "")
                    for block in content
                    if isinstance(block, dict) and block.get("type") == "text"
                ]
                return "".join(parts)
            return msg_data.get("text") or ""

        run_id = str(uuid.uuid4())

        def on_event(evt: dict) -> None:
            nonlocal final_event, last_delta
            if evt.get("event") != "chat":
                return
            payload = evt.get("payload", {})
            if payload.get("runId") != run_id:
                return
            state = payload.get("state")
            if state == "delta":
                text = _extract_text(payload.get("message"))
                if text and len(text) >= len(last_delta):
                    last_delta = text
            elif state in ("final", "aborted", "error"):
                final_event = payload
                done.set()

        self._event_handlers.append(on_event)
        try:
            params: dict[str, Any] = {
                "sessionKey":     session_key,
                "message":        message,
                "idempotencyKey": run_id,
            }
            if attachments:
                params["attachments"] = attachments
            if thinking:
                params["thinking"] = thinking
            if timeout_ms:
                params["timeoutMs"] = timeout_ms

            await self._request("chat.send", params)
            await asyncio.wait_for(done.wait(), timeout=120.0)

            response_text = ""
            if final_event:
                response_text = _extract_text(final_event.get("message"))
            if not response_text and last_delta:
                response_text = last_delta

            return {
                "run_id":       run_id,
                "state":        final_event.get("state", "unknown") if final_event else "timeout",
                "response_text": response_text,
                "usage":        final_event.get("usage") if final_event else None,
                "stop_reason":  final_event.get("stopReason") if final_event else None,
            }

        except asyncio.TimeoutError:
            return {
                "run_id":        run_id,
                "state":         "timeout",
                "response_text": last_delta or "[Timeout] Agent did not respond within 120 seconds.",
                "usage":         None,
                "stop_reason":   None,
            }

        finally:
            if on_event in self._event_handlers:
                self._event_handlers.remove(on_event)

    async def enable_verbose(self, session_key: str) -> None:
        """Enable verbose mode (verboseLevel=on) so tool-call agent events are broadcast."""
        try:
            await self._request("sessions.patch", {
                "key":          session_key,
                "verboseLevel": "on",
            })
        except Exception:
            pass  # non-fatal; tool events just won't show

    async def load_history(self, session_key: str, limit: int = 50) -> list:
        """Load chat history via chat.history WebSocket API."""
        result = await self._request("chat.history", {
            "sessionKey": session_key,
            "limit":      limit,
        })
        if isinstance(result, dict):
            return result.get("messages", [])
        return []
