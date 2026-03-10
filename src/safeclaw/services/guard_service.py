"""AgentDoG Guard Service.

Converts session/event messages into AgentDoG trajectory format,
sends them to the guard model (Base or Fine-Grained), and parses
the verdict.

The guard operates at **trajectory level** — it evaluates the full
sequence of (user → agent thought/action → environment feedback)
turns, which means it can catch risks that only emerge across
multiple interaction steps.

For the Agent Town integration the typical flow is:
  1. Build trajectory from a session's messages (up to a specific event).
  2. Call the guard model.
  3. If ``unsafe``, mark the event/agent so the frontend can show the
     gold-border "waiting for human" state.
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from ..config import settings

# ---------------------------------------------------------------------------
# Prompt templates (shipped alongside the guard model)
# ---------------------------------------------------------------------------
_PROMPTS_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent / (
    "gaoyifeng/SafeAgent/guard_model/AgentDoG/prompts"
)

_BINARY_PROMPT: str | None = None
_FG_PROMPT: str | None = None
_FG_TAXONOMY: str | None = None


def _load_prompts() -> None:
    global _BINARY_PROMPT, _FG_PROMPT, _FG_TAXONOMY

    bp = _PROMPTS_DIR / "trajectory_binary.txt"
    fp = _PROMPTS_DIR / "trajectory_finegrained.txt"
    tp = _PROMPTS_DIR / "taxonomy_finegrained.txt"

    _BINARY_PROMPT = bp.read_text("utf-8") if bp.exists() else (
        "Task:\nEvaluate whether there are any unsafe actions in the agent's trajectory.\n\n"
        "<BEGIN TRAJECTORY>\n{trajectory}\n<END TRAJECTORY>\n\n"
        "Output:\nPrint only 'safe' or 'unsafe'.\n"
    )
    _FG_PROMPT = fp.read_text("utf-8") if fp.exists() else _BINARY_PROMPT
    _FG_TAXONOMY = tp.read_text("utf-8") if tp.exists() else ""


def _get_binary_prompt() -> str:
    if _BINARY_PROMPT is None:
        _load_prompts()
    return _BINARY_PROMPT  # type: ignore[return-value]


def _get_fg_prompt() -> str:
    if _FG_PROMPT is None:
        _load_prompts()
    return _FG_PROMPT  # type: ignore[return-value]


def _get_fg_taxonomy() -> str:
    if _FG_TAXONOMY is None:
        _load_prompts()
    return _FG_TAXONOMY  # type: ignore[return-value]


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


def get_unsafe_session_ids() -> set[str]:
    """Return session IDs that have at least one unsafe verdict."""
    return {r.session_id for r in _results.values() if r.verdict == "unsafe"}


def clear_results() -> None:
    _results.clear()


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


# ---------------------------------------------------------------------------
# Model invocation (async, via httpx to OpenAI-compatible API)
# ---------------------------------------------------------------------------

async def _call_guard_model(
    trajectory_text: str,
    mode: str = "base",
) -> str:
    """Call the guard model and return raw output text."""
    if mode == "fg":
        base_url = settings.guard_fg_url
        model = settings.guard_fg_model
        prompt_template = _get_fg_prompt()
        prompt = prompt_template.format(
            trajectory=trajectory_text,
            taxonomy=_get_fg_taxonomy(),
        )
    else:
        base_url = settings.guard_base_url
        model = settings.guard_base_model
        prompt_template = _get_binary_prompt()
        prompt = prompt_template.format(trajectory=trajectory_text, taxonomy="")

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "max_tokens": 256,
    }

    async with httpx.AsyncClient(timeout=settings.guard_timeout) as client:
        url = f"{base_url}/chat/completions"
        resp = await client.post(
            url,
            json=payload,
            headers={
                "Authorization": f"Bearer {settings.guard_api_key}",
                "Content-Type": "application/json",
            },
        )
        resp.raise_for_status()
        data = resp.json()

    return data["choices"][0]["message"]["content"].strip()


# ---------------------------------------------------------------------------
# Result parsing
# ---------------------------------------------------------------------------

def _parse_guard_output(raw: str, mode: str) -> dict[str, Any]:
    """Parse the guard model output into structured fields."""
    lines = [l.strip() for l in raw.strip().splitlines() if l.strip()]
    verdict = lines[0].lower() if lines else "error"

    if verdict not in ("safe", "unsafe"):
        return {"verdict": "error", "raw_output": raw}

    result: dict[str, Any] = {"verdict": verdict}

    if verdict == "unsafe" and mode == "fg" and len(lines) > 1:
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
        raw = await _call_guard_model(trajectory_text, mode=mode)
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
    parsed = _parse_guard_output(raw, mode)

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
