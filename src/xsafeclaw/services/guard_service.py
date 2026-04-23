"""AgentDoG Guard Service.

Converts session/event messages into AgentDoG trajectory format,
sends them to the guard model (Base or Fine-Grained), and parses
the verdict.

The guard operates at **trajectory level** — it evaluates the full
sequence of (user → agent thought/action → environment feedback)
turns, which means it can catch risks that only emerge across
multiple interaction steps.

Also provides **real-time tool-call guard** via the ``check_tool_call``
API.  When the guard model deems a tool call *unsafe*, the call is held
in a pending-approval queue.  The OpenClaw ``before_tool_call`` plugin
long-polls the ``/guard/tool-check`` endpoint until a human resolves the
pending item (approve / reject).
"""

from __future__ import annotations

import asyncio
import json
import re
import time
import uuid

GUARD_REJECTION_MARKER = "rejected by the safety reviewer"
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import logging

import httpx

from ..config import settings
from ..path_protection import (
    build_block_reason,
    extract_exec_operations,
    load_rules,
    match_protected_scope,
)
from ..risk_rules import build_risk_rule_block_reason, load_risk_rules, match_risk_rule

logger = logging.getLogger(__name__)
_GUARD_BLOCK_REASON = (
    "This tool call has been rejected by the safety reviewer due to potential security risks. "
    "You MUST immediately stop all subsequent actions, inform the user about the risk, and wait "
    "for explicit user confirmation before proceeding with any further operations."
)

# ---------------------------------------------------------------------------
# Prompt templates (bundled with XSafeClaw)
# ---------------------------------------------------------------------------
_PROMPTS_DIR = Path(__file__).resolve().parent / "guard_prompts"

_FG_PROMPT: str | None = None
_FG_TAXONOMY: str | None = None


def _load_prompts() -> None:
    global _FG_PROMPT, _FG_TAXONOMY
    fp = _PROMPTS_DIR / "trajectory_finegrained.txt"
    tp = _PROMPTS_DIR / "taxonomy_finegrained.txt"
    _FG_PROMPT = fp.read_text("utf-8") if fp.exists() else (
        "Task:\nEvaluate whether there are any unsafe actions in the agent's trajectory.\n\n"
        "<BEGIN TRAJECTORY>\n{trajectory}\n<END TRAJECTORY>\n\n"
        "Output:\n- Line 1: 'safe' or 'unsafe' (and nothing else).\n"
        "- If 'unsafe', output: Risk Source / Failure Mode / Real World Harm.\n"
    )
    _FG_TAXONOMY = tp.read_text("utf-8") if tp.exists() else ""


def _get_fg_prompt() -> str:
    if _FG_PROMPT is None:
        _load_prompts()
    return _FG_PROMPT  # type: ignore[return-value]


def _get_fg_taxonomy() -> str:
    if _FG_TAXONOMY is None:
        _load_prompts()
    return _FG_TAXONOMY  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# OpenClaw configured model discovery
# ---------------------------------------------------------------------------
_OPENCLAW_DIR = Path.home() / ".openclaw"
_CONFIG_PATH = _OPENCLAW_DIR / "openclaw.json"

_cached_model_info: dict[str, str] | None = None


def _get_openclaw_model_info() -> dict[str, str]:
    """Read OpenClaw's configured model/provider/baseUrl/apiKey.

    Config layout (openclaw.json):
      agents.defaults.model.primary = "openai/gpt-5-mini"
      models.providers.<provider>.baseUrl = "https://..."

    Auth profiles (~/.openclaw/agents/main/agent/auth-profiles.json):
      profiles.<provider:default>.key = "sk-..."

    Falls back to settings.guard_* if openclaw.json is unavailable.
    """
    global _cached_model_info
    if _cached_model_info is not None:
        return _cached_model_info

    _DEFAULT_PROVIDER_URLS = {
        "openai": "https://api.openai.com/v1",
        "anthropic": "https://api.anthropic.com/v1",
        "moonshot": "https://api.moonshot.cn/v1",
        "deepseek": "https://api.deepseek.com/v1",
    }

    def _resolve_provider(prov: str, config: dict, auth_profiles: dict) -> tuple[str, str, str]:
        """Return (model_id, base_url, api_key) for a given provider."""
        providers_cfg = config.get("models", {}).get("providers", {})
        burl = ""
        if prov in providers_cfg:
            burl = providers_cfg[prov].get("baseUrl", "")
            models_list = providers_cfg[prov].get("models", [])
        else:
            models_list = []
        if not burl:
            burl = _DEFAULT_PROVIDER_URLS.get(prov, "")

        first_model = models_list[0]["id"] if models_list else ""

        akey = ""
        pk = f"{prov}:default"
        if pk in auth_profiles:
            akey = auth_profiles[pk].get("key", "")
        if not akey:
            for _k, v in auth_profiles.items():
                if v.get("provider") == prov:
                    akey = v.get("key", "")
                    break
        return first_model, burl, akey

    try:
        config = json.loads(_CONFIG_PATH.read_text("utf-8"))

        primary = (
            config.get("agents", {})
            .get("defaults", {})
            .get("model", {})
            .get("primary", "")
        )
        provider = primary.split("/")[0] if "/" in primary else ""
        model_id = primary.split("/", 1)[1] if "/" in primary else primary

        auth_profiles: dict = {}
        auth_path = _OPENCLAW_DIR / "agents" / "main" / "agent" / "auth-profiles.json"
        if auth_path.exists():
            auth_profiles = json.loads(auth_path.read_text("utf-8")).get("profiles", {})

        _, base_url, api_key = _resolve_provider(provider, config, auth_profiles)

        providers_cfg = config.get("models", {}).get("providers", {})
        primary_has_provider_cfg = provider in providers_cfg
        if not base_url or not api_key or not primary_has_provider_cfg:
            for alt_prov in providers_cfg:
                if alt_prov == provider:
                    continue
                alt_model, alt_url, alt_key = _resolve_provider(alt_prov, config, auth_profiles)
                if alt_url and alt_key and alt_model:
                    print(f"[guard] Using provider {alt_prov} (primary {provider} not fully configured)")
                    provider = alt_prov
                    base_url = alt_url
                    api_key = alt_key
                    model_id = alt_model
                    break

        if not base_url:
            base_url = settings.guard_base_url.rstrip("/v1")
        if not api_key:
            api_key = settings.guard_api_key
        if not model_id:
            model_id = settings.guard_base_model

        if base_url and not base_url.endswith("/v1"):
            base_url = base_url.rstrip("/") + "/v1"

        _cached_model_info = {
            "model": model_id,
            "base_url": base_url,
            "api_key": api_key,
        }
    except Exception:
        _cached_model_info = {
            "model": settings.guard_base_model,
            "base_url": settings.guard_base_url,
            "api_key": settings.guard_api_key,
        }

    return _cached_model_info


def invalidate_model_cache() -> None:
    """Force re-read of openclaw.json on next guard call."""
    global _cached_model_info
    _cached_model_info = None


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class GuardResult:
    """Result of a single guard check."""

    session_id: str
    event_id: str | None = None
    mode: str = "base"                   # "base" | "fg"
    verdict: str = "pending"             # "safe" | "unsafe" | "error" | "pending"
    risk_source: str | None = None       # FG only
    failure_mode: str | None = None      # FG only
    real_world_harm: str | None = None   # FG only
    raw_output: str = ""
    checked_at: float = 0.0
    duration_ms: int = 0
    trajectory_rounds: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "event_id": self.event_id,
            "mode": self.mode,
            "verdict": self.verdict,
            "risk_source": self.risk_source,
            "failure_mode": self.failure_mode,
            "real_world_harm": self.real_world_harm,
            "raw_output": self.raw_output,
            "checked_at": self.checked_at,
            "duration_ms": self.duration_ms,
            "trajectory_rounds": self.trajectory_rounds,
        }


# ---------------------------------------------------------------------------
# In-memory result store (keyed by session_id or session_id:event_id)
# ---------------------------------------------------------------------------

_results: dict[str, GuardResult] = {}


def get_result(session_id: str, event_id: str | None = None) -> GuardResult | None:
    key = f"{session_id}:{event_id}" if event_id else session_id
    return _results.get(key)


def get_all_results() -> list[GuardResult]:
    return list(_results.values())


def get_latest_results_by_session() -> dict[str, GuardResult]:
    """Return the latest cached guard result for each session."""
    latest: dict[str, GuardResult] = {}
    for result in _results.values():
        current = latest.get(result.session_id)
        if current is None or result.checked_at >= current.checked_at:
            latest[result.session_id] = result
    return latest


def get_unsafe_session_ids() -> set[str]:
    """Return session IDs that have at least one unsafe verdict."""
    return {r.session_id for r in _results.values() if r.verdict == "unsafe"}


def get_pending_session_ids() -> set[str]:
    """Return session IDs whose latest cached verdict is still unsafe."""
    return {
        session_id
        for session_id, result in get_latest_results_by_session().items()
        if result.verdict == "unsafe"
    }


def clear_results() -> None:
    _results.clear()


def _denylist_precheck(tool_name: str, params: dict[str, Any]) -> str | None:
    """Block exec calls that hit a user-protected path for the matched operation."""
    if tool_name != "exec":
        return None
    cmd = params.get("command") or params.get("cmd") or ""
    if not isinstance(cmd, str) or not cmd.strip():
        return None

    denylist = _load_denylist()
    if not denylist:
        return None

    for operation, target in extract_exec_operations(cmd):
        protected_root = match_protected_scope(target, operation, denylist)
        if protected_root:
            return build_block_reason(target, operation, protected_root)

    return None


async def _risk_rule_precheck(
    tool_name: str,
    params: dict[str, Any],
    session_key: str,
    session_trajectory: str | None = None,
) -> str | None:
    """Block risky tool calls based on persisted dry-run findings."""
    if session_key.startswith("risk-test-"):
        return (
            "风险测试当前处于 dry-run / 预演模式。"
            "所有工具调用都会被直接阻止，请只输出步骤描述、风险判断或拒绝结果。"
        )

    rules = _load_risk_rules()
    if not rules:
        return None

    if session_trajectory is None:
        session_trajectory = await _fetch_session_trajectory(session_key) if session_key else ""
    matched_rule = match_risk_rule(session_trajectory, tool_name, params, rules)
    if matched_rule:
        return build_risk_rule_block_reason(matched_rule)
    return None


# ---------------------------------------------------------------------------
# Trajectory conversion (mirrors convert_from_api.py logic)
# ---------------------------------------------------------------------------

def messages_to_trajectory(
    messages: list[dict[str, Any]],
    profile: str = "OpenClaw AI Agent",
) -> dict[str, Any]:
    """Convert a list of message dicts into AgentDoG trajectory format.

    Expected message fields: role, content_text, tool_calls (optional list).
    Roles mapped: user → user, assistant → agent, toolResult → environment.
    Rounds are split on each user message.
    """
    rounds: list[list[dict[str, Any]]] = []
    current_round: list[dict[str, Any]] = []

    for msg in messages:
        role = msg.get("role", "")

        if role == "user":
            if current_round:
                rounds.append(current_round)
            current_round = [{"role": "user", "content": msg.get("content_text", "") or ""}]

        elif role == "assistant":
            turn: dict[str, Any] = {"role": "agent"}
            thought = msg.get("content_text", "") or ""
            if thought:
                turn["thought"] = thought
            tool_calls = msg.get("tool_calls") or []
            if tool_calls:
                actions = [
                    {"name": tc.get("tool_name", ""), "arguments": tc.get("arguments", {})}
                    for tc in tool_calls
                ]
                turn["action"] = json.dumps(
                    actions if len(actions) > 1 else actions[0],
                    ensure_ascii=False,
                )
            current_round.append(turn)

        elif role in ("toolResult", "tool"):
            current_round.append(
                {"role": "environment", "content": msg.get("content_text", "") or ""}
            )

    if current_round:
        rounds.append(current_round)

    return {"profile": profile, "contents": rounds}


# ---------------------------------------------------------------------------
# Trajectory formatting (mirrors format_conversation_history)
# ---------------------------------------------------------------------------

def format_trajectory(trajectory: dict[str, Any]) -> str:
    """Render a trajectory dict as the text format expected by the prompt."""
    parts: list[str] = []

    profile = trajectory.get("profile")
    if profile:
        parts.append(f"=== Agent Profile ===\n{profile}\n")

    parts.append("=== Conversation History ===")

    for round_item in trajectory.get("contents", []):
        if not isinstance(round_item, list):
            continue
        for turn in round_item:
            if not isinstance(turn, dict):
                continue
            role = turn.get("role")
            if role == "user":
                content = turn.get("content", "")
                if content:
                    parts.append(f"\n[USER]: {content}")
            elif role == "agent":
                agent_parts: list[str] = []
                for key, value in turn.items():
                    if key == "role" or value in (None, ""):
                        continue
                    agent_parts.append(f"[{key.upper()}]: {str(value).strip()}")
                if agent_parts:
                    parts.append("\n[AGENT]:\n" + "\n".join(agent_parts))
            elif role == "environment":
                content = turn.get("content", "")
                if content:
                    parts.append(f"\n[ENVIRONMENT]: {content}")

    return "\n".join(parts)


def _flatten_message_content(content: Any) -> str:
    """Convert runtime message content into plain text for trajectory checks."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                parts.append(str(item))
                continue
            item_type = item.get("type")
            if item_type == "text" and item.get("text"):
                parts.append(str(item["text"]))
            elif item_type in {"input_text", "output_text"} and item.get("text"):
                parts.append(str(item["text"]))
            elif item_type == "tool_result" and item.get("content"):
                parts.append(_flatten_message_content(item.get("content")))
        return " ".join(part for part in parts if part)
    if isinstance(content, dict):
        if "text" in content:
            return str(content.get("text") or "")
        return json.dumps(content, ensure_ascii=False)
    if content is None:
        return ""
    return str(content)


def _normalize_runtime_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize runtime-submitted messages into the internal guard format."""
    normalized: list[dict[str, Any]] = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or "")
        tool_calls_raw = message.get("tool_calls")
        if not isinstance(tool_calls_raw, list):
            tool_calls_raw = message.get("toolCalls")
        tool_calls: list[dict[str, Any]] = []
        if isinstance(tool_calls_raw, list):
            for tool_call in tool_calls_raw:
                if not isinstance(tool_call, dict):
                    continue
                function = tool_call.get("function") if isinstance(tool_call.get("function"), dict) else {}
                arguments = function.get("arguments", tool_call.get("arguments", {}))
                if isinstance(arguments, str):
                    try:
                        arguments = json.loads(arguments)
                    except Exception:
                        arguments = {"raw": arguments}
                tool_calls.append(
                    {
                        "tool_name": function.get("name") or tool_call.get("name") or "",
                        "arguments": arguments if isinstance(arguments, dict) else {},
                    }
                )
        normalized.append(
            {
                "role": role,
                "content_text": str(
                    message.get("content_text")
                    if isinstance(message.get("content_text"), str)
                    else _flatten_message_content(message.get("content"))
                ),
                "tool_calls": tool_calls,
            }
        )
    return normalized


def _build_runtime_trajectory_text(
    messages: list[dict[str, Any]],
    *,
    profile: str,
) -> str:
    normalized = _normalize_runtime_messages(messages)
    if not normalized:
        return ""
    return format_trajectory(messages_to_trajectory(normalized, profile=profile))


# ---------------------------------------------------------------------------
# Model invocation — uses OpenClaw's configured model
# ---------------------------------------------------------------------------

async def _call_guard_model(trajectory_text: str) -> str:
    """Call the guard model and return raw output text.

    Always uses the fine-grained prompt with full taxonomy.
    The model/baseUrl/apiKey are read from OpenClaw's config.
    """
    model_info = _get_openclaw_model_info()
    print(f"[guard] model={model_info['model']} base_url={model_info['base_url']}")
    prompt_template = _get_fg_prompt()
    prompt = prompt_template.format(
        trajectory=trajectory_text,
        taxonomy=_get_fg_taxonomy(),
    )

    payload = {
        "model": model_info["model"],
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 1024,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        url = f"{model_info['base_url']}/chat/completions"
        resp = await client.post(
            url,
            json=payload,
            headers={
                "Authorization": f"Bearer {model_info['api_key']}",
                "Content-Type": "application/json",
            },
        )
        resp.raise_for_status()
        data = resp.json()

    choice = data.get("choices", [{}])[0]
    message = choice.get("message", {})
    content = message.get("content") or ""
    result = content.strip()

    if not result:
        reasoning = message.get("reasoning_content", "")
        if reasoning:
            print(f"[guard] content empty, extracting from reasoning_content ({len(reasoning)} chars)")
            print(f"[guard] reasoning_content: {reasoning[:800]}")
            lower_reasoning = reasoning.lower()
            if "unsafe" in lower_reasoning:
                lines = ["unsafe"]
                for ln in reasoning.split("\n"):
                    stripped = ln.strip()
                    cleaned = re.sub(r"^[-*•]\s*", "", stripped)
                    cl = cleaned.lower()
                    if cl.startswith("risk source:"):
                        lines.append("Risk Source:" + cleaned.split(":", 1)[1])
                    elif cl.startswith("failure mode:"):
                        lines.append("Failure Mode:" + cleaned.split(":", 1)[1])
                    elif cl.startswith("real world harm:") or cl.startswith("real-world harm:"):
                        lines.append("Real World Harm:" + cleaned.split(":", 1)[1])
                # Regex fallback if structured lines not found
                if len(lines) == 1:
                    rs = re.search(r"risk\s*source[:\s]+(.+?)(?:\n|$)", reasoning, re.IGNORECASE)
                    fm = re.search(r"failure\s*mode[:\s]+(.+?)(?:\n|$)", reasoning, re.IGNORECASE)
                    rh = re.search(r"real[\s-]*world\s*harm[:\s]+(.+?)(?:\n|$)", reasoning, re.IGNORECASE)
                    if rs: lines.append("Risk Source: " + rs.group(1).strip())
                    if fm: lines.append("Failure Mode: " + fm.group(1).strip())
                    if rh: lines.append("Real World Harm: " + rh.group(1).strip())
                result = "\n".join(lines)
            elif "safe" in lower_reasoning:
                result = "safe"

    if not result:
        print(f"[guard] empty response, full data: {json.dumps(data, ensure_ascii=False)[:500]}")
    else:
        print(f"[guard] response: {result[:400]}")
    return result


# ---------------------------------------------------------------------------
# Result parsing
# ---------------------------------------------------------------------------

def _parse_guard_output(raw: str) -> dict[str, Any]:
    """Parse the guard model output into structured fields."""
    lines = [l.strip() for l in raw.strip().splitlines() if l.strip()]
    verdict = lines[0].lower() if lines else "error"

    if verdict not in ("safe", "unsafe"):
        return {"verdict": "error", "raw_output": raw}

    result: dict[str, Any] = {"verdict": verdict}

    if verdict == "unsafe" and len(lines) > 1:
        for line in lines[1:]:
            lower = line.lower()
            if lower.startswith("risk source:"):
                result["risk_source"] = line.split(":", 1)[1].strip()
            elif lower.startswith("failure mode:"):
                result["failure_mode"] = line.split(":", 1)[1].strip()
            elif lower.startswith("real world harm:") or lower.startswith("real-world harm:"):
                result["real_world_harm"] = line.split(":", 1)[1].strip()

    return result


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def check_trajectory(
    trajectory: dict[str, Any],
    session_id: str,
    event_id: str | None = None,
    mode: str = "base",
) -> GuardResult:
    """Run guard check on a pre-built trajectory.

    Args:
        trajectory: AgentDoG trajectory dict.
        session_id: Owning session.
        event_id: Optional event ID (for event-level checks).
        mode: ``"base"`` for binary, ``"fg"`` for fine-grained.

    Returns:
        GuardResult stored in the in-memory cache.
    """
    trajectory_text = format_trajectory(trajectory)
    n_rounds = len(trajectory.get("contents", []))

    t0 = time.time()
    try:
        raw = await _call_guard_model(trajectory_text)
    except Exception as exc:
        result = GuardResult(
            session_id=session_id,
            event_id=event_id,
            mode=mode,
            verdict="error",
            raw_output=str(exc),
            checked_at=time.time(),
            duration_ms=int((time.time() - t0) * 1000),
            trajectory_rounds=n_rounds,
        )
        key = f"{session_id}:{event_id}" if event_id else session_id
        _results[key] = result
        return result

    elapsed_ms = int((time.time() - t0) * 1000)
    parsed = _parse_guard_output(raw)

    result = GuardResult(
        session_id=session_id,
        event_id=event_id,
        mode=mode,
        verdict=parsed.get("verdict", "error"),
        risk_source=parsed.get("risk_source"),
        failure_mode=parsed.get("failure_mode"),
        real_world_harm=parsed.get("real_world_harm"),
        raw_output=raw,
        checked_at=time.time(),
        duration_ms=elapsed_ms,
        trajectory_rounds=n_rounds,
    )

    key = f"{session_id}:{event_id}" if event_id else session_id
    _results[key] = result
    return result


async def check_messages(
    messages: list[dict[str, Any]],
    session_id: str,
    event_id: str | None = None,
    mode: str = "base",
    profile: str = "OpenClaw AI Agent",
) -> GuardResult:
    """Build trajectory from message list and run guard check."""
    trajectory = messages_to_trajectory(messages, profile=profile)
    return await check_trajectory(
        trajectory, session_id=session_id, event_id=event_id, mode=mode,
    )


async def health_check() -> dict[str, Any]:
    """Quick connectivity check to both guard model endpoints."""
    results: dict[str, Any] = {}

    for label, url in [("base", settings.guard_base_url), ("fg", settings.guard_fg_url)]:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(f"{url}/models")
                results[label] = {
                    "status": "ok" if resp.status_code == 200 else "error",
                    "url": url,
                    "status_code": resp.status_code,
                }
        except Exception as exc:
            results[label] = {"status": "unreachable", "url": url, "error": str(exc)}

    return results


# ---------------------------------------------------------------------------
# Tool-call Guard — real-time check + pending approval
# ---------------------------------------------------------------------------

@dataclass
class PendingApproval:
    """A tool call held for human review."""

    id: str
    platform: str
    instance_id: str
    guard_mode: str
    session_key: str
    tool_name: str
    params: dict[str, Any]
    guard_verdict: str           # "unsafe" | "error"
    guard_raw: str = ""
    session_context: str = ""
    risk_source: str | None = None
    failure_mode: str | None = None
    real_world_harm: str | None = None
    created_at: float = 0.0
    resolved: bool = False
    resolution: str = ""         # "approved" | "rejected"
    resolved_at: float = 0.0
    _event: asyncio.Event = field(default_factory=asyncio.Event, repr=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "platform": self.platform,
            "instance_id": self.instance_id,
            "guard_mode": self.guard_mode,
            "session_key": self.session_key,
            "tool_name": self.tool_name,
            "params": self.params,
            "guard_verdict": self.guard_verdict,
            "guard_raw": self.guard_raw,
            "session_context": self.session_context,
            "risk_source": self.risk_source,
            "failure_mode": self.failure_mode,
            "real_world_harm": self.real_world_harm,
            "created_at": self.created_at,
            "resolved": self.resolved,
            "resolution": self.resolution,
            "resolved_at": self.resolved_at,
        }


@dataclass
class RuntimeToolObservation:
    """An observed runtime tool-call decision."""

    id: str
    platform: str
    instance_id: str
    guard_mode: str
    session_key: str
    tool_name: str
    params: dict[str, Any]
    action: str
    reason: str | None = None
    guard_verdict: str = "pending"
    guard_raw: str = ""
    session_context: str = ""
    created_at: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "platform": self.platform,
            "instance_id": self.instance_id,
            "guard_mode": self.guard_mode,
            "session_key": self.session_key,
            "tool_name": self.tool_name,
            "params": self.params,
            "action": self.action,
            "reason": self.reason,
            "guard_verdict": self.guard_verdict,
            "guard_raw": self.guard_raw,
            "session_context": self.session_context,
            "created_at": self.created_at,
        }


_pending: dict[str, PendingApproval] = {}
_observations: dict[str, RuntimeToolObservation] = {}
_PENDING_TIMEOUT = 300  # 5 minutes max wait
_MAX_OBSERVATIONS = 500

_guard_enabled: bool = True
_DENYLIST_FILE = settings.data_dir / "denylist.json"
_DENYLIST_FILE.parent.mkdir(parents=True, exist_ok=True)
_RISK_RULES_FILE = settings.data_dir / "risk_rules.json"
_RISK_RULES_FILE.parent.mkdir(parents=True, exist_ok=True)


def _load_denylist() -> dict[str, set[str]]:
    return load_rules(_DENYLIST_FILE)


def _load_risk_rules() -> list[dict[str, Any]]:
    return load_risk_rules(_RISK_RULES_FILE)


def is_guard_enabled() -> bool:
    return _guard_enabled


def set_guard_enabled(enabled: bool) -> None:
    global _guard_enabled
    _guard_enabled = enabled


def get_all_pending() -> list[PendingApproval]:
    return list(_pending.values())


def get_all_observations() -> list[RuntimeToolObservation]:
    return sorted(_observations.values(), key=lambda item: item.created_at, reverse=True)


def get_pending(pending_id: str) -> PendingApproval | None:
    return _pending.get(pending_id)


def _store_observation(observation: RuntimeToolObservation) -> None:
    _observations[observation.id] = observation
    if len(_observations) <= _MAX_OBSERVATIONS:
        return
    oldest_id = min(_observations.items(), key=lambda item: item[1].created_at)[0]
    _observations.pop(oldest_id, None)


def resolve_pending(
    pending_id: str,
    resolution: str,
) -> PendingApproval | None:
    """Resolve a pending approval — wakes the long-polling tool-check."""
    p = _pending.get(pending_id)
    if not p or p.resolved:
        return None
    p.resolved = True
    p.resolution = resolution
    p.resolved_at = time.time()
    p._event.set()
    return p


async def _fetch_session_trajectory(session_key: str) -> str:
    """Fetch the full session history from OpenClaw Gateway and format as trajectory text."""
    from ..gateway_client import GatewayClient

    try:
        client = GatewayClient()
        await client.connect()
        messages = await client.load_history(session_key, limit=200)
        await client.disconnect()
    except Exception:
        messages = []

    if not messages:
        return ""

    msg_dicts = []
    for m in messages:
        role = m.get("role", "")
        content = m.get("content", "")
        if isinstance(content, list):
            content = " ".join(
                p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"
            )
        tool_calls = []
        for tc in m.get("toolCalls", m.get("tool_calls", [])):
            tool_calls.append({
                "tool_name": tc.get("name", tc.get("tool_name", "")),
                "arguments": tc.get("arguments", tc.get("args", {})),
            })
        msg_dicts.append({
            "role": role,
            "content_text": content,
            "tool_calls": tool_calls,
        })

    trajectory = messages_to_trajectory(msg_dicts)
    return format_trajectory(trajectory)


def _record_runtime_observation(
    *,
    platform: str,
    instance_id: str,
    guard_mode: str,
    session_key: str,
    tool_name: str,
    params: dict[str, Any],
    action: str,
    reason: str | None,
    guard_verdict: str,
    guard_raw: str,
    session_context: str,
) -> None:
    _store_observation(
        RuntimeToolObservation(
            id=str(uuid.uuid4()),
            platform=platform,
            instance_id=instance_id,
            guard_mode=guard_mode,
            session_key=session_key,
            tool_name=tool_name,
            params=params,
            action=action,
            reason=reason,
            guard_verdict=guard_verdict,
            guard_raw=guard_raw,
            session_context=session_context[-4000:] if session_context else "",
            created_at=time.time(),
        )
    )


async def check_runtime_tool_call(
    *,
    platform: str,
    instance_id: str,
    guard_mode: str,
    session_key: str,
    tool_name: str,
    params: dict[str, Any],
    messages: list[dict[str, Any]],
) -> dict[str, Any]:
    """Evaluate a runtime tool call using submitted message context."""
    normalized_mode = str(guard_mode or "observe").strip().lower()
    if normalized_mode not in {"observe", "blocking"}:
        normalized_mode = "observe"

    profile = "nanobot AI Agent" if platform == "nanobot" else "OpenClaw AI Agent"
    trajectory_text = _build_runtime_trajectory_text(messages, profile=profile)

    risk_rule_reason = await _risk_rule_precheck(
        tool_name,
        params,
        session_key,
        session_trajectory=trajectory_text,
    )
    if risk_rule_reason:
        _record_runtime_observation(
            platform=platform,
            instance_id=instance_id,
            guard_mode=normalized_mode,
            session_key=session_key,
            tool_name=tool_name,
            params=params,
            action="block",
            reason=risk_rule_reason,
            guard_verdict="unsafe",
            guard_raw=risk_rule_reason,
            session_context=trajectory_text,
        )
        return {"action": "block", "reason": risk_rule_reason}

    deny_reason = _denylist_precheck(tool_name, params)
    if deny_reason:
        _record_runtime_observation(
            platform=platform,
            instance_id=instance_id,
            guard_mode=normalized_mode,
            session_key=session_key,
            tool_name=tool_name,
            params=params,
            action="block",
            reason=deny_reason,
            guard_verdict="unsafe",
            guard_raw=deny_reason,
            session_context=trajectory_text,
        )
        return {"action": "block", "reason": deny_reason}

    if not _guard_enabled:
        _record_runtime_observation(
            platform=platform,
            instance_id=instance_id,
            guard_mode=normalized_mode,
            session_key=session_key,
            tool_name=tool_name,
            params=params,
            action="allow",
            reason="Guard disabled",
            guard_verdict="disabled",
            guard_raw="",
            session_context=trajectory_text,
        )
        return {"action": "allow"}

    try:
        raw = await _call_guard_model(trajectory_text)
        parsed = _parse_guard_output(raw)
        verdict = parsed.get("verdict", "error")
    except Exception as exc:
        raw = str(exc)
        parsed = {}
        verdict = "error"

    if verdict == "safe":
        _record_runtime_observation(
            platform=platform,
            instance_id=instance_id,
            guard_mode=normalized_mode,
            session_key=session_key,
            tool_name=tool_name,
            params=params,
            action="allow",
            reason=None,
            guard_verdict="safe",
            guard_raw=raw,
            session_context=trajectory_text,
        )
        return {"action": "allow"}

    if verdict == "error":
        _record_runtime_observation(
            platform=platform,
            instance_id=instance_id,
            guard_mode=normalized_mode,
            session_key=session_key,
            tool_name=tool_name,
            params=params,
            action="allow",
            reason="Guard model unavailable, fail-open",
            guard_verdict="error",
            guard_raw=raw,
            session_context=trajectory_text,
        )
        return {"action": "allow", "reason": "Guard model unavailable, fail-open"}

    if normalized_mode == "observe":
        _record_runtime_observation(
            platform=platform,
            instance_id=instance_id,
            guard_mode=normalized_mode,
            session_key=session_key,
            tool_name=tool_name,
            params=params,
            action="allow",
            reason="Observed unsafe call; observe mode does not block execution",
            guard_verdict=verdict,
            guard_raw=raw,
            session_context=trajectory_text,
        )
        return {"action": "allow"}

    pending_id = str(uuid.uuid4())
    pending = PendingApproval(
        id=pending_id,
        platform=platform,
        instance_id=instance_id,
        guard_mode=normalized_mode,
        session_key=session_key,
        tool_name=tool_name,
        params=params,
        guard_verdict=verdict,
        guard_raw=raw,
        session_context=trajectory_text[-4000:] if trajectory_text else "",
        risk_source=parsed.get("risk_source"),
        failure_mode=parsed.get("failure_mode"),
        real_world_harm=parsed.get("real_world_harm"),
        created_at=time.time(),
    )
    _pending[pending_id] = pending

    try:
        await asyncio.wait_for(pending._event.wait(), timeout=_PENDING_TIMEOUT)
    except asyncio.TimeoutError:
        pending.resolved = True
        pending.resolution = "rejected"
        pending.resolved_at = time.time()
        _record_runtime_observation(
            platform=platform,
            instance_id=instance_id,
            guard_mode=normalized_mode,
            session_key=session_key,
            tool_name=tool_name,
            params=params,
            action="block",
            reason=_GUARD_BLOCK_REASON,
            guard_verdict=verdict,
            guard_raw=raw,
            session_context=trajectory_text,
        )
        return {"action": "block", "reason": _GUARD_BLOCK_REASON}

    if pending.resolution == "approved":
        _record_runtime_observation(
            platform=platform,
            instance_id=instance_id,
            guard_mode=normalized_mode,
            session_key=session_key,
            tool_name=tool_name,
            params=params,
            action="allow",
            reason="Approved by reviewer",
            guard_verdict=verdict,
            guard_raw=raw,
            session_context=trajectory_text,
        )
        return {"action": "allow"}

    _record_runtime_observation(
        platform=platform,
        instance_id=instance_id,
        guard_mode=normalized_mode,
        session_key=session_key,
        tool_name=tool_name,
        params=params,
        action="block",
        reason=_GUARD_BLOCK_REASON,
        guard_verdict=verdict,
        guard_raw=raw,
        session_context=trajectory_text,
    )
    return {"action": "block", "reason": _GUARD_BLOCK_REASON}


_PROFILE_BY_PLATFORM = {
    "openclaw": "OpenClaw AI Agent",
    "hermes": "Hermes AI Agent",
    "nanobot": "nanobot AI Agent",
}


async def check_tool_call(
    tool_name: str,
    params: dict[str, Any],
    session_key: str,
    *,
    platform: str = "openclaw",
    instance_id: str = "openclaw-default",
    messages: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Check a tool call against the guard model using the full session trajectory.

    Trajectory source is decided by the caller:

    - ``messages`` provided (Hermes plugin): build trajectory directly from
      the supplied conversation. The Hermes ``pre_tool_call`` hook only
      receives ``session_id`` so the plugin pre-fetches messages via
      ``hermes_state.SessionDB.get_messages`` and ships them in the body.
    - ``messages`` empty + ``platform == "openclaw"``: legacy path —
      fetch the trajectory from OpenClaw Gateway via ``GatewayClient``.
    - ``messages`` empty + other platform: skip trajectory fetch (no safe
      cross-runtime way to obtain history); the guard model receives
      only the current tool action.

    Unsafe verdicts create a ``PendingApproval`` keyed by the caller's
    ``platform`` / ``instance_id``, then long-poll for human review until
    timeout (5 min). Frontend ``Approvals`` page lists every pending
    item regardless of platform, so Hermes calls show up automatically.

    Returns dict with:
      action: "allow" | "block"
      reason: str (only when blocked)
    """
    risk_rule_reason = await _risk_rule_precheck(tool_name, params, session_key)
    if risk_rule_reason:
        return {"action": "block", "reason": risk_rule_reason}

    deny_reason = _denylist_precheck(tool_name, params)
    if deny_reason:
        return {"action": "block", "reason": deny_reason}

    if not _guard_enabled:
        return {"action": "allow"}

    profile = _PROFILE_BY_PLATFORM.get(platform, "OpenClaw AI Agent")

    if messages:
        session_trajectory = _build_runtime_trajectory_text(messages, profile=profile)
    elif platform == "openclaw":
        session_trajectory = await _fetch_session_trajectory(session_key)
    else:
        session_trajectory = ""

    current_call = (
        f"\n[AGENT]:\n"
        f"[ACTION]: {json.dumps({'name': tool_name, 'arguments': params}, ensure_ascii=False)}\n"
    )
    trajectory_text = session_trajectory + current_call if session_trajectory else (
        f"=== Agent Profile ===\n{profile}\n\n"
        f"=== Conversation History ===\n"
        f"\n[AGENT]:\n"
        f"[ACTION]: {json.dumps({'name': tool_name, 'arguments': params}, ensure_ascii=False)}\n"
    )

    print(
        f"[guard] tool-check: calling guard model for {tool_name} "
        f"(platform={platform} session={session_key})"
    )
    try:
        raw = await _call_guard_model(trajectory_text)
        parsed = _parse_guard_output(raw)
        verdict = parsed.get("verdict", "error")
        print(f"[guard] tool-check: verdict={verdict} for {tool_name}")
    except Exception as exc:
        verdict = "error"
        raw = str(exc)
        parsed = {}
        print(f"[guard] tool-check: guard model error for {tool_name}: {exc}")

    if verdict == "safe":
        return {"action": "allow"}

    if verdict == "error":
        return {"action": "allow", "reason": "Guard model unavailable, fail-open"}

    fg_parsed = parsed

    pending_id = str(uuid.uuid4())
    p = PendingApproval(
        id=pending_id,
        platform=platform,
        instance_id=instance_id,
        guard_mode="blocking",
        session_key=session_key,
        tool_name=tool_name,
        params=params,
        guard_verdict=verdict,
        guard_raw=raw,
        session_context=trajectory_text[-4000:] if trajectory_text else "",
        risk_source=fg_parsed.get("risk_source"),
        failure_mode=fg_parsed.get("failure_mode"),
        real_world_harm=fg_parsed.get("real_world_harm"),
        created_at=time.time(),
    )
    _pending[pending_id] = p

    try:
        await asyncio.wait_for(p._event.wait(), timeout=_PENDING_TIMEOUT)
    except asyncio.TimeoutError:
        p.resolved = True
        p.resolution = "rejected"
        p.resolved_at = time.time()
        return {"action": "block", "reason": _GUARD_BLOCK_REASON}

    if p.resolution == "approved":
        return {"action": "allow"}
    else:
        return {"action": "block", "reason": _GUARD_BLOCK_REASON}


def cleanup_resolved(max_age: float = 3600) -> int:
    """Remove resolved pending items older than max_age seconds."""
    now = time.time()
    to_remove = [
        k for k, v in _pending.items()
        if v.resolved and (now - v.resolved_at) > max_age
    ]
    for k in to_remove:
        del _pending[k]
    return len(to_remove)
