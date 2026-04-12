"""API routes for OpenClaw agent chat sessions."""

import asyncio
import json
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ...gateway_client import GatewayClient

# Path to OpenClaw sessions directory
_OPENCLAW_DIR = Path.home() / ".openclaw"
_SESSIONS_DIR = Path.home() / ".openclaw" / "agents" / "main" / "sessions"
_SESSIONS_JSON = _SESSIONS_DIR / "sessions.json"
_CONFIG_PATH = _OPENCLAW_DIR / "openclaw.json"
_AVAILABLE_MODELS_CLI_TIMEOUT = 25
_AVAILABLE_MODELS_CACHE_TTL = 30.0
_AVAILABLE_MODELS_FAILURE_TTL = 5.0
_available_models_cache: dict[str, object] = {
    "expires_at": 0.0,
    "payload": {"models": [], "default_model": ""},
    "last_success": None,
}
_available_models_lock = None


def _get_available_models_lock() -> asyncio.Lock:
    global _available_models_lock
    if _available_models_lock is None:
        _available_models_lock = asyncio.Lock()
    return _available_models_lock


def _build_available_models_payload(raw: dict | list | None, status_raw: dict | list | None) -> dict:
    """Normalize OpenClaw CLI JSON into the frontend payload shape."""
    models = []
    inferred_default = ""

    if raw and isinstance(raw, dict):
        for model in raw.get("models", []):
            key = model.get("key", "")
            if "/" not in key:
                continue
            tags = model.get("tags") or []
            if not inferred_default and "default" in tags:
                inferred_default = key
            models.append({
                "id": key,
                "name": model.get("name", key),
                "provider": key.split("/")[0],
                "reasoning": "reasoning" in tags,
            })

    default_model = ""
    if status_raw and isinstance(status_raw, dict):
        default_model = status_raw.get("defaultModel", "")

    if not default_model:
        default_model = inferred_default or (models[0]["id"] if len(models) == 1 else "")

    return {"models": models, "default_model": default_model}


def _build_available_models_payload_from_onboard_cache() -> dict:
    """Fallback to the preloaded onboard-scan cache when CLI listing is slow."""
    try:
        from .system import _onboard_scan_cache
    except Exception:
        return {"models": [], "default_model": ""}

    if not isinstance(_onboard_scan_cache, dict):
        return {"models": [], "default_model": ""}

    models = []
    for provider in _onboard_scan_cache.get("model_providers", []) or []:
        prov_id = provider.get("id", "")
        for model in provider.get("models", []) or []:
            model_id = model.get("id", "")
            if "/" not in model_id:
                continue
            models.append({
                "id": model_id,
                "name": model.get("name", model_id),
                "provider": prov_id or model_id.split("/")[0],
                "reasoning": bool(model.get("reasoning", False)),
            })

    default_model = _onboard_scan_cache.get("default_model", "") or ""
    return {"models": models, "default_model": default_model}


def _build_available_models_payload_from_config() -> dict:
    """Fallback to configured models from ~/.openclaw/openclaw.json."""
    if not _CONFIG_PATH.exists():
        return {"models": [], "default_model": ""}

    try:
        config = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"models": [], "default_model": ""}

    providers_cfg = (
        config.get("models", {})
        .get("providers", {})
    )
    default_model = (
        config.get("agents", {})
        .get("defaults", {})
        .get("model", {})
        .get("primary", "")
    ) or ""

    models = []
    for provider, provider_cfg in providers_cfg.items():
        for model in provider_cfg.get("models", []) or []:
            model_id = str(model.get("id", "")).strip()
            if not model_id:
                continue
            full_id = model_id if "/" in model_id else f"{provider}/{model_id}"
            models.append({
                "id": full_id,
                "name": model.get("name", full_id),
                "provider": provider,
                "reasoning": bool(model.get("reasoning", False)),
            })

    if not default_model and len(models) == 1:
        default_model = models[0]["id"]

    return {"models": models, "default_model": default_model}


def _read_history_from_jsonl(session_key: str, limit: int = 100) -> list[dict]:
    """
    Read chat history from OpenClaw's local .jsonl storage.

    OpenClaw stores sessions in:
      ~/.openclaw/agents/main/sessions/sessions.json  (key → sessionId mapping)
      ~/.openclaw/agents/main/sessions/<sessionId>.jsonl  (message log)

    The chat.history WebSocket API only returns the active LLM context window,
    NOT the full persisted log. We read the files directly instead.
    """
    if not _SESSIONS_JSON.exists():
        return []

    try:
        sessions_index = json.loads(_SESSIONS_JSON.read_text(encoding="utf-8"))
    except Exception:
        return []

    # Try multiple key formats:
    # 1. Exact key (old token-only auth): "chat-abc123"
    # 2. Prefixed key (device-identity auth): "agent:main:chat-abc123"
    session_info = (
        sessions_index.get(session_key)
        or sessions_index.get(f"agent:main:{session_key}")
    )
    if not session_info:
        return []

    session_id = session_info.get("sessionId")
    if not session_id:
        return []

    jsonl_path = _SESSIONS_DIR / f"{session_id}.jsonl"
    if not jsonl_path.exists():
        return []

    import re

    messages = []
    # Pending tool calls: { toolCallId → {tool_id, tool_name, args, timestamp, entry_id} }
    # These are emitted as tool_call messages once we find the matching toolResult.
    pending_tool_calls: dict[str, dict] = {}
    # Tool calls inserted before the NEXT assistant text message
    queued_tool_calls: list[dict] = []

    try:
        for line in jsonl_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            if entry.get("type") != "message":
                continue

            msg       = entry.get("message", {})
            role      = msg.get("role", "")
            timestamp = entry.get("timestamp")
            entry_id  = entry.get("id", "")
            content   = msg.get("content", "")

            if role == "user":
                # Flush any queued tool calls before user message (shouldn't happen, but safety)
                messages.extend(queued_tool_calls)
                queued_tool_calls = []

                text = (content if isinstance(content, str) else "".join(
                    b.get("text", "") for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                ) if isinstance(content, list) else "")
                text = re.sub(r"^\[[^\]]*\d{4}-\d{2}-\d{2}[^\]]*\]\s*", "", text)
                text = re.sub(r"\n\[message_id:[^\]]*\]", "", text)
                text = text.strip()
                if text:
                    messages.append({"role": "user", "content": text, "timestamp": timestamp, "id": entry_id})

            elif role == "assistant":
                # Extract tool calls from this assistant turn's content blocks
                turn_tool_calls: list[dict] = []
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "toolCall":
                            tc_id   = block.get("id", "")
                            tc_name = block.get("name", "tool")
                            tc_args = block.get("input") or block.get("arguments")
                            if tc_id:
                                pending_tool_calls[tc_id] = {
                                    "type":      "tool_call",
                                    "role":      "tool_call",
                                    "content":   "",
                                    "tool_id":   tc_id,
                                    "tool_name": tc_name,
                                    "args":      tc_args,
                                    "result":    None,
                                    "is_error":  False,
                                    "result_pending": True,
                                    "timestamp": timestamp,
                                    "id":        f"tool-{tc_id}",
                                }
                                turn_tool_calls.append(tc_id)

                # Extract assistant text (skip toolCall blocks)
                text = "".join(
                    b.get("text", "") for b in (content if isinstance(content, list) else [])
                    if isinstance(b, dict) and b.get("type") == "text"
                ) if isinstance(content, list) else (content if isinstance(content, str) else "")
                text = text.strip()

                if text:
                    # Flush queued tool calls (from previous turn) before this text
                    messages.extend(queued_tool_calls)
                    queued_tool_calls = []
                    messages.append({"role": "assistant", "content": text, "timestamp": timestamp, "id": entry_id})

            elif role == "toolResult":
                tc_id = msg.get("toolCallId", "")
                if tc_id and tc_id in pending_tool_calls:
                    # Extract result text
                    result_content = content
                    if isinstance(result_content, list):
                        result_text = "".join(
                            b.get("text", "") for b in result_content
                            if isinstance(b, dict) and b.get("type") == "text"
                        )
                    else:
                        result_text = str(result_content) if result_content else ""

                    tc = dict(pending_tool_calls.pop(tc_id))
                    tc["result"]         = result_text
                    tc["is_error"]       = bool(msg.get("isError", False))
                    tc["result_pending"] = False
                    queued_tool_calls.append(tc)

        # Flush any remaining tool calls
        messages.extend(queued_tool_calls)

    except Exception:
        return []

    # Apply limit (take the most recent messages)
    if limit and len(messages) > limit:
        messages = messages[-limit:]

    return messages

def _read_tool_calls_from_jsonl(session_key: str) -> list[dict]:
    """
    Read the latest tool calls (since the last user message) from the JSONL file.
    Returns a list of tool_call dicts for SSE streaming.
    """
    if not _SESSIONS_JSON.exists():
        return []
    try:
        sessions_index = json.loads(_SESSIONS_JSON.read_text(encoding="utf-8"))
    except Exception:
        return []

    session_info = (
        sessions_index.get(session_key)
        or sessions_index.get(f"agent:main:{session_key}")
    )
    if not session_info:
        return []

    session_id = session_info.get("sessionId")
    if not session_id:
        return []

    jsonl_path = _SESSIONS_DIR / f"{session_id}.jsonl"
    if not jsonl_path.exists():
        return []

    try:
        entries = []
        for line in jsonl_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue

        # Find entries since the LAST user message (i.e., the most recent turn)
        last_user_idx = -1
        for i, e in enumerate(entries):
            if e.get("type") == "message" and e.get("message", {}).get("role") == "user":
                last_user_idx = i

        if last_user_idx < 0:
            return []

        recent = entries[last_user_idx + 1:]

        # Collect tool calls: match assistant messages that have tool calls
        # with the corresponding toolResult messages.
        tool_calls: dict[str, dict] = {}  # toolCallId → tool_call info

        for entry in recent:
            if entry.get("type") != "message":
                continue
            msg = entry.get("message", {})
            role = msg.get("role", "")

            if role == "assistant":
                content = msg.get("content", [])
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "toolCall":
                            tc_id   = block.get("id", "")
                            tc_name = block.get("name", "tool")
                            tc_args = block.get("input") or block.get("arguments")
                            if tc_id:
                                tool_calls[tc_id] = {
                                    "tool_id":   tc_id,
                                    "tool_name": tc_name,
                                    "args":      tc_args,
                                    "result":    None,
                                    "is_error":  False,
                                }

            elif role == "toolResult":
                tc_id = msg.get("toolCallId", "")
                if tc_id and tc_id in tool_calls:
                    result_content = msg.get("content", "")
                    if isinstance(result_content, list):
                        result_text = "".join(
                            b.get("text", "")
                            for b in result_content
                            if isinstance(b, dict) and b.get("type") == "text"
                        )
                    else:
                        result_text = str(result_content)
                    tool_calls[tc_id]["result"]   = result_text
                    tool_calls[tc_id]["is_error"] = bool(msg.get("isError", False))

        # Emit: first a tool_start, then a tool_result for each tool
        events = []
        for tc in tool_calls.values():
            events.append({"type": "tool_start",  **{k: v for k, v in tc.items() if k != "result" and k != "is_error"}})
            if tc["result"] is not None:
                events.append({"type": "tool_result", "tool_id": tc["tool_id"], "tool_name": tc["tool_name"], "result": tc["result"], "is_error": tc["is_error"]})

        return events

    except Exception:
        return []


router = APIRouter()


def _ws_is_open(ws: object) -> bool:
    """Return True if the websocket connection is still in OPEN state."""
    try:
        from websockets.connection import State
        return getattr(ws, "state", None) == State.OPEN
    except Exception:
        # Fallback: assume open if we can't check
        return True

# --------------- Gateway session store ---------------
# { session_key: GatewayClient }
# NOTE: This is in-memory and will reset on server reload.
# send-message handles the "client missing" case by reconnecting.
_gateway_sessions: dict[str, GatewayClient] = {}


async def _get_or_create_client(session_key: str) -> GatewayClient:
    """Get existing client or create a fresh one if missing/dead."""
    client = _gateway_sessions.get(session_key)
    if client is not None and client._ws is not None and _ws_is_open(client._ws):
        return client

    # Client missing or WebSocket closed — create a new connection
    client = GatewayClient()
    try:
        await client.connect()
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Failed to connect to OpenClaw gateway: {str(e)}. Is the gateway running?",
        )

    _gateway_sessions[session_key] = client
    return client


# --------------- Schemas ---------------

class StartSessionResponse(BaseModel):
    session_key: str
    status: str = "connected"


class StartSessionRequest(BaseModel):
    label: str | None = None
    model_override: str | None = None
    provider_override: str | None = None


class ImageAttachment(BaseModel):
    """Base64-encoded image attachment for multimodal chat."""
    mime_type: str = Field(..., description="MIME type, e.g. image/png, image/jpeg")
    data: str = Field(..., description="Base64-encoded image data (no data: prefix)")
    file_name: str = Field(default="image.png", description="Original file name")


class SendMessageRequest(BaseModel):
    session_key: str = Field(..., description="Gateway session key")
    message: str = Field(..., description="Message to send to the agent")
    images: list[ImageAttachment] = Field(default_factory=list, description="Optional image attachments")


class SendMessageResponse(BaseModel):
    run_id: str
    state: str
    response_text: str
    usage: dict | None = None
    stop_reason: str | None = None


# --------------- Voice transcript post-processing ---------------
class TranscribeCleanRequest(BaseModel):
    """
    Raw speech-to-text transcript (may contain filler words).
    We then use the configured OpenClaw model to rewrite it into clean text.
    """
    text: str = Field(..., description="Raw transcription text")
    model: str | None = Field(None, description="Optional model override (provider/model)")
    thinking_level: str | None = Field(None, description="off / minimal / low / medium / high / xhigh")


class TranscribeCleanResponse(BaseModel):
    raw_text: str
    cleaned_text: str


# --------------- Endpoints ---------------

@router.post("/start-session", response_model=StartSessionResponse)
async def start_session(request: StartSessionRequest | None = None):
    """
    Create a new OpenClaw gateway chat session.
    Returns a session_key for subsequent send-message calls.
    """
    body = request or StartSessionRequest()
    session_key = f"chat-{uuid.uuid4().hex[:12]}"
    client = await _get_or_create_client(session_key)
    initial_model = body.model_override
    if initial_model and body.provider_override and "/" not in initial_model:
        initial_model = f"{body.provider_override.rstrip('/')}/{initial_model.lstrip('/')}"

    if body.model_override or body.provider_override or body.label:
        try:
            await client.patch_session(
                session_key,
                label=body.label,
                model=initial_model,
                provider_override=body.provider_override if not initial_model else None,
                verbose_level="on",
            )
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to initialize session model override: {exc}",
            ) from exc
    else:
        await client.enable_verbose(session_key)

    return StartSessionResponse(session_key=session_key, status="connected")


@router.post("/send-message", response_model=SendMessageResponse)
async def send_message(request: SendMessageRequest):
    """
    Send a message to the OpenClaw agent and wait for the full response.
    Automatically reconnects if the session client was lost (e.g. server reload).
    """
    client = await _get_or_create_client(request.session_key)

    try:
        result = await client.send_chat(
            session_key=request.session_key,
            message=request.message,
            timeout_ms=120_000,
        )
        return SendMessageResponse(
            run_id=result.get("run_id", ""),
            state=result.get("state", "unknown"),
            response_text=result.get("response_text", ""),
            usage=result.get("usage"),
            stop_reason=result.get("stop_reason"),
        )
    except asyncio.TimeoutError:
        return SendMessageResponse(
            run_id="",
            state="timeout",
            response_text="[Timeout] Agent did not respond within 120 seconds.",
        )
    except Exception as e:
        return SendMessageResponse(
            run_id="",
            state="error",
            response_text=f"[Error] {str(e)}",
        )


@router.post("/send-message-stream")
async def send_message_stream(request: SendMessageRequest):
    """
    Stream chat response via Server-Sent Events (SSE).
    The client receives delta chunks in real-time as the agent generates them.

    SSE event format:  data: {"type": "delta"|"final"|"error"|"aborted"|"timeout", "text": "..."}
    Stream ends with:  data: [DONE]
    """
    client = await _get_or_create_client(request.session_key)

    # Convert image attachments to OpenClaw's format
    attachments = None
    if request.images:
        attachments = [
            {
                "type": "image",
                "mimeType": img.mime_type,
                "fileName": img.file_name,
                "content": img.data,
            }
            for img in request.images
        ]

    async def event_generator():
        final_text = ""
        try:
            async for chunk in client.stream_chat(
                session_key=request.session_key,
                message=request.message,
                attachments=attachments,
            ):
                if chunk["type"] == "final":
                    final_text = chunk.get("text", "")
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'text': str(e)})}\n\n"
            return

        # After the final response, read tool calls from the JSONL file.
        # This is more reliable than relying on real-time agent events.
        try:
            tool_events = _read_tool_calls_from_jsonl(request.session_key)
            for evt in tool_events:
                yield f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"
        except Exception:
            pass  # non-fatal

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable nginx buffering
            "Connection": "keep-alive",
        },
    )


@router.post("/transcribe-clean", response_model=TranscribeCleanResponse)
async def transcribe_clean(request: TranscribeCleanRequest):
    """
    Rewrite raw transcript into clean natural text.

    We do NOT store any user message into the main chat session; instead, this
    uses a temporary OpenClaw gateway session for post-processing only.
    """
    session_key = f"voice-{uuid.uuid4().hex[:12]}"
    client = await _get_or_create_client(session_key)

    try:
        # Keep same model/thinking style if the client requested it.
        await client.patch_session(
            session_key,
            model=request.model or None,
            thinking_level=request.thinking_level,
        )

        prompt = (
            "You are a professional Speech-to-Text (STT) Post-Processor. Your goal is to rewrite raw, fragmented transcripts into clean, coherent, and natural text.\n\n"
            "### STRICT EDITING RULES:\n"
            "1. **REMOVE ALL FILLER WORDS**: Eliminate all hesitations and vocal crutches. \n"
            "   - Examples (English): um, uh, er, ah, like, you know, so, basically, actually.\n"
            "   - Examples (Chinese): 嗯, 啊, 呃, 那个, 就是, 其实, 然后, 吧, 嘛, 呢, 这个这个.\n"
            "2. **ELIMINATE STUTTERS & REPETITIONS**: Remove redundant phrases caused by stuttering or thinking-on-the-fly.\n"
            "   - **Rule**: If a phrase repeats like 'I want, I want, I want you to...', rewrite it as 'I want you to...'.\n"
            "   - Collapse consecutive identical words or short phrases into a single instance.\n"
            "3. **SEMANTIC CLARITY**: Combine fragmented thoughts into logical, fluent sentences. Fix punctuation and capitalization.\n"
            "4. **NO TRANSLATION**: Keep the output in the same language as the input. Do not translate.\n"
            "5. **ZERO EXTRA OUTPUT**: Output ONLY the cleaned transcript. No quotes, no 'Here is the result', no explanations.\n\n"
            f"Raw Transcript:\n{request.text}"
        )

        result = await client.send_chat(
            session_key=session_key,
            message=prompt,
            timeout_ms=60_000,
        )

        cleaned = (result.get("response_text") or "").strip()
        return TranscribeCleanResponse(raw_text=request.text, cleaned_text=cleaned)
    finally:
        # Cleanup temporary session.
        _gateway_sessions.pop(session_key, None)
        try:
            await client.disconnect()
        except Exception:
            pass


@router.get("/history")
async def get_history(
    session_key: str = Query(..., description="Session key to load history for"),
    limit: int = 100,
):
    """
    Load chat history for a session by reading OpenClaw's local .jsonl files.

    NOTE: The chat.history WebSocket API only returns the active LLM context
    window. For full persistent history we read the .jsonl log files directly:
      ~/.openclaw/agents/main/sessions/<sessionId>.jsonl
    """
    messages = _read_history_from_jsonl(session_key, limit=limit)
    return {"session_key": session_key, "messages": messages}


@router.post("/close-session")
async def close_session(session_key: str = Query(..., description="Session key to close")):
    """Close an OpenClaw gateway chat session."""
    client = _gateway_sessions.pop(session_key, None)
    if client:
        try:
            await client.disconnect()
        except Exception:
            pass
    return {"status": "closed", "session_key": session_key}


# --------------- Session settings ---------------

class PatchSessionRequest(BaseModel):
    session_key: str = Field(..., description="Gateway session key")
    model: str | None = Field(None, description="Model in 'provider/model' format, e.g. 'openai/gpt-4o'. null to reset.")
    thinking_level: str | None = Field(None, description="off / minimal / low / medium / high / xhigh")


@router.post("/patch-session")
async def patch_session(request: PatchSessionRequest):
    """Update session settings (model, thinking level) on the fly."""
    client = await _get_or_create_client(request.session_key)
    try:
        result = await client.patch_session(
            request.session_key,
            model=request.model,
            thinking_level=request.thinking_level,
        )
        return {"status": "ok", "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/available-models")
async def available_models():
    """Return the saved model deck for Agent Valley.

    Priority:
      1. Explicit models persisted in ~/.openclaw/openclaw.json
      2. Live CLI model listing (when no explicit saved models exist)
      3. Last known good payload

    We intentionally do NOT fall back to onboard-scan's full catalog here,
    because that list is for discovery/configuration, not for the "already
    configured models" deck in Agent Valley.
    """
    from .system import _run_openclaw_json

    now = time.monotonic()
    expires_at = float(_available_models_cache.get("expires_at", 0.0) or 0.0)
    cached_payload = _available_models_cache.get("payload")
    if now < expires_at and isinstance(cached_payload, dict):
        return cached_payload

    async with _get_available_models_lock():
        now = time.monotonic()
        expires_at = float(_available_models_cache.get("expires_at", 0.0) or 0.0)
        cached_payload = _available_models_cache.get("payload")
        if now < expires_at and isinstance(cached_payload, dict):
            return cached_payload

        config_payload = _build_available_models_payload_from_config()
        if config_payload["models"]:
            print("[available-models] using configured models from openclaw.json")
            _available_models_cache["payload"] = config_payload
            _available_models_cache["last_success"] = config_payload
            _available_models_cache["expires_at"] = time.monotonic() + _AVAILABLE_MODELS_CACHE_TTL
            return config_payload

        raw = await _run_openclaw_json(["models", "list"], timeout=_AVAILABLE_MODELS_CLI_TIMEOUT)
        status_raw = await _run_openclaw_json(["models", "status"], timeout=_AVAILABLE_MODELS_CLI_TIMEOUT) if raw else None
        payload = _build_available_models_payload(raw, status_raw)

        if payload["models"]:
            _available_models_cache["payload"] = payload
            _available_models_cache["last_success"] = payload
            _available_models_cache["expires_at"] = time.monotonic() + _AVAILABLE_MODELS_CACHE_TTL
            return payload

        last_success = _available_models_cache.get("last_success")
        if isinstance(last_success, dict) and last_success.get("models"):
            print("[available-models] using last known good model list after CLI returned no models")
            _available_models_cache["payload"] = last_success
            _available_models_cache["expires_at"] = time.monotonic() + _AVAILABLE_MODELS_FAILURE_TTL
            return last_success

        print("[available-models] openclaw returned no models and no cached model list is available")
        empty_payload = {"models": [], "default_model": ""}
        _available_models_cache["payload"] = empty_payload
        _available_models_cache["expires_at"] = time.monotonic() + _AVAILABLE_MODELS_FAILURE_TTL
        return empty_payload
