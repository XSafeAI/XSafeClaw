"""
XSafeClaw Guard Plugin for Hermes Agent.

This plugin registers a single hook:

* ``pre_tool_call`` — sends every tool call to XSafeClaw for safety
  evaluation; unsafe calls are blocked with a reason message and may be
  long-polled for human approval (see XSafeClaw §55).

This is the Hermes-native counterpart of the OpenClaw TypeScript plugin
(plugins/safeclaw-guard/index.ts).

History:

* §54 introduced a ``pre_llm_call`` hook that injected SAFETY.md /
  PERMISSION.md into the **user message** for every turn.
* §56 removed that hook because Hermes documents the user-message
  injection path as a weak constraint ("system prompt is Hermes's
  territory; plugins contribute context alongside the user's input" —
  ``run_agent.py:8038-8042``). XSafeClaw now writes the same SAFETY +
  PERMISSION text into ``~/.hermes/config.yaml::agent.system_prompt``
  during onboard, so Hermes Gateway loads it as ``ephemeral_system_prompt``
  at startup and prepends it to the **system role** on every API call —
  the strongest constraint a Hermes plugin can route policies through
  without forking the agent core. The user-message path also broke
  prompt cache reuse (one fresh ~10KB block per turn).

Install:
    Copy this directory to ``~/.hermes/plugins/safeclaw-guard/``

Environment variables:
    SAFECLAW_URL       — XSafeClaw backend URL (default: http://localhost:6874)
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 310


def _get_base_url() -> str:
    """Return the XSafeClaw backend URL."""
    return os.environ.get("SAFECLAW_URL", "http://localhost:6874").rstrip("/")


def _fetch_session_messages(session_id: str) -> list:
    """Pull the conversation trajectory from Hermes's local SessionDB.

    Hermes's ``pre_tool_call`` hook only receives ``session_id`` — it
    does not pass the message list. Without a trajectory, XSafeClaw's
    guard model would judge every tool call in isolation and would
    almost always flag them as ``unsafe`` (no context = "why are we
    doing this?" → suspicious by default), which then long-polls the
    user for approval on **every** tool call.

    Since this plugin runs inside the Hermes Python venv, we can import
    ``hermes_state.SessionDB`` directly and read ``state.db`` to get
    the same OpenAI-format messages the gateway uses for replay. The
    XSafeClaw backend's ``_normalize_runtime_messages`` already handles
    this shape (role + content/content_text + tool_calls with
    ``function: {name, arguments}``), so we ship the rows verbatim.

    Returns ``[]`` on any failure — the backend then guards on the
    current call alone, which is still safer than no guard at all.
    """
    if not session_id:
        return []
    try:
        from hermes_state import SessionDB  # type: ignore
    except Exception as exc:
        logger.debug("safeclaw-guard: hermes_state unavailable: %s", exc)
        return []

    db = None
    try:
        db = SessionDB()
        return db.get_messages(session_id) or []
    except Exception as exc:
        logger.debug(
            "safeclaw-guard: failed to load session %s messages: %s",
            session_id, exc,
        )
        return []
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass


def _pre_tool_call_handler(
    tool_name: str,
    args: Dict[str, Any],
    task_id: str = "",
    session_id: str = "",
    tool_call_id: str = "",
    **kwargs: Any,
) -> Optional[Dict[str, str]]:
    """Check every tool call against XSafeClaw's guard API.

    Returns ``{"action": "block", "message": "..."}`` when the tool call
    is deemed unsafe, or ``None`` to allow execution.

    The request body is fully aligned with OpenClaw's TS plugin so the
    backend ``check_tool_call`` runs the same risk-rule / denylist /
    guard-model / human-approval pipeline. The only Hermes-specific
    bit is ``messages`` — we pre-fetch trajectory locally because
    Hermes does not pass it to ``pre_tool_call`` hooks.
    """
    import requests

    base_url = _get_base_url()
    tool_check_url = f"{base_url}/api/guard/tool-check"

    try:
        resp = requests.post(
            tool_check_url,
            json={
                "tool_name": tool_name,
                "params": args if isinstance(args, dict) else {},
                "session_key": session_id or "",
                "platform": "hermes",
                "instance_id": "hermes-default",
                "messages": _fetch_session_messages(session_id),
            },
            timeout=TIMEOUT_SECONDS,
        )

        if not resp.ok:
            logger.warning(
                "safeclaw-guard: tool-check returned %d, allowing tool call",
                resp.status_code,
            )
            return None

        result = resp.json()
        if result.get("action") == "block":
            reason = result.get("reason") or (
                "This tool call poses a security risk. "
                "You MUST inform the user about the risk and reconsider before proceeding."
            )
            return {"action": "block", "message": reason}

    except requests.exceptions.Timeout:
        return {"action": "block", "message": "XSafeClaw guard approval timed out"}
    except Exception as exc:
        logger.warning(
            "safeclaw-guard: hook error: %s, allowing tool call", exc,
        )

    return None


def register(ctx: Any) -> None:
    """Hermes plugin entry point — register guard hooks.

    §56: only ``pre_tool_call`` is registered. SAFETY/PERMISSION
    injection is now done by XSafeClaw onboard writing
    ``~/.hermes/config.yaml::agent.system_prompt``, which Gateway loads
    as ``ephemeral_system_prompt`` at startup and prepends to the
    **system role** of every API call. See module docstring for the full
    rationale.
    """
    ctx.register_hook("pre_tool_call", _pre_tool_call_handler)
    logger.info(
        "safeclaw-guard: registered (backend=%s)", _get_base_url(),
    )
