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
from ...nanobot_gateway_client import NanobotGatewayClient
from ...runtime import RuntimeInstance, decode_chat_session_key, encode_chat_session_key
from ...risk_rules import build_risk_rule_block_reason, load_risk_rules, match_risk_rule_text
from ...services.event_sync_service import EventSyncService
from ..runtime_helpers import resolve_instance, serialize_instance

# ── Per-instance path helpers (was: module-level platform switch) ─────────
# Historically this module froze ``_SESSIONS_DIR`` / ``_SESSIONS_JSON`` /
# ``_CONFIG_PATH`` at import time based on ``settings.is_hermes``. That made
# Hermes a "second-class" runtime: even after §38's runtime registry was in
# place, anything that read these constants was locked to one platform per
# process, so users couldn't simultaneously monitor OpenClaw + Hermes +
# Nanobot or hot-switch in Agent Town.
#
# The constants below are kept as **defaults / backwards-compatible shims**
# (so external imports don't break) but every call site that needs platform-
# aware paths should now go through ``_sessions_dir_for(instance)`` etc.
_OPENCLAW_DIR = Path.home() / ".openclaw"
_HERMES_DIR = settings.hermes_home
_OPENCLAW_DEFAULT_SESSIONS_DIR = _OPENCLAW_DIR / "agents" / "main" / "sessions"

# Backwards-compatible defaults — point at OpenClaw because that is the
# historical "main" runtime when XSafeClaw was first written. NEW code must
# not depend on these; use the per-instance helpers instead.
_SESSIONS_DIR = _OPENCLAW_DEFAULT_SESSIONS_DIR
_SESSIONS_JSON = _SESSIONS_DIR / "sessions.json"
_CONFIG_PATH = _OPENCLAW_DIR / "openclaw.json"


def _sessions_dir_for(instance: RuntimeInstance) -> Path:
    """Return the on-disk sessions directory for a given runtime instance."""
    if instance.sessions_path:
        return Path(instance.sessions_path).expanduser()
    if instance.platform == "hermes":
        return Path(settings.hermes_sessions_dir).expanduser()
    if instance.platform == "openclaw":
        return _OPENCLAW_DEFAULT_SESSIONS_DIR
    return _OPENCLAW_DEFAULT_SESSIONS_DIR


def _sessions_json_for(instance: RuntimeInstance) -> Path:
    """Return the ``sessions.json`` index file for a given runtime instance."""
    return _sessions_dir_for(instance) / "sessions.json"


def _config_path_for(instance: RuntimeInstance) -> Path:
    """Return the runtime config file path for a given runtime instance.

    OpenClaw → ``~/.openclaw/openclaw.json``
    Hermes   → ``~/.hermes/config.yaml``
    Nanobot  → ``instance.config_path`` if known, else a sensible default.
    """
    if instance.config_path:
        return Path(instance.config_path).expanduser()
    if instance.platform == "hermes":
        return Path(settings.hermes_config_path).expanduser()
    if instance.platform == "openclaw":
        return _OPENCLAW_DIR / "openclaw.json"
    return _OPENCLAW_DIR / "openclaw.json"
_RISK_RULES_FILE = settings.data_dir / "risk_rules.json"
_AVAILABLE_MODELS_CLI_TIMEOUT = 25
_AVAILABLE_MODELS_CACHE_TTL = 30.0
_AVAILABLE_MODELS_FAILURE_TTL = 5.0
_GATEWAY_CONNECT_RETRY_ATTEMPTS = 6
_GATEWAY_CONNECT_RETRY_DELAY_S = 1.0
# Per-instance cache: keyed by ``RuntimeInstance.instance_id`` so OpenClaw
# and Hermes (and Nanobot, although it has its own short-circuit) can each
# serve their own model list from this endpoint without trampling each
# other's payload. Each value mirrors the legacy single-bucket schema:
# ``{"expires_at": float, "payload": dict, "last_success": dict | None}``.
_available_models_cache: dict[str, dict[str, object]] = {}


def _instance_models_cache(instance_id: str) -> dict[str, object]:
    """Return (creating if needed) the per-instance model cache bucket."""
    bucket = _available_models_cache.get(instance_id)
    if bucket is None:
        bucket = {
            "expires_at": 0.0,
            "payload": {"models": [], "default_model": ""},
            "last_success": None,
        }
        _available_models_cache[instance_id] = bucket
    return bucket
_available_models_lock = None
_NANOBOT_UNSAFE_CHARS = re.compile(r'[<>:"/\\|?*]')


def _nanobot_gateway_unavailable_detail(instance: RuntimeInstance) -> str:
    health_url = str(
        instance.meta.get("gateway_health_url") or "http://127.0.0.1:18790/health"
    )
    return (
        f"nanobot gateway is {instance.health_status} for instance '{instance.display_name}'. "
        f"Start nanobot gateway in another terminal with: "
        f"nanobot gateway --port 18790 --verbose "
        f"(expected health endpoint: {health_url})."
    )


def _get_available_models_lock() -> asyncio.Lock:
    global _available_models_lock
    if _available_models_lock is None:
        _available_models_lock = asyncio.Lock()
    return _available_models_lock


def _safe_nanobot_filename(name: str) -> str:
    return _NANOBOT_UNSAFE_CHARS.sub("_", name).strip()


async def _resolve_chat_runtime(
    *,
    session_key: str | None = None,
    instance_id: str | None = None,
) -> tuple[RuntimeInstance, str, str]:
    instance = await resolve_instance(
        instance_id=instance_id,
        session_key=session_key,
        capability="chat",
    )
    if instance.platform == "nanobot" and instance.health_status != "healthy":
        raise HTTPException(
            status_code=503,
            detail=_nanobot_gateway_unavailable_detail(instance),
        )
    _, _, local_session_key = decode_chat_session_key(session_key or "")
    if not local_session_key:
        local_session_key = session_key or f"chat-{uuid.uuid4().hex[:12]}"
    public_session_key = encode_chat_session_key(instance, local_session_key)
    return instance, local_session_key, public_session_key


def _nanobot_storage_session_keys(local_session_key: str) -> tuple[str, ...]:
    return (
        f"websocket:{local_session_key}",
        f"api:{local_session_key}",
        local_session_key,
    )


def _find_nanobot_session_file(
    instance: RuntimeInstance,
    local_session_key: str,
) -> Path | None:
    sessions_dir = Path(instance.sessions_path or "")
    if not sessions_dir.exists():
        return None

    for candidate_key in _nanobot_storage_session_keys(local_session_key):
        file_name = f"{_safe_nanobot_filename(candidate_key.replace(':', '_'))}.jsonl"
        candidate = sessions_dir / file_name
        if candidate.exists():
            return candidate

    for candidate in sessions_dir.glob("*.jsonl"):
        try:
            first_line = candidate.read_text(encoding="utf-8").splitlines()[0]
            data = json.loads(first_line)
        except Exception:
            continue
        if data.get("_type") != "metadata":
            continue
        key = str(data.get("key") or "")
        if key in set(_nanobot_storage_session_keys(local_session_key)):
            return candidate
    return None


def _nanobot_result_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            str(item.get("text", ""))
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        ]
        if parts:
            return "".join(parts)
    if isinstance(content, (dict, list)):
        return json.dumps(content, ensure_ascii=False)
    return str(content or "")


def _read_nanobot_history_from_jsonl(
    instance: RuntimeInstance,
    local_session_key: str,
    limit: int = 100,
) -> list[dict]:
    file_path = _find_nanobot_session_file(instance, local_session_key)
    if file_path is None:
        return []

    messages = []
    pending_tool_calls: dict[str, dict] = {}
    queued_tool_calls: list[dict] = []

    try:
        for line_index, raw_line in enumerate(file_path.read_text(encoding="utf-8").splitlines()):
            line = raw_line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if line_index == 0 and entry.get("_type") == "metadata":
                continue

            role = str(entry.get("role") or "")
            timestamp = entry.get("timestamp")
            message_id = f"line-{line_index + 1}"

            if role == "user":
                messages.extend(queued_tool_calls)
                queued_tool_calls = []
                text = _nanobot_result_text(entry.get("content")).strip()
                if text:
                    messages.append(
                        {
                            "role": "user",
                            "content": text,
                            "timestamp": timestamp,
                            "id": message_id,
                        }
                    )
                continue

            if role == "assistant":
                for tool_call in entry.get("tool_calls") or []:
                    if not isinstance(tool_call, dict):
                        continue
                    function = tool_call.get("function") if isinstance(tool_call.get("function"), dict) else {}
                    tool_id = str(tool_call.get("id") or "")
                    if not tool_id:
                        continue
                    args = function.get("arguments")
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except Exception:
                            args = {"raw": args}
                    pending_tool_calls[tool_id] = {
                        "type": "tool_call",
                        "role": "tool_call",
                        "content": "",
                        "tool_id": tool_id,
                        "tool_name": str(function.get("name") or tool_call.get("name") or "tool"),
                        "args": args,
                        "result": None,
                        "is_error": False,
                        "result_pending": True,
                        "timestamp": timestamp,
                        "id": f"tool-{tool_id}",
                    }

                text = _nanobot_result_text(entry.get("content")).strip()
                if text:
                    messages.extend(queued_tool_calls)
                    queued_tool_calls = []
                    messages.append(
                        {
                            "role": "assistant",
                            "content": text,
                            "timestamp": timestamp,
                            "id": message_id,
                        }
                    )
                continue

            if role == "tool":
                tool_id = str(entry.get("tool_call_id") or "")
                if tool_id and tool_id in pending_tool_calls:
                    tool_msg = dict(pending_tool_calls.pop(tool_id))
                    tool_msg["result"] = _nanobot_result_text(entry.get("content"))
                    tool_msg["is_error"] = str(tool_msg["result"]).startswith("Error")
                    tool_msg["result_pending"] = False
                    queued_tool_calls.append(tool_msg)

        messages.extend(queued_tool_calls)
    except Exception:
        return []

    if limit and len(messages) > limit:
        messages = messages[-limit:]
    return messages


def _read_nanobot_tool_calls_from_jsonl(
    instance: RuntimeInstance,
    local_session_key: str,
) -> list[dict]:
    file_path = _find_nanobot_session_file(instance, local_session_key)
    if file_path is None:
        return []

    try:
        entries = []
        for raw_line in file_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue

        last_user_idx = -1
        for index, entry in enumerate(entries):
            if entry.get("role") == "user":
                last_user_idx = index

        if last_user_idx < 0:
            return []

        recent = entries[last_user_idx + 1:]
        tool_calls: dict[str, dict] = {}
        for entry in recent:
            role = entry.get("role")
            if role == "assistant":
                for block in entry.get("tool_calls") or []:
                    if not isinstance(block, dict):
                        continue
                    function = block.get("function") if isinstance(block.get("function"), dict) else {}
                    tool_id = str(block.get("id") or "")
                    if tool_id:
                        args = function.get("arguments")
                        if isinstance(args, str):
                            try:
                                args = json.loads(args)
                            except Exception:
                                args = {"raw": args}
                        tool_calls[tool_id] = {
                            "tool_id": tool_id,
                            "tool_name": str(function.get("name") or block.get("name") or "tool"),
                            "args": args,
                            "result": None,
                            "is_error": False,
                        }
            elif role == "tool":
                tool_id = str(entry.get("tool_call_id") or "")
                if tool_id and tool_id in tool_calls:
                    tool_calls[tool_id]["result"] = _nanobot_result_text(entry.get("content"))
                    tool_calls[tool_id]["is_error"] = str(tool_calls[tool_id]["result"]).startswith("Error")

        events = []
        for tool_call in tool_calls.values():
            events.append(
                {
                    "type": "tool_start",
                    "tool_id": tool_call["tool_id"],
                    "tool_name": tool_call["tool_name"],
                    "args": tool_call["args"],
                }
            )
            if tool_call["result"] is not None:
                events.append(
                    {
                        "type": "tool_result",
                        "tool_id": tool_call["tool_id"],
                        "tool_name": tool_call["tool_name"],
                        "result": tool_call["result"],
                        "is_error": tool_call["is_error"],
                    }
                )
        return events
    except Exception:
        return []


def _build_nanobot_message_content(
    message: str,
    images: list["ImageAttachment"] | None = None,
) -> str | list[dict[str, object]]:
    if not images:
        return message
    content: list[dict[str, object]] = []
    if message:
        content.append({"type": "text", "text": message})
    for image in images:
        content.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:{image.mime_type};base64,{image.data}",
                },
            }
        )
    return content


def _nanobot_response_text(payload: dict) -> str:
    choices = payload.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            str(item.get("text", ""))
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        )
    return str(content or "")


async def _send_nanobot_chat(
    instance: RuntimeInstance,
    *,
    local_session_key: str,
    message: str,
    images: list["ImageAttachment"] | None = None,
    timeout_s: float = 120.0,
) -> dict:
    if images:
        raise HTTPException(
            status_code=400,
            detail="nanobot gateway websocket channel currently supports text messages only",
        )
    client = await _connect_nanobot_gateway(instance)
    try:
        return await client.send_chat(message, timeout_s=timeout_s)
    finally:
        await client.disconnect()


async def _nanobot_available_models(instance: RuntimeInstance) -> dict:
    configured_model = str(instance.meta.get("model") or "nanobot")
    provider = str(instance.meta.get("provider") or configured_model.split("/", 1)[0])
    models = {
        configured_model: {
            "id": configured_model,
            "name": configured_model.split("/", 1)[-1],
            "provider": provider,
            "reasoning": False,
        }
    }

    return {
        "models": list(models.values()),
        "default_model": configured_model,
        "instance_id": instance.instance_id,
        "platform": instance.platform,
        "capabilities": instance.capabilities,
        "instance": serialize_instance(instance),
        "supports_session_patch": False,
    }


def _decorate_models_payload(
    payload: dict,
    instance: RuntimeInstance,
    *,
    supports_session_patch: bool,
) -> dict:
    return {
        **payload,
        "instance_id": instance.instance_id,
        "platform": instance.platform,
        "capabilities": instance.capabilities,
        "instance": serialize_instance(instance),
        "supports_session_patch": supports_session_patch,
    }


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


def _build_available_models_payload_from_config(instance: RuntimeInstance) -> dict:
    """Fallback to configured models from the runtime's config file.

    Reads ``~/.openclaw/openclaw.json`` (OpenClaw) or
    ``~/.hermes/config.yaml`` (Hermes), using the path advertised by the
    given instance instead of a frozen module-level constant. This lets the
    same XSafeClaw process serve OpenClaw and Hermes side-by-side.
    """
    config_path = _config_path_for(instance)
    is_hermes = instance.platform == "hermes"

    if not config_path.exists():
        return {"models": [], "default_model": ""}

    try:
        raw = config_path.read_text(encoding="utf-8")
        if is_hermes:
            import yaml
            config = yaml.safe_load(raw) or {}
        else:
            config = json.loads(raw)
    except Exception:
        return {"models": [], "default_model": ""}

    if is_hermes:
        # Hermes config.yaml: ``model`` can be a nested dict with a
        # ``default`` key (e.g. ``model: {default: "anthropic/claude-opus-4.6", provider: "auto"}``)
        # or a bare string like ``model: "hermes-agent"``.
        model_cfg = config.get("model", "")
        if isinstance(model_cfg, dict):
            default_model_raw = str(model_cfg.get("default", "") or model_cfg.get("model", "")).strip()
            cfg_provider = str(model_cfg.get("provider", "")).strip()
        else:
            default_model_raw = str(model_cfg).strip()
            cfg_provider = ""

        # Canonicalise the active-model id to the same "{slug}/{bare_id}" shape
        # the ledger uses, so the dedup gate in ``_add_model`` actually
        # collapses "active model" and "ledger entry for the same pick" into
        # one row.  Two subtleties:
        #
        #   * After §34 ``config.yaml::model.default`` is **bare** (no slug
        #     prefix); ``cfg_provider`` carries the slug separately.  We
        #     re-prefix here.
        #   * Aggregator bare ids (OpenRouter, Nous, ...) already contain
        #     ``/`` themselves (e.g. ``anthropic/claude-opus-4.7``) — those
        #     must NOT be split into provider=``anthropic`` because that
        #     isn't a Hermes provider slug.  ``cfg_provider`` is the only
        #     reliable source of the routing slug for those.
        if default_model_raw:
            if cfg_provider and cfg_provider != "auto":
                if default_model_raw.startswith(f"{cfg_provider}/"):
                    default_model = default_model_raw
                else:
                    default_model = f"{cfg_provider}/{default_model_raw}"
            else:
                # Old or hand-edited config without ``model.provider`` — fall
                # back to the legacy "first segment is the slug" heuristic.
                default_model = default_model_raw
        else:
            default_model = ""

        models: list[dict] = []
        seen_ids: set[str] = set()

        def _add_model(mid: str, provider: str, name: str = "", reasoning: bool = False) -> None:
            mid = (mid or "").strip()
            if not mid or mid in seen_ids:
                return
            seen_ids.add(mid)
            models.append({
                "id": mid,
                "name": (name or (mid.split("/", 1)[-1] if "/" in mid else mid)),
                "provider": (provider or "hermes"),
                "reasoning": bool(reasoning),
            })

        if default_model:
            if cfg_provider and cfg_provider != "auto":
                provider = cfg_provider
                short = default_model_raw
            elif "/" in default_model:
                provider, short = default_model.split("/", 1)
            else:
                provider = "hermes"
                short = default_model
            _add_model(default_model, provider, short)

        # ── §35: ledger-driven, auth-gated configured-model list ──────────────
        # Why we can't use Hermes's per-provider defaults anymore:
        #   * ``get_default_model_for_provider("openrouter")`` returns ``""``
        #     (OpenRouter has thousands of models, no canonical pick), so
        #     OpenRouter silently dropped from the deck even when the user had
        #     explicitly picked ``anthropic/claude-opus-4.7``.
        #   * ``get_default_model_for_provider("alibaba")`` returns
        #     ``"kimi-k2.5"`` in the current Hermes build — a Kimi/Moonshot
        #     model accidentally wired as alibaba's default — which made an
        #     unconfigured "kimi" entry appear every time even though the
        #     user only ever picked ``qwen3-max``.
        #
        # Both bugs come from trusting Hermes to remember what the user
        # picked.  Hermes never did — only ``model.default`` (last-write-wins,
        # one slot) does.  XSafeClaw now keeps its own ledger (§35) of every
        # model the user explicitly saved, and we surface those here, gated
        # by the current Hermes auth state so removing a key removes the
        # corresponding entries automatically.
        try:
            from .system import (
                _fetch_hermes_configured_models,
                _load_xs_configured_models,
                _seed_xs_configured_models_from_config,
            )
            probe = _fetch_hermes_configured_models()
        except Exception:
            probe = None
            _load_xs_configured_models = None  # type: ignore[assignment]
            _seed_xs_configured_models_from_config = None  # type: ignore[assignment]

        # Build the auth gate: any slug Hermes currently considers
        # authenticated, including the synthetic ``custom:<name>`` form for
        # user-defined custom providers.  Empty set → degrade to "ledger
        # entries are unconditionally trusted" (probe failed, don't penalize).
        authed_slugs: set[str] = set()
        gate_active = False
        if isinstance(probe, dict):
            gate_active = True
            for entry in probe.get("authenticated") or []:
                if not isinstance(entry, dict):
                    continue
                slug = str(entry.get("slug") or "").strip()
                if slug:
                    authed_slugs.add(slug)
            for cp in probe.get("custom") or []:
                if not isinstance(cp, dict):
                    continue
                cp_name = str(cp.get("name") or "").strip()
                if cp_name:
                    authed_slugs.add(f"custom:{cp_name}")

        # Migration: if the ledger is empty but config.yaml already names a
        # model (pre-§35 user, or someone who configured Hermes via its own
        # CLI), seed one entry so the very first restart isn't blank.
        if _seed_xs_configured_models_from_config and default_model:
            seed_provider = cfg_provider or (
                default_model.split("/", 1)[0] if "/" in default_model else ""
            )
            if seed_provider:
                try:
                    _seed_xs_configured_models_from_config(
                        default_model=(
                            default_model.split("/", 1)[1]
                            if "/" in default_model
                            else default_model
                        ),
                        provider=seed_provider,
                    )
                except Exception:
                    pass

        ledger_entries: list[dict] = []
        if _load_xs_configured_models is not None:
            try:
                ledger_entries = _load_xs_configured_models()
            except Exception:
                ledger_entries = []

        # Surface ledger entries newest-first so the picker's natural order
        # mirrors the user's most recent intent.
        for entry in sorted(
            ledger_entries,
            key=lambda e: float(e.get("configured_at") or 0.0),
            reverse=True,
        ):
            slug = str(entry.get("slug") or "").strip()
            full_id = str(entry.get("model_id") or "").strip()
            bare_id = str(entry.get("bare_id") or "").strip() or full_id
            display_name = str(entry.get("name") or bare_id)
            if not slug or not full_id:
                continue
            if gate_active and slug not in authed_slugs:
                # The provider used to be authenticated but the user removed
                # the key (or rotated the .env).  Hide the entry; the ledger
                # stays intact so re-adding the key resurrects it untouched.
                continue
            _add_model(full_id, slug, display_name)

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


def _read_history_from_jsonl(
    instance: RuntimeInstance,
    session_key: str,
    limit: int = 100,
) -> list[dict]:
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
    sessions_json = _sessions_json_for(instance)
    sessions_dir = _sessions_dir_for(instance)

    if not sessions_json.exists():
        return []

    try:
        sessions_index = json.loads(sessions_json.read_text(encoding="utf-8"))
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

    jsonl_path = sessions_dir / f"{session_id}.jsonl"
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

def _read_tool_calls_from_jsonl(
    instance: RuntimeInstance,
    session_key: str,
) -> list[dict]:
    """
    Read the latest tool calls (since the last user message) from the JSONL file.
    Returns a list of tool_call dicts for SSE streaming.
    """
    sessions_json = _sessions_json_for(instance)
    sessions_dir = _sessions_dir_for(instance)

    if not sessions_json.exists():
        return []
    try:
        sessions_index = json.loads(sessions_json.read_text(encoding="utf-8"))
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

    jsonl_path = sessions_dir / f"{session_id}.jsonl"
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
_nanobot_gateway_sessions: dict[str, NanobotGatewayClient] = {}


def _nanobot_gateway_websocket_url(instance: RuntimeInstance) -> str:
    websocket_url = str(
        instance.gateway_base_url or instance.meta.get("websocket_url") or ""
    ).strip()
    if not websocket_url:
        raise HTTPException(
            status_code=503,
            detail=(
                "nanobot websocket channel is not configured. "
                "Open /nanobot_configure and save the Nanobot runtime config, "
                "or add channels.websocket to ~/.nanobot/config.json."
            ),
        )
    return websocket_url


async def _connect_nanobot_gateway(instance: RuntimeInstance) -> NanobotGatewayClient:
    websocket_url = _nanobot_gateway_websocket_url(instance)
    client = NanobotGatewayClient(
        websocket_url,
        client_id=str(instance.meta.get("websocket_client_id") or "xsafeclaw"),
        token=str(instance.meta.get("websocket_token") or ""),
    )
    try:
        await client.connect()
        return client
    except Exception as exc:
        await client.disconnect()
        raise HTTPException(
            status_code=503,
            detail=(
                f"Failed to connect to nanobot gateway websocket at {websocket_url}: {exc}. "
                "Start nanobot gateway with: nanobot gateway --port 18790 --verbose"
            ),
        ) from exc


async def _get_nanobot_gateway_session(
    public_session_key: str,
    instance: RuntimeInstance,
) -> NanobotGatewayClient:
    client = _nanobot_gateway_sessions.get(public_session_key)
    if client is not None and client.is_open:
        return client
    if client is not None:
        await client.disconnect()
        _nanobot_gateway_sessions.pop(public_session_key, None)
    raise HTTPException(
        status_code=503,
        detail=(
            "nanobot gateway websocket session is not connected. "
            "Create a new nanobot session from the Chat page."
        ),
    )


async def _connect_gateway_with_retries(
    instance: RuntimeInstance,
) -> GatewayClient | HermesClient:
    """Connect to the agent gateway, tolerating short daemon reload windows.

    Returns a ``HermesClient`` when the instance's platform is Hermes,
    otherwise a ``GatewayClient`` (OpenClaw WebSocket). The choice is now
    keyed off the resolved ``RuntimeInstance`` so an OpenClaw-default process
    can still talk to a Hermes session and vice-versa.
    """
    last_error: Exception | None = None
    is_hermes = instance.platform == "hermes"

    for attempt in range(1, _GATEWAY_CONNECT_RETRY_ATTEMPTS + 1):
        if is_hermes:
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

    platform_name = "Hermes API server" if is_hermes else "OpenClaw gateway"
    detail = (
        f"Failed to connect to {platform_name} after {_GATEWAY_CONNECT_RETRY_ATTEMPTS} attempts: "
        f"{last_error}. The gateway may still be restarting."
    )
    raise HTTPException(status_code=503, detail=detail)


async def _get_or_create_client(
    instance: RuntimeInstance,
    session_key: str,
) -> GatewayClient | HermesClient:
    """Get existing client or create a fresh one if missing/dead."""
    client = _gateway_sessions.get(session_key)
    is_hermes = instance.platform == "hermes"

    if is_hermes:
        if client is not None and isinstance(client, HermesClient):
            return client
    else:
        if client is not None and isinstance(client, GatewayClient) and client._ws is not None and _ws_is_open(client._ws):
            return client

    # Client missing or connection dead — create a new connection
    client = await _connect_gateway_with_retries(instance)
    _gateway_sessions[session_key] = client
    return client


# --------------- Schemas ---------------

class StartSessionResponse(BaseModel):
    session_key: str
    status: str = "connected"
    instance_id: str
    platform: str
    instance: dict | None = None


class ModelReadinessResponse(BaseModel):
    model_id: str
    ready: bool
    visible_model_id: str | None = None
    reason: str | None = None


class StartSessionRequest(BaseModel):
    instance_id: str | None = None
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
    Create a new runtime chat session.
    Returns a session_key for subsequent send-message calls.
    """
    body = request or StartSessionRequest()
    instance, local_session_key, public_session_key = await _resolve_chat_runtime(
        instance_id=body.instance_id,
    )
    if instance.platform == "nanobot":
        client = await _connect_nanobot_gateway(instance)
        local_session_key = client.chat_id or local_session_key
        public_session_key = encode_chat_session_key(instance, local_session_key)
        _nanobot_gateway_sessions[public_session_key] = client
        return StartSessionResponse(
            session_key=public_session_key,
            status="connected",
            instance_id=instance.instance_id,
            platform=instance.platform,
            instance=serialize_instance(instance),
        )

    client = await _get_or_create_client(instance, public_session_key)
    initial_model = body.model_override
    if initial_model and body.provider_override and "/" not in initial_model:
        initial_model = f"{body.provider_override.rstrip('/')}/{initial_model.lstrip('/')}"

    if body.model_override or body.provider_override or body.label:
        try:
            await client.patch_session(
                local_session_key,
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
        await client.enable_verbose(local_session_key)

    # Hermes: create the Session row eagerly so it appears in Agent Town right away
    if instance.platform == "hermes":
        model_provider = body.provider_override
        model_name = body.model_override
        if initial_model and "/" in initial_model:
            model_provider = initial_model.split("/", 1)[0]
            model_name = initial_model.split("/", 1)[1]
        # §43f: keep the raw, un-split model_id around so per-message routing
        # can forward it verbatim into ``HermesClient.send_chat`` /
        # ``stream_chat``.  Without this, every chat call shipped the literal
        # ``"hermes-agent"`` placeholder to /v1/chat/completions, which
        # Hermes resolves against ``config.yaml::model.default`` — i.e. the
        # **most recently saved** model, regardless of what the picker showed
        # when this session was created.  Configuring Kimi then Deepseek and
        # creating a Kimi agent would silently chat with Deepseek; see §43f.
        # Stored as ``"<provider>/<bare>"`` so the catalog id round-trips
        # unchanged through the eager DB write below and the persistence
        # path in ``_persist_hermes_chat_turn`` (which only reads
        # ``provider`` / ``model`` keys).
        raw_model_id = (initial_model or "").strip()
        if not raw_model_id and model_provider and model_name:
            raw_model_id = f"{model_provider}/{model_name}"
        _hermes_session_model_info[public_session_key] = {
            "provider": model_provider or "hermes",
            "model": model_name or "hermes-agent",
            "model_id": raw_model_id,
        }
        try:
            await _persist_hermes_session(
                public_session_key,
                None,
                model_provider=model_provider or "hermes",
                model_name=model_name or "hermes-agent",
            )
        except Exception as exc:
            print(f"[hermes-persist] session create warning: {exc}")

    return StartSessionResponse(
        session_key=public_session_key,
        status="connected",
        instance_id=instance.instance_id,
        platform=instance.platform,
        instance=serialize_instance(instance),
    )


@router.post("/send-message", response_model=SendMessageResponse)
async def send_message(request: SendMessageRequest):
    """
    Send a message to the selected runtime and wait for the full response.
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

    instance, local_session_key, public_session_key = await _resolve_chat_runtime(
        session_key=request.session_key,
    )

    try:
        if instance.platform == "nanobot":
            if request.images:
                raise HTTPException(
                    status_code=400,
                    detail="nanobot gateway websocket channel currently supports text messages only",
                )
            client = await _get_nanobot_gateway_session(public_session_key, instance)
            result = await client.send_chat(request.message, timeout_s=120.0)
        else:
            client = await _get_or_create_client(instance, public_session_key)
            # §43f: forward the picker-selected model id (cached at
            # ``start-session`` time) so Hermes routes per the user's pick
            # rather than ``config.yaml::model.default``.  Non-Hermes
            # clients (GatewayClient) accept ``model=None`` as a kwarg only
            # if they've been updated; we therefore route ``send_chat``
            # call sites through a per-platform lookup to keep OpenClaw's
            # signature unchanged.
            send_model: str | None = None
            if instance.platform == "hermes":
                info = _hermes_session_model_info.get(public_session_key) or {}
                send_model = (info.get("model_id") or "").strip() or None
            chat_kwargs: dict = {
                "session_key": local_session_key,
                "message": request.message,
                "timeout_ms": 120_000,
            }
            if send_model and instance.platform == "hermes":
                chat_kwargs["model"] = send_model
            result = await client.send_chat(**chat_kwargs)

        # Hermes: persist turn directly to DB
        if instance.platform == "hermes" and result.get("state") == "final":
            hermes_sid = client.last_session_id if isinstance(client, HermesClient) else None
            try:
                await _persist_hermes_chat_turn(
                    public_session_key,
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
    except HTTPException:
        raise
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

    instance, local_session_key, public_session_key = await _resolve_chat_runtime(
        session_key=request.session_key,
    )

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
        client: GatewayClient | HermesClient | NanobotGatewayClient | None = None
        try:
            if instance.platform == "nanobot":
                if request.images:
                    raise HTTPException(
                        status_code=400,
                        detail="nanobot gateway websocket channel currently supports text messages only",
                )
                client = await _get_nanobot_gateway_session(public_session_key, instance)
                async for chunk in client.stream_chat(request.message, timeout_s=120.0):
                    if isinstance(chunk, dict) and chunk.get("text"):
                        final_text = str(chunk["text"])
                    yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            else:
                client = await _get_or_create_client(instance, public_session_key)
                # §43f: same per-message model forwarding as in ``send_message``.
                # SSE streaming has the same issue — without explicit ``model``
                # the body sent to /v1/chat/completions hardcodes
                # ``"hermes-agent"`` and Hermes resolves it against
                # ``config.yaml::model.default``, ignoring the picker pick.
                stream_model: str | None = None
                if instance.platform == "hermes":
                    info = _hermes_session_model_info.get(public_session_key) or {}
                    stream_model = (info.get("model_id") or "").strip() or None
                stream_kwargs: dict = {
                    "session_key": local_session_key,
                    "message": request.message,
                    "attachments": attachments,
                }
                if stream_model and instance.platform == "hermes":
                    stream_kwargs["model"] = stream_model
                async for chunk in client.stream_chat(**stream_kwargs):
                    if isinstance(chunk, dict) and chunk.get("text"):
                        final_text = str(chunk["text"])
                    yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'text': str(e)})}\n\n"
            return

        # Hermes: persist turn directly to DB after streaming completes
        if instance.platform == "hermes" and final_text:
            hermes_sid = client.last_session_id if isinstance(client, HermesClient) else None
            try:
                await _persist_hermes_chat_turn(
                    public_session_key,
                    hermes_sid,
                    request.message,
                    final_text,
                )
            except Exception as exc:
                print(f"[hermes-persist] stream warning: {exc}")

        # After the final response, read tool calls from the JSONL file.
        try:
            tool_events = (
                _read_nanobot_tool_calls_from_jsonl(instance, local_session_key)
                if instance.platform == "nanobot"
                else _read_tool_calls_from_jsonl(instance, local_session_key)
            )
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
    instance, local_session_key, public_session_key = await _resolve_chat_runtime()

    try:
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

        if instance.platform == "nanobot":
            result = await _send_nanobot_chat(
                instance,
                local_session_key=f"voice-{uuid.uuid4().hex[:12]}",
                message=prompt,
                timeout_s=60.0,
            )
        else:
            client = await _get_or_create_client(instance, public_session_key)
            await client.patch_session(
                local_session_key,
                model=request.model or None,
                thinking_level=request.thinking_level,
            )
            result = await client.send_chat(
                session_key=local_session_key,
                message=prompt,
                timeout_ms=60_000,
            )

        cleaned = (result.get("response_text") or "").strip()
        return TranscribeCleanResponse(raw_text=request.text, cleaned_text=cleaned)
    finally:
        if instance.platform == "openclaw":
            client = _gateway_sessions.pop(public_session_key, None)
            if client:
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
    Load chat history for a session by reading the runtime's local session files.
    """
    instance, local_session_key, public_session_key = await _resolve_chat_runtime(session_key=session_key)
    messages = (
        _read_nanobot_history_from_jsonl(instance, local_session_key, limit=limit)
        if instance.platform == "nanobot"
        else _read_history_from_jsonl(instance, local_session_key, limit=limit)
    )
    return {
        "session_key": public_session_key,
        "messages": messages,
        "instance_id": instance.instance_id,
        "platform": instance.platform,
    }


@router.post("/close-session")
async def close_session(session_key: str = Query(..., description="Session key to close")):
    """Close a runtime chat session."""
    instance, _, public_session_key = await _resolve_chat_runtime(session_key=session_key)
    if instance.platform in {"openclaw", "hermes"}:
        client = _gateway_sessions.pop(public_session_key, None)
    else:
        client = _nanobot_gateway_sessions.pop(public_session_key, None)
    if client:
        try:
            await client.disconnect()
        except Exception:
            pass
    return {
        "status": "closed",
        "session_key": public_session_key,
        "instance_id": instance.instance_id,
        "platform": instance.platform,
    }


# --------------- Session settings ---------------

class PatchSessionRequest(BaseModel):
    session_key: str = Field(..., description="Gateway session key")
    model: str | None = Field(None, description="Model in 'provider/model' format, e.g. 'openai/gpt-4o'. null to reset.")
    thinking_level: str | None = Field(None, description="off / minimal / low / medium / high / xhigh")


@router.post("/patch-session")
async def patch_session(request: PatchSessionRequest):
    """Update session settings (model, thinking level) on the fly."""
    instance, local_session_key, public_session_key = await _resolve_chat_runtime(
        session_key=request.session_key,
    )
    if instance.platform == "nanobot":
        configured_model = str(instance.meta.get("model") or "")
        requested_model = str(request.model or "").strip()
        if requested_model and configured_model and requested_model != configured_model:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"nanobot gateway currently uses a single fixed model '{configured_model}', "
                    f"so switching to '{requested_model}' is not supported."
                ),
            )
        return {
            "status": "ok",
            "result": {
                "message": "nanobot gateway uses a fixed per-instance model; no session patch applied",
                "session_key": public_session_key,
                "instance_id": instance.instance_id,
                "platform": instance.platform,
            },
        }

    client = await _get_or_create_client(instance, public_session_key)
    try:
        result = await client.patch_session(
            local_session_key,
            model=request.model,
            thinking_level=request.thinking_level,
        )
        # §43f: keep the per-session Hermes model cache in sync with picker
        # changes that happen *after* start-session.  Hermes's own
        # ``patch_session`` is a no-op (HermesClient L267-287 — the API
        # server is stateless per-request), so without this update the
        # follow-up ``send_message`` would still read the old ``model_id``
        # written at start-session time and chat with the wrong model.
        # ``model=None`` is the explicit "reset to config.yaml default"
        # signal from the picker (Chat.tsx L1298), so we drop the
        # cached id in that branch — Hermes will then resolve against
        # ``model.default`` which is the documented behaviour for
        # the X-icon "clear model" gesture.
        if instance.platform == "hermes":
            new_model_id = (request.model or "").strip()
            info = _hermes_session_model_info.setdefault(
                public_session_key,
                {"provider": "hermes", "model": "hermes-agent", "model_id": ""},
            )
            if new_model_id:
                info["model_id"] = new_model_id
                if "/" in new_model_id:
                    info["provider"] = new_model_id.split("/", 1)[0]
                    info["model"] = new_model_id.split("/", 1)[1]
                else:
                    info["model"] = new_model_id
            else:
                info["model_id"] = ""
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
async def available_models(
    instance_id: str | None = Query(None, description="Optional runtime instance override"),
):
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
    instance = await resolve_instance(instance_id=instance_id, capability="model_list")
    if instance.platform == "nanobot":
        return await _nanobot_available_models(instance)

    from .system import _run_openclaw_json

    cache = _instance_models_cache(instance.instance_id)

    now = time.monotonic()
    expires_at = float(cache.get("expires_at", 0.0) or 0.0)
    cached_payload = cache.get("payload")
    if now < expires_at and isinstance(cached_payload, dict):
        return _decorate_models_payload(cached_payload, instance, supports_session_patch=True)

    async with _get_available_models_lock():
        now = time.monotonic()
        expires_at = float(cache.get("expires_at", 0.0) or 0.0)
        cached_payload = cache.get("payload")
        if now < expires_at and isinstance(cached_payload, dict):
            return _decorate_models_payload(cached_payload, instance, supports_session_patch=True)

        config_payload = _build_available_models_payload_from_config(instance)
        if config_payload["models"]:
            print(f"[available-models] using configured models from config file (instance={instance.instance_id})")
            cache["payload"] = config_payload
            cache["last_success"] = config_payload
            cache["expires_at"] = time.monotonic() + _AVAILABLE_MODELS_CACHE_TTL
            return _decorate_models_payload(config_payload, instance, supports_session_patch=True)

        if instance.platform == "hermes":
            hermes_payload = await _build_available_models_from_hermes_api()
            if hermes_payload["models"]:
                print(f"[available-models] using live Hermes API model catalog (instance={instance.instance_id})")
                cache["payload"] = hermes_payload
                cache["last_success"] = hermes_payload
                cache["expires_at"] = time.monotonic() + _AVAILABLE_MODELS_CACHE_TTL
                return _decorate_models_payload(hermes_payload, instance, supports_session_patch=True)
        else:
            raw = await _run_openclaw_json(["models", "list"], timeout=_AVAILABLE_MODELS_CLI_TIMEOUT)
            status_raw = await _run_openclaw_json(["models", "status"], timeout=_AVAILABLE_MODELS_CLI_TIMEOUT) if raw else None
            payload = _build_available_models_payload(raw, status_raw)

            if payload["models"]:
                cache["payload"] = payload
                cache["last_success"] = payload
                cache["expires_at"] = time.monotonic() + _AVAILABLE_MODELS_CACHE_TTL
                return _decorate_models_payload(payload, instance, supports_session_patch=True)

        last_success = cache.get("last_success")
        if isinstance(last_success, dict) and last_success.get("models"):
            print(f"[available-models] using last known good model list (instance={instance.instance_id})")
            cache["payload"] = last_success
            cache["expires_at"] = time.monotonic() + _AVAILABLE_MODELS_FAILURE_TTL
            return _decorate_models_payload(last_success, instance, supports_session_patch=True)

        print(f"[available-models] no models found from any source (instance={instance.instance_id})")
        empty_payload = {"models": [], "default_model": ""}
        cache["payload"] = empty_payload
        cache["expires_at"] = time.monotonic() + _AVAILABLE_MODELS_FAILURE_TTL
        return _decorate_models_payload(empty_payload, instance, supports_session_patch=True)

    # Unreachable, but keeps mypy sane.
    return _decorate_models_payload(
        {"models": [], "default_model": ""},
        instance,
        supports_session_patch=True,
    )


@router.get("/model-readiness", response_model=ModelReadinessResponse)
async def model_readiness(
    model_id: str = Query(..., description="Model in provider/model format"),
    instance_id: str | None = Query(None, description="Optional runtime instance override"),
):
    """Check whether the running gateway currently accepts a model selection."""
    target_model_id = str(model_id or "").strip()
    if not target_model_id:
        raise HTTPException(status_code=400, detail="model_id is required")

    instance = await resolve_instance(instance_id=instance_id, capability="model_list")
    if instance.platform == "nanobot":
        if instance.health_status != "healthy":
            return ModelReadinessResponse(
                model_id=target_model_id,
                ready=False,
                reason=f"nanobot gateway is {instance.health_status}",
            )
        payload = await _nanobot_available_models(instance)
        matched, visible_model_id = _runtime_catalog_match(payload["models"], target_model_id)
        return ModelReadinessResponse(
            model_id=target_model_id,
            ready=matched,
            visible_model_id=visible_model_id,
            reason=None if matched else "Model is not configured for the current nanobot gateway instance",
        )

    client: GatewayClient | HermesClient | None = None
    try:
        client = await _connect_gateway_with_retries(instance)
        raw = await client.list_models()
        models = _extract_runtime_model_list(raw)

        # Hermes manages model routing internally — its runtime catalog only
        # reports "hermes-agent" regardless of the backend model the user
        # configured.  As long as the API server is reachable and exposes at
        # least one model, the gateway is ready to accept requests.
        if instance.platform == "hermes" and models:
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
