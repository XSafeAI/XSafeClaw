"""Codex hook runner that routes tool requests through XSafeClaw Guard.

This module is intentionally invoked only from XSafeClaw-created Codex
app-server sessions. It reads a Codex hook payload from stdin, calls the
existing Guard runtime-tool-check endpoint, and returns Codex hook output on
stdout.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from typing import Any


DEFAULT_BASE_URL = "http://127.0.0.1:6874"
DEFAULT_TIMEOUT_S = 310.0


def _first_string(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _normalize_tool_name(raw_tool_name: str | None) -> str:
    name = (raw_tool_name or "Codex Tool").strip()
    lowered = name.lower()
    if lowered in {"bash", "shell", "exec", "exec_command"}:
        return "Shell"
    if lowered in {"apply_patch", "filechange", "file_change"}:
        return "File Change"
    return name


def _tool_params(payload: dict[str, Any]) -> dict[str, Any]:
    tool_input = payload.get("tool_input")
    params: dict[str, Any] = {
        "codex_hook_event": _first_string(payload.get("hook_event_name")),
        "codex_tool_name": _first_string(payload.get("tool_name")),
        "tool_use_id": _first_string(payload.get("tool_use_id")),
        "turn_id": _first_string(payload.get("turn_id")),
        "cwd": _first_string(payload.get("cwd")),
        "model": _first_string(payload.get("model")),
        "permission_mode": _first_string(payload.get("permission_mode")),
    }
    if isinstance(tool_input, dict):
        params.update(tool_input)
        params["tool_input"] = tool_input
        command = _first_string(tool_input.get("command"), tool_input.get("cmd"), tool_input.get("script"))
        if command:
            params["command"] = command
    elif tool_input is not None:
        params["tool_input"] = tool_input
    return {key: value for key, value in params.items() if value is not None}


def _messages(payload: dict[str, Any], tool_name: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    content = json.dumps(
        {
            "event": params.get("codex_hook_event"),
            "tool_name": tool_name,
            "params": params,
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return [{"role": "assistant", "content": f"Codex is about to use a tool: {content}"}]


def _post_guard(
    *,
    base_url: str,
    timeout_s: float,
    session_key: str,
    guard_mode: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    tool_name = _normalize_tool_name(_first_string(payload.get("tool_name")))
    params = _tool_params(payload)
    event_name = (params.get("codex_hook_event") or "").strip()
    body = {
        "platform": "codex",
        "instance_id": "codex-cli",
        "guard_mode": guard_mode,
        "session_key": session_key,
        "tool_name": tool_name,
        "params": params,
        "messages": _messages(payload, tool_name, params),
        # Codex PermissionRequest means Codex itself wants a user decision.
        # Keep that behavior aligned with XSafeClaw by forcing a visible
        # PendingApproval instead of letting a "safe" guard verdict auto-allow.
        "force_approval": event_name == "PermissionRequest",
    }
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/guard/runtime-tool-check",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout_s) as response:
        raw = response.read().decode("utf-8", errors="replace")
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise RuntimeError("Guard returned a non-object response")
    return parsed


def _deny_output(event_name: str | None, reason: str) -> dict[str, Any]:
    if event_name == "PermissionRequest":
        return {
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": {"behavior": "deny", "message": reason},
            }
        }
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


def _allow_output(event_name: str | None) -> dict[str, Any] | None:
    if event_name == "PermissionRequest":
        return {
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": {"behavior": "allow"},
            }
        }
    # PreToolUse exits cleanly with no output to continue unchanged.
    return None


def _write_hook_output(output: dict[str, Any] | None) -> None:
    if output is not None:
        sys.stdout.write(json.dumps(output, ensure_ascii=False))
        sys.stdout.write("\n")
        sys.stdout.flush()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="XSafeClaw Codex Guard hook")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--session-key", required=True)
    parser.add_argument("--guard-mode", default="blocking")
    parser.add_argument("--timeout-s", type=float, default=DEFAULT_TIMEOUT_S)
    args = parser.parse_args(argv)

    try:
        payload = json.loads(sys.stdin.read() or "{}")
        if not isinstance(payload, dict):
            raise ValueError("Codex hook payload must be a JSON object")
    except Exception as exc:
        _write_hook_output(_deny_output("PreToolUse", f"Invalid Codex hook payload: {exc}"))
        return 0

    event_name = _first_string(payload.get("hook_event_name"))
    try:
        guard_result = _post_guard(
            base_url=args.base_url,
            timeout_s=args.timeout_s,
            session_key=args.session_key,
            guard_mode=args.guard_mode,
            payload=payload,
        )
    except (OSError, urllib.error.URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as exc:
        _write_hook_output(
            _deny_output(event_name, f"XSafeClaw Guard unavailable, tool blocked: {exc}")
        )
        return 0

    if guard_result.get("action") == "allow":
        _write_hook_output(_allow_output(event_name))
        return 0

    reason = _first_string(guard_result.get("reason")) or "Blocked by XSafeClaw Guard"
    _write_hook_output(_deny_output(event_name, reason))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
