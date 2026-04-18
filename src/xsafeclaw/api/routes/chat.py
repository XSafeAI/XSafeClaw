"""API routes for agent chat sessions (OpenClaw + Hermes)."""

import asyncio
import hashlib
import json
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ...config import settings
from ...database import get_db_context
from ...gateway_client import GatewayClient
from ...hermes_client import HermesClient
from ...models import Message, Session
from ...risk_rules import build_risk_rule_block_reason, load_risk_rules, match_risk_rule_text
from ...services.event_sync_service import EventSyncService

# ── Platform-aware paths ──────────────────────────────────────────────────
_OPENCLAW_DIR = Path.home() / ".openclaw"
_HERMES_DIR = settings.hermes_home

if settings.is_hermes:
    _SESSIONS_DIR = settings.hermes_sessions_dir
    _SESSIONS_JSON = _SESSIONS_DIR / "sessions.json"
    _CONFIG_PATH = settings.hermes_config_path
else:
    _SESSIONS_DIR = Path.home() / ".openclaw" / "agents" / "main" / "sessions"
    _SESSIONS_JSON = _SESSIONS_DIR / "sessions.json"
    _CONFIG_PATH = _OPENCLAW_DIR / "openclaw.json"
_RISK_RULES_FILE = settings.data_dir / "risk_rules.json"
_AVAILABLE_MODELS_CLI_TIMEOUT = 25
_AVAILABLE_MODELS_CACHE_TTL = 30.0
_AVAILABLE_MODELS_FAILURE_TTL = 5.0
_GATEWAY_CONNECT_RETRY_ATTEMPTS = 6
_GATEWAY_CONNECT_RETRY_DELAY_S = 1.0
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


def _build_risk_rule_chat_block_message(message: str, reason: str) -> str:
    is_zh = bool(re.search(r"[\u4e00-\u9fff]", message))
    if is_zh:
        return (
            "该指令已写入长期防护规则，XSafeClaw 已在发送给智能体前直接阻止。"
            f"\n\n拦截原因：{reason}"
        )
    return (
        "This instruction has been written into a persistent protection rule, so XSafeClaw blocked it before it reached the agent."
        f"\n\nBlock reason: {reason}"
    )


def _risk_rule_message_precheck(message: str) -> str | None:
    rules = load_risk_rules(_RISK_RULES_FILE)
    if not rules:
        return None

    matched_rule = match_risk_rule_text(message, rules)
    if not matched_rule:
        return None

    return _build_risk_rule_chat_block_message(
        message,
        build_risk_rule_block_reason(matched_rule),
    )


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


def _lookup_model_from_onboard_cache(model_id: str) -> dict | None:
    target = str(model_id or "").strip()
    if not target:
        return None

    try:
        from .system import _onboard_scan_cache
    except Exception:
        return None

    if not isinstance(_onboard_scan_cache, dict):
        return None

    provider_hint = ""
    short_id = target
    if "/" in target:
        provider_hint, short_id = target.split("/", 1)

    for provider in _onboard_scan_cache.get("model_providers", []) or []:
        prov_id = str(provider.get("id", "")).strip()
        for model in provider.get("models", []) or []:
            candidate = str(model.get("id", "")).strip()
            if not candidate:
                continue
            candidate_short = candidate.split("/", 1)[1] if "/" in candidate else candidate
            if candidate == target or (prov_id == provider_hint and candidate_short == short_id):
                return {
                    "id": target if "/" in target else f"{prov_id}/{candidate_short}",
                    "name": model.get("name", candidate_short or target),
                    "provider": prov_id or provider_hint,
                    "reasoning": bool(model.get("reasoning", False)),
                }

    return None


def _ensure_default_model_visible(payload: dict) -> dict:
    default_model = str(payload.get("default_model", "") or "").strip()
    models = list(payload.get("models", []) or [])
    if not default_model or "/" not in default_model:
        return {"models": models, "default_model": default_model}

    if any(str(model.get("id", "")).strip() == default_model for model in models):
        return {"models": models, "default_model": default_model}

    fallback = _lookup_model_from_onboard_cache(default_model)
    if not fallback:
        provider, short_id = default_model.split("/", 1)
        fallback = {
            "id": default_model,
            "name": short_id,
            "provider": provider,
            "reasoning": False,
        }

    return {"models": [fallback, *models], "default_model": default_model}


def _build_available_models_payload_from_config() -> dict:
    """Fallback to configured models from platform config file.

    Reads ``~/.openclaw/openclaw.json`` (OpenClaw) or
    ``~/.hermes/config.yaml`` (Hermes).
    """
    if not _CONFIG_PATH.exists():
        return {"models": [], "default_model": ""}

    try:
        raw = _CONFIG_PATH.read_text(encoding="utf-8")
        if settings.is_hermes:
            import yaml
            config = yaml.safe_load(raw) or {}
        else:
            config = json.loads(raw)
    except Exception:
        return {"models": [], "default_model": ""}

    if settings.is_hermes:
        # Hermes config.yaml: ``model`` can be a nested dict with a
        # ``default`` key (e.g. ``model: {default: "anthropic/claude-opus-4.6", provider: "auto"}``)
        # or a bare string like ``model: "hermes-agent"``.
        model_cfg = config.get("model", "")
        if isinstance(model_cfg, dict):
            default_model = str(model_cfg.get("default", "") or model_cfg.get("model", "")).strip()
            cfg_provider = str(model_cfg.get("provider", "")).strip()
        else:
            default_model = str(model_cfg).strip()
            cfg_provider = ""

        models = []
        if default_model:
            if "/" in default_model:
                provider, short = default_model.split("/", 1)
            else:
                provider = cfg_provider if cfg_provider and cfg_provider != "auto" else "hermes"
                short = default_model
            models.append({
                "id": default_model,
                "name": short,
                "provider": provider,
                "reasoning": False,
            })
        return _ensure_default_model_visible({"models": models, "default_model": default_model})

    # OpenClaw config
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

    return _ensure_default_model_visible({"models": models, "default_model": default_model})


def _extract_runtime_model_list(raw: dict | list | None) -> list[dict]:
    """Extract model entries from gateway (OpenClaw) or API server (Hermes).

    OpenClaw gateway returns ``{"models": [...]}``, while the Hermes API
    server uses the OpenAI-compatible ``{"data": [...]}``.
    """
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        models = raw.get("models")
        if isinstance(models, list) and models:
            return models
        data = raw.get("data")
        if isinstance(data, list):
            return data
    return []


def _runtime_model_ref_candidates(entry: dict) -> list[str]:
    refs: list[str] = []
    key = str(entry.get("key", "")).strip()
    if key:
        refs.append(key)

    provider = str(entry.get("provider", "")).strip()
    model_id = str(entry.get("id", "")).strip()
    if provider and model_id:
        refs.append(model_id if "/" in model_id else f"{provider}/{model_id}")
        if "/" in model_id and not model_id.lower().startswith(f"{provider.lower()}/"):
            refs.append(f"{provider}/{model_id}")
    elif model_id and "/" in model_id:
        refs.append(model_id)
    elif model_id:
        refs.append(model_id)

    seen: set[str] = set()
    normalized: list[str] = []
    for ref in refs:
        lowered = ref.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized.append(ref)
    return normalized


_PROVIDER_ALIASES: dict[str, str] = {
    "modelstudio": "qwen",
}


def _normalize_provider(provider: str) -> str:
    return _PROVIDER_ALIASES.get(provider, provider)


def _runtime_catalog_match(models: list[dict], target_model_id: str) -> tuple[bool, str | None]:
    target = str(target_model_id or "").strip().lower()
    if not target:
        return False, None

    provider_hint = ""
    short_id = target
    if "/" in target:
        provider_hint, short_id = target.split("/", 1)
    norm_hint = _normalize_provider(provider_hint)

    for entry in models:
        for ref in _runtime_model_ref_candidates(entry):
            candidate = ref.strip()
            candidate_lower = candidate.lower()
            if candidate_lower == target:
                return True, candidate
            if "/" in candidate_lower:
                candidate_provider, candidate_short = candidate_lower.split("/", 1)
                if norm_hint and _normalize_provider(candidate_provider) == norm_hint and candidate_short == short_id:
                    return True, candidate
                if not norm_hint and candidate_short == short_id:
                    return True, candidate
    return False, None


def _read_history_from_jsonl(session_key: str, limit: int = 100) -> list[dict]:
    """
    Read chat history from agent session JSONL storage.

    Supports two layouts:

    **OpenClaw** — wrapped entries::

        ~/.openclaw/agents/main/sessions/sessions.json  (key → sessionId mapping)
        ~/.openclaw/agents/main/sessions/<sessionId>.jsonl

    **Hermes** — flat entries (standard OpenAI chat format)::

        ~/.hermes/sessions/sessions.json  (key → sessionId mapping)
        ~/.hermes/sessions/<sessionId>.jsonl
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

    session_id = session_info.get("sessionId") or session_info.get("session_id")
    if not session_id:
        return []

    jsonl_path = _SESSIONS_DIR / f"{session_id}.jsonl"
    if not jsonl_path.exists():
        return []

    import re

    messages = []
    pending_tool_calls: dict[str, dict] = {}
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

            # ── Detect format: wrapped (OpenClaw) vs flat (Hermes) ────
            if "message" in entry and isinstance(entry.get("message"), dict):
                # OpenClaw wrapped format
                if entry.get("type") != "message":
                    continue
                msg       = entry["message"]
                timestamp = entry.get("timestamp")
                entry_id  = entry.get("id", "")
            elif "role" in entry:
                # Hermes flat format
                msg       = entry
                timestamp = entry.get("timestamp")
                entry_id  = entry.get("id", "")
            else:
                continue

            role    = msg.get("role", "")
            content = msg.get("content", "")

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

            elif role in ("toolResult", "tool"):
                tc_id = msg.get("toolCallId") or msg.get("tool_call_id", "")
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

    session_id = session_info.get("sessionId") or session_info.get("session_id")
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
            # OpenClaw: {"type":"message","message":{"role":"user",...}}
            # Hermes:   {"role":"user","content":"..."}
            if e.get("type") == "message" and e.get("message", {}).get("role") == "user":
                last_user_idx = i
            elif e.get("role") == "user":
                last_user_idx = i

        if last_user_idx < 0:
            return []

        recent = entries[last_user_idx + 1:]

        tool_calls: dict[str, dict] = {}

        for entry in recent:
            # Resolve msg from wrapped or flat format
            if "message" in entry and isinstance(entry.get("message"), dict):
                if entry.get("type") != "message":
                    continue
                msg = entry["message"]
            elif "role" in entry:
                msg = entry
            else:
                continue

            role = msg.get("role", "")

            if role == "assistant":
                content = msg.get("content", [])
                # OpenClaw tool calls: content blocks with type=toolCall
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
                # Hermes tool calls: msg.tool_calls list
                for tc in msg.get("tool_calls", []) or []:
                    tc_id = tc.get("id", "")
                    func = tc.get("function", {})
                    tc_name = func.get("name", "tool")
                    tc_args = func.get("arguments")
                    if tc_id:
                        tool_calls[tc_id] = {
                            "tool_id":   tc_id,
                            "tool_name": tc_name,
                            "args":      tc_args,
                            "result":    None,
                            "is_error":  False,
                        }

            elif role in ("toolResult", "tool"):
                tc_id = msg.get("toolCallId") or msg.get("tool_call_id", "")
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
                    tool_calls[tc_id]["is_error"] = bool(msg.get("isError") or msg.get("is_error", False))

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
# { session_key: GatewayClient | HermesClient }
# NOTE: This is in-memory and will reset on server reload.
# send-message handles the "client missing" case by reconnecting.
_gateway_sessions: dict[str, GatewayClient | HermesClient] = {}


async def _connect_gateway_with_retries() -> GatewayClient | HermesClient:
    """Connect to the agent gateway, tolerating short daemon reload windows.

    Returns a ``HermesClient`` when the platform is Hermes, otherwise
    a ``GatewayClient`` (OpenClaw WebSocket).
    """
    last_error: Exception | None = None

    for attempt in range(1, _GATEWAY_CONNECT_RETRY_ATTEMPTS + 1):
        if settings.is_hermes:
            client: GatewayClient | HermesClient = HermesClient(
                api_key=settings.hermes_api_key or None,
            )
        else:
            client = GatewayClient()
        try:
            await client.connect()
            return client
        except Exception as exc:
            last_error = exc if isinstance(exc, Exception) else Exception(str(exc))
            try:
                await client.disconnect()
            except Exception:
                pass

            if attempt < _GATEWAY_CONNECT_RETRY_ATTEMPTS:
                await asyncio.sleep(_GATEWAY_CONNECT_RETRY_DELAY_S)

    platform_name = "Hermes API server" if settings.is_hermes else "OpenClaw gateway"
    detail = (
        f"Failed to connect to {platform_name} after {_GATEWAY_CONNECT_RETRY_ATTEMPTS} attempts: "
        f"{last_error}. The gateway may still be restarting."
    )
    raise HTTPException(status_code=503, detail=detail)


async def _get_or_create_client(session_key: str) -> GatewayClient | HermesClient:
    """Get existing client or create a fresh one if missing/dead."""
    client = _gateway_sessions.get(session_key)

    if settings.is_hermes:
        if client is not None and isinstance(client, HermesClient):
            return client
    else:
        if client is not None and isinstance(client, GatewayClient) and client._ws is not None and _ws_is_open(client._ws):
            return client

    # Client missing or connection dead — create a new connection
    client = await _connect_gateway_with_retries()
    _gateway_sessions[session_key] = client
    return client


# --------------- Schemas ---------------

class StartSessionResponse(BaseModel):
    session_key: str
    status: str = "connected"


class ModelReadinessResponse(BaseModel):
    model_id: str
    ready: bool
    visible_model_id: str | None = None
    reason: str | None = None


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


# --------------- Hermes direct DB persistence ---------------
# When the platform is Hermes, we write Session/Message/Event rows directly
# so that Agent Town can display the agent without relying on .jsonl file
# watcher alone.  OpenClaw is unaffected — it uses the file-watcher path.

_hermes_session_model_info: dict[str, dict[str, str]] = {}
_hermes_event_sync = EventSyncService()


def _deterministic_message_id(session_key: str, role: str, text: str, seq: int) -> str:
    """Produce a stable 24-char hex ID so duplicate inserts are idempotent."""
    raw = f"{session_key}:{role}:{seq}:{text}".encode()
    return hashlib.sha256(raw).hexdigest()[:24]


async def _persist_hermes_session(
    session_key: str,
    session_id: str | None,
    *,
    model_provider: str | None = None,
    model_name: str | None = None,
) -> str:
    """Ensure a Session row exists for this Hermes chat. Returns session_id."""
    sid = session_id or session_key
    async with get_db_context() as db:
        result = await db.execute(
            select(Session).where(Session.session_id == sid)
        )
        session = result.scalar_one_or_none()
        if session:
            session.last_activity_at = datetime.now(timezone.utc)
            if model_provider and not session.current_model_provider:
                session.current_model_provider = model_provider
            if model_name and not session.current_model_name:
                session.current_model_name = model_name
            if not session.session_key:
                session.session_key = session_key
            await db.commit()
            return sid

        session = Session(
            session_id=sid,
            session_key=session_key,
            channel="webchat",
            first_seen_at=datetime.now(timezone.utc),
            last_activity_at=datetime.now(timezone.utc),
            current_model_provider=model_provider,
            current_model_name=model_name,
        )
        db.add(session)
        await db.commit()
    return sid


async def _persist_hermes_chat_turn(
    session_key: str,
    session_id: str | None,
    user_text: str,
    assistant_text: str,
    *,
    stop_reason: str | None = None,
    usage: dict | None = None,
) -> None:
    """Write user + assistant messages to DB and trigger event sync (Hermes only)."""
    sid = session_id or session_key
    now = datetime.now(timezone.utc)

    model_info = _hermes_session_model_info.get(session_key, {})

    async with get_db_context() as db:
        result = await db.execute(
            select(Session).where(Session.session_id == sid)
        )
        session = result.scalar_one_or_none()
        if not session:
            session = Session(
                session_id=sid,
                session_key=session_key,
                channel="webchat",
                first_seen_at=now,
                last_activity_at=now,
                current_model_provider=model_info.get("provider"),
                current_model_name=model_info.get("model"),
            )
            db.add(session)
            await db.flush()

        count_result = await db.execute(
            select(func.count()).select_from(Message).where(Message.session_id == sid)
        )
        seq_base = count_result.scalar() or 0

        user_msg_id = _deterministic_message_id(session_key, "user", user_text, seq_base)
        existing = await db.execute(
            select(Message.id).where(Message.message_id == user_msg_id)
        )
        if existing.scalar_one_or_none() is not None:
            return

        user_msg = Message(
            session_id=sid,
            message_id=user_msg_id,
            role="user",
            timestamp=now,
            content_text=user_text,
        )
        db.add(user_msg)

        asst_msg_id = _deterministic_message_id(session_key, "assistant", assistant_text, seq_base + 1)
        asst_msg = Message(
            session_id=sid,
            message_id=asst_msg_id,
            role="assistant",
            timestamp=now,
            content_text=assistant_text,
            provider=model_info.get("provider"),
            model_id=model_info.get("model"),
            stop_reason=stop_reason or "stop",
            input_tokens=(usage or {}).get("prompt_tokens"),
            output_tokens=(usage or {}).get("completion_tokens"),
            total_tokens=(usage or {}).get("total_tokens"),
        )
        db.add(asst_msg)

        session.last_activity_at = now
        await db.commit()

    try:
        await _hermes_event_sync.sync_session_events(sid)
    except Exception as exc:
        print(f"[hermes-persist] event sync error for {sid[:8]}: {exc}")


# --------------- Endpoints ---------------

@router.post("/start-session", response_model=StartSessionResponse)
async def start_session(request: StartSessionRequest | None = None):
    """
    Create a new gateway chat session.
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

    # Hermes: create the Session row eagerly so it appears in Agent Town right away
    if settings.is_hermes:
        model_provider = body.provider_override
        model_name = body.model_override
        if initial_model and "/" in initial_model:
            model_provider = initial_model.split("/", 1)[0]
            model_name = initial_model.split("/", 1)[1]
        _hermes_session_model_info[session_key] = {
            "provider": model_provider or "hermes",
            "model": model_name or "hermes-agent",
        }
        try:
            await _persist_hermes_session(
                session_key,
                None,
                model_provider=model_provider or "hermes",
                model_name=model_name or "hermes-agent",
            )
        except Exception as exc:
            print(f"[hermes-persist] session create warning: {exc}")

    return StartSessionResponse(session_key=session_key, status="connected")


@router.post("/send-message", response_model=SendMessageResponse)
async def send_message(request: SendMessageRequest):
    """
    Send a message to the OpenClaw agent and wait for the full response.
    Automatically reconnects if the session client was lost (e.g. server reload).
    """
    blocked_response = _risk_rule_message_precheck(request.message)
    if blocked_response:
        return SendMessageResponse(
            run_id="",
            state="final",
            response_text=blocked_response,
            usage=None,
            stop_reason="blocked_by_persistent_rule",
        )

    client = await _get_or_create_client(request.session_key)

    try:
        result = await client.send_chat(
            session_key=request.session_key,
            message=request.message,
            timeout_ms=120_000,
        )

        # Hermes: persist turn directly to DB
        if settings.is_hermes and result.get("state") == "final":
            hermes_sid = client.last_session_id if isinstance(client, HermesClient) else None
            try:
                await _persist_hermes_chat_turn(
                    request.session_key,
                    hermes_sid,
                    request.message,
                    result.get("response_text", ""),
                    stop_reason=result.get("stop_reason"),
                    usage=result.get("usage"),
                )
            except Exception as exc:
                print(f"[hermes-persist] send_message warning: {exc}")

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
    blocked_response = _risk_rule_message_precheck(request.message)
    if blocked_response:
        async def blocked_event_generator():
            yield f"data: {json.dumps({'type': 'final', 'text': blocked_response}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(
            blocked_event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

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

        # Hermes: persist turn directly to DB after streaming completes
        if settings.is_hermes and final_text:
            hermes_sid = client.last_session_id if isinstance(client, HermesClient) else None
            try:
                await _persist_hermes_chat_turn(
                    request.session_key,
                    hermes_sid,
                    request.message,
                    final_text,
                )
            except Exception as exc:
                print(f"[hermes-persist] stream warning: {exc}")

        # After the final response, read tool calls from the JSONL file.
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


async def _build_available_models_from_hermes_api() -> dict:
    """Query the live Hermes API server for its model catalog.

    Called as a fallback when ``config.yaml`` has no usable model entry.
    """
    try:
        client = HermesClient(api_key=settings.hermes_api_key or None)
        await client.connect()
        raw = await client.list_models()
        await client.disconnect()
    except Exception:
        return {"models": [], "default_model": ""}

    models = []
    for entry in _extract_runtime_model_list(raw):
        model_id = str(entry.get("id", "")).strip()
        if not model_id:
            continue
        provider = str(entry.get("owned_by", "")).strip() or "hermes"
        models.append({
            "id": model_id,
            "name": model_id,
            "provider": provider,
            "reasoning": False,
        })

    default_model = models[0]["id"] if models else ""
    return _ensure_default_model_visible({"models": models, "default_model": default_model})


@router.get("/available-models")
async def available_models():
    """Return the saved model deck for Agent Valley.

    Priority:
      1. Explicit models persisted in config file
      2. (OpenClaw) Live CLI model listing
         (Hermes)  Live API server model catalog
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
            print("[available-models] using configured models from config file")
            _available_models_cache["payload"] = config_payload
            _available_models_cache["last_success"] = config_payload
            _available_models_cache["expires_at"] = time.monotonic() + _AVAILABLE_MODELS_CACHE_TTL
            return config_payload

        if settings.is_hermes:
            hermes_payload = await _build_available_models_from_hermes_api()
            if hermes_payload["models"]:
                print("[available-models] using live Hermes API model catalog")
                _available_models_cache["payload"] = hermes_payload
                _available_models_cache["last_success"] = hermes_payload
                _available_models_cache["expires_at"] = time.monotonic() + _AVAILABLE_MODELS_CACHE_TTL
                return hermes_payload
        else:
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
            print("[available-models] using last known good model list (live source returned nothing)")
            _available_models_cache["payload"] = last_success
            _available_models_cache["expires_at"] = time.monotonic() + _AVAILABLE_MODELS_FAILURE_TTL
            return last_success

        print("[available-models] no models found from any source")
        empty_payload = {"models": [], "default_model": ""}
        _available_models_cache["payload"] = empty_payload
        _available_models_cache["expires_at"] = time.monotonic() + _AVAILABLE_MODELS_FAILURE_TTL
        return empty_payload


@router.get("/model-readiness", response_model=ModelReadinessResponse)
async def model_readiness(
    model_id: str = Query(..., description="Model in provider/model format"),
):
    """Check whether the running gateway currently accepts a model selection."""
    target_model_id = str(model_id or "").strip()
    if not target_model_id:
        raise HTTPException(status_code=400, detail="model_id is required")

    client: GatewayClient | HermesClient | None = None
    try:
        client = await _connect_gateway_with_retries()
        raw = await client.list_models()
        models = _extract_runtime_model_list(raw)

        # Hermes manages model routing internally — its runtime catalog only
        # reports "hermes-agent" regardless of the backend model the user
        # configured.  As long as the API server is reachable and exposes at
        # least one model, the gateway is ready to accept requests.
        if settings.is_hermes and models:
            return ModelReadinessResponse(
                model_id=target_model_id,
                ready=True,
                visible_model_id=target_model_id,
            )

        matched, visible_model_id = _runtime_catalog_match(
            models if isinstance(models, list) else [],
            target_model_id,
        )
        return ModelReadinessResponse(
            model_id=target_model_id,
            ready=matched,
            visible_model_id=visible_model_id,
        )
    except HTTPException as exc:
        return ModelReadinessResponse(
            model_id=target_model_id,
            ready=False,
            reason=str(exc.detail),
        )
    except Exception as exc:
        return ModelReadinessResponse(
            model_id=target_model_id,
            ready=False,
            reason=str(exc),
        )
    finally:
        if client is not None:
            try:
                await client.disconnect()
            except Exception:
                pass
