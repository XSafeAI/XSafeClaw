"""API routes for OpenClaw agent chat sessions."""

import asyncio
import json
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ...gateway_client import GatewayClient

# Path to OpenClaw sessions directory
_SESSIONS_DIR = Path.home() / ".openclaw" / "agents" / "main" / "sessions"
_SESSIONS_JSON = _SESSIONS_DIR / "sessions.json"


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


class SendMessageRequest(BaseModel):
    session_key: str = Field(..., description="Gateway session key")
    message: str = Field("", description="Message to send to the agent")
    images: list[str] = Field(default_factory=list, description="Optional pasted images as data URLs")


class SendMessageResponse(BaseModel):
    run_id: str
    state: str
    response_text: str
    usage: dict | None = None
    stop_reason: str | None = None


def _build_gateway_message_payload(message: str, images: list[str]) -> str | list[dict]:
    """Build chat.send payload supporting optional multimodal image parts."""
    clean_message = (message or "").strip()
    clean_images = [u for u in (images or []) if isinstance(u, str) and u.startswith("data:image/")]

    if not clean_images:
        return clean_message

    parts: list[dict] = []
    if clean_message:
        parts.append({"type": "text", "text": clean_message})

    for data_url in clean_images[:3]:  # keep payload bounded
        parts.append({"type": "input_image", "image_url": data_url})

    return parts


# --------------- Endpoints ---------------

@router.post("/start-session", response_model=StartSessionResponse)
async def start_session():
    """
    Create a new OpenClaw gateway chat session.
    Returns a session_key for subsequent send-message calls.
    """
    session_key = f"chat-{uuid.uuid4().hex[:12]}"
    client = await _get_or_create_client(session_key)
    # Remove the just-stored entry so _get_or_create handles reconnect cleanly
    # (we just need the key to exist conceptually; each request reconnects if needed)
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
            message=_build_gateway_message_payload(request.message, request.images),
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

    async def event_generator():
        final_text = ""
        try:
            async for chunk in client.stream_chat(
                session_key=request.session_key,
                message=_build_gateway_message_payload(request.message, request.images),
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
