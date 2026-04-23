"""
XSafeClaw Guard Plugin for Hermes Agent.

1. ``pre_tool_call`` — sends every tool call to XSafeClaw for safety
   evaluation; unsafe calls are blocked with a reason message.
2. ``pre_llm_call`` — injects SAFETY.md and PERMISSION.md from the
   workspace into every conversation turn as user-message context.

This is the Hermes-native counterpart of the OpenClaw TypeScript plugin
(plugins/safeclaw-guard/index.ts).

Install:
    Copy this directory to ``~/.hermes/plugins/safeclaw-guard/``

Environment variables:
    SAFECLAW_URL       — XSafeClaw backend URL (default: http://localhost:6874)
    SAFECLAW_WORKSPACE — Path to workspace containing SAFETY.md / PERMISSION.md
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 310
SAFETY_FILES = ("SAFETY.md", "PERMISSION.md")

# mtime-based file cache: {path_str: (content, mtime)}
_file_cache: Dict[str, tuple] = {}


def _resolve_workspace_dir() -> Optional[Path]:
    """Resolve the workspace directory holding SAFETY.md / PERMISSION.md.

    Priority:
      1. ``SAFECLAW_WORKSPACE`` env var (operator override).
      2. ``$HERMES_HOME/workspace`` (defaults to ``~/.hermes/workspace``) —
         this matches XSafeClaw onboard's reported workspace path and the
         Hermes docker entrypoint convention. It only counts as a hit when
         the directory actually contains ``SAFETY.md`` so we don't return
         an empty workspace and inject an empty context block.
      3. Current working directory — kept as a last-resort fallback for
         users who launch ``hermes`` themselves from inside a project that
         already ships a ``SAFETY.md``.

    Note: Hermes does not have a top-level ``workspace`` key in
    ``config.yaml`` (verified against the Config schema in
    ``hermes_cli/config.py``), so reading it would have always missed.
    """
    env_ws = os.environ.get("SAFECLAW_WORKSPACE", "").strip()
    if env_ws:
        p = Path(env_ws).expanduser()
        if p.is_dir():
            return p

    hermes_home = Path(
        os.environ.get("HERMES_HOME") or (Path.home() / ".hermes")
    )
    standard_ws = hermes_home / "workspace"
    if standard_ws.is_dir() and (standard_ws / "SAFETY.md").exists():
        return standard_ws

    cwd = Path.cwd()
    if (cwd / "SAFETY.md").exists():
        return cwd

    return None


def _read_cached_file(file_path: Path) -> Optional[str]:
    """Read a file with mtime-based caching."""
    try:
        if not file_path.exists():
            return None
        mtime = file_path.stat().st_mtime
        key = str(file_path)
        cached = _file_cache.get(key)
        if cached and cached[1] == mtime:
            return cached[0]
        content = file_path.read_text(encoding="utf-8").strip()
        if not content:
            return None
        _file_cache[key] = (content, mtime)
        return content
    except Exception:
        return None


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


def _pre_llm_call_handler(
    session_id: str = "",
    user_message: str = "",
    **kwargs: Any,
) -> Optional[Dict[str, str]]:
    """Inject SAFETY.md and PERMISSION.md content into the user message.

    Returns ``{"context": "..."}`` when policy files are found, or
    ``None`` when no files are available.
    """
    ws_dir = _resolve_workspace_dir()
    if not ws_dir:
        return None

    sections: list[str] = []
    for filename in SAFETY_FILES:
        content = _read_cached_file(ws_dir / filename)
        if content:
            sections.append(f"## {filename}\n{content}")

    if not sections:
        return None

    return {"context": "\n\n".join(sections)}


def register(ctx: Any) -> None:
    """Hermes plugin entry point — register guard hooks."""
    ctx.register_hook("pre_tool_call", _pre_tool_call_handler)
    ctx.register_hook("pre_llm_call", _pre_llm_call_handler)
    logger.info(
        "safeclaw-guard: registered (backend=%s)", _get_base_url(),
    )
