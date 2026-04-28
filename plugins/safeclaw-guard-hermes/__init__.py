"""
XSafeClaw Guard Plugin for Hermes Agent.

This plugin registers two hooks:

* ``pre_tool_call`` — sends every tool call to XSafeClaw for safety
  evaluation; unsafe calls are blocked with a reason message and may be
  long-polled for human approval (see XSafeClaw §55).
* ``pre_llm_call`` — injects SAFETY.md + PERMISSION.md into the current
  turn's user message as a hard fallback for Hermes's API-server path
  (see §56b history note below).

This is the Hermes-native counterpart of the OpenClaw TypeScript plugin
(plugins/safeclaw-guard/index.ts).

History:

* §54 introduced a ``pre_llm_call`` hook that injected SAFETY.md /
  PERMISSION.md into the **user message** for every turn.
* §56 removed that hook in favour of writing the same text into
  ``~/.hermes/config.yaml::agent.system_prompt``. The §56 author assumed
  Hermes Gateway always loads that field as ``ephemeral_system_prompt``
  and prepends it to the **system role** on every API call — the
  strongest constraint a plugin can route policies through.
* §56b — the §56 assumption is wrong for the API-server path that
  XSafeClaw's chat UI actually uses. ``gateway/platforms/api_server.py
  ::_handle_chat_completions`` builds ``ephemeral_system_prompt``
  exclusively from ``system``-role messages in the inbound HTTP request
  body and **never reads** ``config.yaml::agent.system_prompt``. Only the
  CLI / interactive path in ``gateway/run.py`` reads that field. As a
  result the SAFETY block written by ``_deploy_hermes_system_prompt``
  reaches Hermes CLI users but is silently dropped for every chat
  completion that flows through XSafeClaw's UI → Hermes API → upstream
  LLM. The most reliable proof: ask any Hermes-fronted Claude session
  to grep its own context for the literal sentinel
  ``xsafeclaw:safety-block:begin`` and it returns ``NOT FOUND``.
  This commit re-introduces the §54 ``pre_llm_call`` hook as a hard
  fallback so the SAFETY/PERMISSION text reaches the model regardless
  of which Hermes entry point is used. Prompt-cache reuse is sacrificed
  in exchange for not silently shipping an agent without policy
  context — the correct trade-off for a safety plugin.

Install:
    Copy this directory to ``~/.hermes/plugins/safeclaw-guard/``

Environment variables:
    SAFECLAW_URL       — XSafeClaw backend URL (default: http://localhost:6874)
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 310

_HERMES_WORKSPACE = Path(
    os.environ.get("SAFECLAW_WORKSPACE")
    or (Path.home() / ".hermes" / "workspace")
).expanduser()

_SAFETY_BLOCK_BEGIN = "<!-- xsafeclaw:safety-block:begin v1 -->"
_SAFETY_BLOCK_END = "<!-- xsafeclaw:safety-block:end -->"


def _get_base_url() -> str:
    """Return the XSafeClaw backend URL."""
    return os.environ.get("SAFECLAW_URL", "http://localhost:6874").rstrip("/")


def _read_workspace_file(name: str) -> str:
    """Return UTF-8 contents of ``<workspace>/<name>`` or empty string."""
    path = _HERMES_WORKSPACE / name
    try:
        if path.is_file():
            return path.read_text("utf-8")
    except Exception as exc:
        logger.debug("safeclaw-guard: cannot read %s: %s", path, exc)
    return ""


def _build_safety_block() -> str:
    """Compose the sentinel-wrapped SAFETY+PERMISSION block.

    Returns an empty string when both source files are missing so the
    hook becomes a no-op rather than injecting bare sentinels with no
    policy text — that would still report ``found`` to a sentinel grep
    but would actually deliver zero guidance to the model.
    """
    safety = _read_workspace_file("SAFETY.md")
    permission = _read_workspace_file("PERMISSION.md")
    if not (safety or permission):
        return ""

    sections = []
    if safety:
        sections.append(safety.rstrip())
    if permission:
        sections.append(permission.rstrip())
    body = "\n\n".join(sections)
    return f"{_SAFETY_BLOCK_BEGIN}\n# Safety Policies\n\n{body}\n{_SAFETY_BLOCK_END}"


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
    guard-model / human-approval pipeline. Hermes-specific:

    - ``messages`` — we pre-fetch trajectory locally because Hermes
      does not pass it to ``pre_tool_call`` hooks.
    - ``session_key`` — Hermes's main tool-execution path
      (``run_agent.py::_invoke_tool`` / ``_execute_tool_calls``) calls
      ``get_pre_tool_call_block_message(...)`` with ONLY ``task_id``
      (no ``session_id``). Without a fallback, every blocked tool would
      surface in the Approvals page with an empty session id and could
      not be tied back to the live Agent Town conversation. We fall
      back to ``task_id`` and then encode it into XSafeClaw's
      ``hermes::hermes-default::<id>`` chat session key so the
      pending-approval card shows up inside the matching Agent Town
      dialog (mirroring the OpenClaw TS plugin's behaviour, where the
      session key already arrives encoded).
    """
    import requests

    base_url = _get_base_url()
    tool_check_url = f"{base_url}/api/guard/tool-check"

    bare_session_key = (session_id or task_id or "").strip()
    encoded_session_key = (
        f"hermes::hermes-default::{bare_session_key}" if bare_session_key else ""
    )

    try:
        resp = requests.post(
            tool_check_url,
            json={
                "tool_name": tool_name,
                "params": args if isinstance(args, dict) else {},
                "session_key": encoded_session_key,
                "platform": "hermes",
                "instance_id": "hermes-default",
                "messages": _fetch_session_messages(bare_session_key),
            },
            timeout=TIMEOUT_SECONDS,
        )

        if not resp.ok:
            logger.warning(
                "safeclaw-guard: tool-check returned %d",
                resp.status_code,
            )
            return {
                "action": "block",
                "message": (
                    "XSafeClaw guard is unavailable, so this tool call was "
                    f"blocked to preserve path protection. (HTTP {resp.status_code})"
                ),
            }

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
            "safeclaw-guard: hook error: %s", exc,
        )
        return {
            "action": "block",
            "message": (
                "XSafeClaw guard is unavailable, so this tool call was "
                "blocked to preserve path protection."
            ),
        }

    return None


def _pre_llm_call_handler(**kwargs: Any) -> Optional[Dict[str, str]]:
    """§56b: inject SAFETY/PERMISSION as user-message context.

    Hermes's hook contract (see ``run_agent.py`` ~L8033 and
    ``website/docs/user-guide/features/hooks.md::pre_llm_call``):
    a callback that returns ``{"context": "..."}`` (or a plain string)
    has its return value appended to the **current turn's user message**
    just before the LLM request is built. This is the only sanctioned
    plugin path that reaches the model on every Hermes entry point —
    CLI, gateway, and ``/v1/chat/completions``.

    We accept ``**kwargs`` only — Hermes passes ``session_id``,
    ``user_message``, ``conversation_history``, ``is_first_turn``,
    ``model``, ``platform``, but we don't need any of them (the SAFETY
    payload is identical every turn). Accepting kwargs keeps us
    forward-compatible if Hermes adds new params.

    Returning ``None`` (when the workspace files are missing) makes this
    hook a silent no-op rather than a half-baked injection.
    """
    block = _build_safety_block()
    if not block:
        return None
    return {"context": block}


def register(ctx: Any) -> None:
    """Hermes plugin entry point — register guard hooks.

    §56b: registers BOTH ``pre_tool_call`` (Asset Shield + Guard Model
    runtime check) and ``pre_llm_call`` (SAFETY/PERMISSION fallback
    injection). The original §56 design tried to push policy through
    ``config.yaml::agent.system_prompt`` alone but that path is silently
    bypassed by ``api_server.py`` — see module docstring for the
    post-mortem.
    """
    ctx.register_hook("pre_tool_call", _pre_tool_call_handler)
    ctx.register_hook("pre_llm_call", _pre_llm_call_handler)
    logger.info(
        "safeclaw-guard: registered hooks=[pre_tool_call,pre_llm_call] "
        "backend=%s workspace=%s",
        _get_base_url(),
        _HERMES_WORKSPACE,
    )
