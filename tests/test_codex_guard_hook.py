from __future__ import annotations

import io
import json
import sys

from xsafeclaw.integrations import codex_guard_hook


class FakeResponse:
    def __init__(self, payload: dict):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self) -> bytes:
        return json.dumps(self._payload).encode("utf-8")


def test_codex_hook_pretooluse_allow_is_silent(monkeypatch, capsys):
    captured: dict = {}

    def fake_urlopen(request, timeout):
        captured["timeout"] = timeout
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return FakeResponse({"action": "allow"})

    monkeypatch.setattr(codex_guard_hook.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(
        sys,
        "stdin",
        io.StringIO(
            json.dumps(
                {
                    "hook_event_name": "PreToolUse",
                    "tool_name": "Bash",
                    "tool_input": {"command": "npm test"},
                    "turn_id": "turn-1",
                    "cwd": "E:/work/project",
                }
            )
        ),
    )

    assert codex_guard_hook.main(["--session-key", "codex:thread-existing"]) == 0

    assert capsys.readouterr().out == ""
    assert captured["body"]["platform"] == "codex"
    assert captured["body"]["tool_name"] == "Shell"
    assert captured["body"]["params"]["command"] == "npm test"
    assert captured["body"]["force_approval"] is False


def test_codex_hook_permission_request_forces_approval_and_denies(monkeypatch, capsys):
    captured: dict = {}

    def fake_urlopen(request, timeout):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return FakeResponse({"action": "block", "reason": "Denied by reviewer"})

    monkeypatch.setattr(codex_guard_hook.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(
        sys,
        "stdin",
        io.StringIO(
            json.dumps(
                {
                    "hook_event_name": "PermissionRequest",
                    "tool_name": "Bash",
                    "tool_input": {"command": "rm -rf build"},
                    "turn_id": "turn-1",
                    "cwd": "E:/work/project",
                }
            )
        ),
    )

    assert codex_guard_hook.main(["--session-key", "codex:thread-existing"]) == 0

    output = json.loads(capsys.readouterr().out)
    assert captured["body"]["force_approval"] is True
    assert output == {
        "hookSpecificOutput": {
            "hookEventName": "PermissionRequest",
            "decision": {"behavior": "deny", "message": "Denied by reviewer"},
        }
    }


def test_codex_hook_guard_unavailable_blocks_tool(monkeypatch, capsys):
    def fake_urlopen(_request, timeout):
        raise OSError("connection refused")

    monkeypatch.setattr(codex_guard_hook.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(
        sys,
        "stdin",
        io.StringIO(json.dumps({"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": "whoami"}})),
    )

    assert codex_guard_hook.main(["--session-key", "codex:thread-existing"]) == 0

    output = json.loads(capsys.readouterr().out)
    assert output["hookSpecificOutput"]["hookEventName"] == "PreToolUse"
    assert output["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert "XSafeClaw Guard unavailable" in output["hookSpecificOutput"]["permissionDecisionReason"]
