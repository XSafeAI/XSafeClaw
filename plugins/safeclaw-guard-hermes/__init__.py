"""
XSafeClaw Guard Plugin for Hermes Agent.

This plugin registers two hooks by default:

* ``pre_tool_call`` — sends every tool call to XSafeClaw for safety
  evaluation; unsafe calls are blocked with a reason message and may be
  long-polled for human approval (see XSafeClaw §55).
* ``post_tool_call`` — best-effort publishes tool-result telemetry so
  XSafeClaw can render Hermes tool traces in real time.

A second hook is available but **disabled by default** as of §57:

* ``pre_llm_call`` — injects SAFETY.md + PERMISSION.md into the current
  turn's user message. Only registered when
  ``XSAFECLAW_HERMES_PRE_LLM_CONTEXT_FALLBACK=1`` so XSafeClaw can
  emergency-revert to the §56b behaviour without re-deploying the
  plugin. See §57 below for why this is off by default.

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
  LLM. §56b re-introduced ``pre_llm_call`` as a hard fallback so SAFETY
  text reached the model regardless of entry point — at the cost of
  shipping the policy as **user-message context**, which some upstream
  models flag as a prompt-injection attempt.
* §57 — XSafeClaw now sends the same SAFETY/PERMISSION block as a real
  ``role: "system"`` message on every ``HermesClient.{stream,send}_chat``
  call (``api/routes/chat.py`` + ``hermes_client.py``). Hermes API
  server layers inbound system messages on top of its core system
  prompt, which is exactly the channel a host policy belongs in. This
  removes the need for the plugin-side user-message injection, so we
  default it off to avoid duplicate SAFETY text appearing in both the
  system layer AND the user-message context. The hook implementation
  is preserved verbatim so operators can re-enable it with
  ``XSAFECLAW_HERMES_PRE_LLM_CONTEXT_FALLBACK=1`` if a Hermes version
  ever drops support for inbound system messages.

Install:
    Copy this directory to ``~/.hermes/plugins/safeclaw-guard/``

Environment variables:
    SAFECLAW_URL       — XSafeClaw backend URL (default: http://localhost:6874)
    XSAFECLAW_HERMES_PRE_LLM_CONTEXT_FALLBACK
                       — Set to ``1`` to re-register the §56b
                         ``pre_llm_call`` user-message injection as an
                         emergency fallback. Leave unset for normal
                         operation (default: not set).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 310
EVENT_TIMEOUT_SECONDS = 2.0

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


def _encode_session_key(session_id: str = "", task_id: str = "") -> tuple[str, str]:
    bare = (session_id or task_id or "").strip()
    encoded = f"hermes::hermes-default::{bare}" if bare else ""
    return bare, encoded


def _post_json(url: str, payload: dict, timeout_s: float):
    import requests

    return requests.post(url, json=payload, timeout=timeout_s)


def _publish_event(
    *,
    event_type: str,
    session_key: str,
    tool_name: str = "",
    tool_call_id: str = "",
    args: Any = None,
    result: Any = None,
    is_error: bool = False,
    duration_ms: int | None = None,
    reason: str = "",
    text: str = "",
) -> None:
    if not session_key:
        return
    try:
        _post_json(
            f"{_get_base_url()}/api/chat/hermes-events",
            payload={
                "session_key": session_key,
                "event_type": event_type,
                "tool_name": tool_name or None,
                "tool_call_id": tool_call_id or None,
                "args": args,
                "result": result,
                "is_error": bool(is_error),
                "duration_ms": duration_ms,
                "reason": reason or None,
                "text": text or None,
            },
            timeout_s=EVENT_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.debug(
            "safeclaw-guard: event publish failed (%s): %s",
            event_type,
            exc,
        )


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
    tool_check_url = f"{_get_base_url()}/api/guard/tool-check"
    bare_session_key, encoded_session_key = _encode_session_key(
        session_id=session_id,
        task_id=task_id,
    )

    try:
        resp = _post_json(
            tool_check_url,
            payload={
                "tool_name": tool_name,
                "params": args if isinstance(args, dict) else {},
                "session_key": encoded_session_key,
                "platform": "hermes",
                "instance_id": "hermes-default",
                "messages": _fetch_session_messages(bare_session_key),
            },
            timeout_s=TIMEOUT_SECONDS,
        )

        if not resp.ok:
            logger.warning(
                "safeclaw-guard: tool-check returned %d",
                resp.status_code,
            )
            blocked = {
                "action": "block",
                "message": (
                    "XSafeClaw guard is unavailable, so this tool call was "
                    f"blocked to preserve path protection. (HTTP {resp.status_code})"
                ),
            }
            _publish_event(
                event_type="tool_blocked",
                session_key=encoded_session_key,
                tool_name=tool_name,
                tool_call_id=tool_call_id,
                args=args,
                reason=blocked["message"],
                text=blocked["message"],
            )
            return blocked

        result = resp.json()
        if result.get("action") == "block":
            reason = result.get("reason") or (
                "This tool call poses a security risk. "
                "You MUST inform the user about the risk and reconsider before proceeding."
            )
            _publish_event(
                event_type="tool_blocked",
                session_key=encoded_session_key,
                tool_name=tool_name,
                tool_call_id=tool_call_id,
                args=args,
                reason=str(reason),
                text=str(reason),
            )
            return {"action": "block", "message": reason}

        _publish_event(
            event_type="tool_start",
            session_key=encoded_session_key,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            args=args if isinstance(args, dict) else {},
        )
    except Exception as exc:
        message = (
            "XSafeClaw guard approval timed out"
            if "timed out" in str(exc).lower()
            else (
                "XSafeClaw guard is unavailable, so this tool call was "
                "blocked to preserve path protection."
            )
        )
        logger.warning("safeclaw-guard: hook error: %s", exc)
        _publish_event(
            event_type="tool_blocked",
            session_key=encoded_session_key,
            tool_name=tool_name,
            tool_call_id=tool_call_id,
            args=args,
            reason=message,
            text=message,
        )
        return {"action": "block", "message": message}

    return None


def _post_tool_call_handler(
    tool_name: str,
    args: Dict[str, Any],
    result: Any,
    task_id: str = "",
    duration_ms: int | None = None,
    session_id: str = "",
    tool_call_id: str = "",
    **kwargs: Any,
) -> None:
    """Best-effort post-tool telemetry; does not affect tool execution."""
    _, encoded_session_key = _encode_session_key(session_id=session_id, task_id=task_id)
    result_text = str(result or "")
    is_error = False
    if isinstance(result, dict):
        is_error = bool(result.get("error"))
    elif "error" in result_text.lower():
        is_error = True
    _publish_event(
        event_type="tool_result",
        session_key=encoded_session_key,
        tool_name=tool_name,
        tool_call_id=tool_call_id or str(kwargs.get("tool_call_id") or ""),
        result=result,
        args=args if isinstance(args, dict) else {},
        is_error=is_error,
        duration_ms=duration_ms,
    )
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


_PRE_LLM_CALL_FALLBACK_ENV = "XSAFECLAW_HERMES_PRE_LLM_CONTEXT_FALLBACK"


def _pre_llm_call_fallback_enabled() -> bool:
    """Return True when the operator opted into §56b user-message injection.

    Treats ``"1"``, ``"true"``, ``"yes"`` (case-insensitive) as truthy.
    Anything else — including unset / empty — leaves ``pre_llm_call``
    unregistered, which is the §57 default.
    """
    raw = os.environ.get(_PRE_LLM_CALL_FALLBACK_ENV, "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def register(ctx: Any) -> None:
    """Hermes plugin entry point — register guard hooks.

    §57: ``pre_tool_call`` is always registered (Asset Shield + Guard
    Model runtime check). ``pre_llm_call`` is **not** registered by
    default — XSafeClaw injects the same SAFETY/PERMISSION block as a
    real ``role: "system"`` message on the API-server path, so the
    plugin-side user-message injection is redundant and would cause
    duplicate policy text in every turn.

    Set ``XSAFECLAW_HERMES_PRE_LLM_CONTEXT_FALLBACK=1`` to re-enable
    the §56b behaviour as an emergency fallback (e.g. if a Hermes
    upgrade ever drops support for inbound system messages).
    """
    ctx.register_hook("pre_tool_call", _pre_tool_call_handler)
    ctx.register_hook("post_tool_call", _post_tool_call_handler)
    hooks_registered = ["pre_tool_call", "post_tool_call"]
    if _pre_llm_call_fallback_enabled():
        ctx.register_hook("pre_llm_call", _pre_llm_call_handler)
        hooks_registered.append("pre_llm_call")
    logger.info(
        "safeclaw-guard: registered hooks=%s backend=%s workspace=%s",
        hooks_registered,
        _get_base_url(),
        _HERMES_WORKSPACE,
    )
