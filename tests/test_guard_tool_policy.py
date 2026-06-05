from __future__ import annotations

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from xsafeclaw.api.main import app
from xsafeclaw.services import guard_service


async def _wait_for_pending() -> guard_service.PendingApproval:
    for _ in range(50):
        pending = guard_service.get_all_pending()
        if pending:
            return pending[0]
        await asyncio.sleep(0)
    raise AssertionError("pending approval was not created")


@pytest.fixture(autouse=True)
def _tool_policy_state(tmp_path, monkeypatch):
    original_enabled = guard_service._guard_enabled
    original_timeout = guard_service._PENDING_TIMEOUT
    monkeypatch.setattr(guard_service, "_TOOL_POLICY_FILE", tmp_path / "tool_policies.json")
    monkeypatch.setattr(guard_service, "_DENYLIST_FILE", tmp_path / "denylist.json")
    monkeypatch.setattr(guard_service, "_RISK_RULES_FILE", tmp_path / "risk_rules.json")
    guard_service._pending.clear()
    guard_service._observations.clear()
    guard_service._guard_enabled = True
    yield
    guard_service._pending.clear()
    guard_service._observations.clear()
    guard_service._guard_enabled = original_enabled
    guard_service._PENDING_TIMEOUT = original_timeout


def test_tool_policies_default_and_persistence():
    assert guard_service.load_tool_policies() == {
        "shell": "guard",
        "file_system": "guard",
        "browser": "guard",
        "network": "guard",
        "git": "guard",
    }

    saved = guard_service.save_tool_policies({"shell": "ask", "network": "allow"})

    assert saved["shell"] == "ask"
    assert saved["network"] == "allow"
    assert guard_service.load_tool_policies() == saved
    assert json.loads(guard_service._TOOL_POLICY_FILE.read_text("utf-8")) == {"policies": saved}


def test_tool_policy_api_get_put_roundtrip():
    client = TestClient(app)

    put_response = client.put(
        "/api/guard/tool-policies",
        json={"policies": {"shell": "ask", "file_system": "allow"}},
    )
    assert put_response.status_code == 200
    payload = put_response.json()
    assert payload["policies"]["shell"] == "ask"
    assert payload["policies"]["file_system"] == "allow"

    get_response = client.get("/api/guard/tool-policies")
    assert get_response.status_code == 200
    assert get_response.json()["policies"] == payload["policies"]

    invalid_response = client.put(
        "/api/guard/tool-policies",
        json={"policies": {"secrets": "allow", "shell": "always"}},
    )
    assert invalid_response.status_code == 422


@pytest.mark.parametrize(
    ("tool_name", "params", "category"),
    [
        ("exec", {"command": "git status"}, "git"),
        ("exec", {"command": "bash -lc 'git status'"}, "git"),
        ("exec", {"command": "curl https://example.com"}, "network"),
        ("exec", {"command": "pwsh -Command \"Invoke-WebRequest https://example.com\""}, "network"),
        ("read_file", {"path": "README.md"}, "file_system"),
        ("browser_navigate", {"url": "https://example.com"}, "browser"),
        ("custom_tool", {"value": 1}, "unknown"),
    ],
)
def test_classify_tool_category(tool_name, params, category):
    assert guard_service.classify_tool_category(tool_name, params) == category


@pytest.mark.asyncio
async def test_allow_policy_skips_guard_model_but_not_risk_rule(monkeypatch):
    guard_service.save_tool_policies({"shell": "allow"})

    async def fail_guard_model(*_args, **_kwargs):
        raise AssertionError("guard model should not be called for allow policy")

    monkeypatch.setattr(guard_service, "_call_guard_model", fail_guard_model)

    allowed = await guard_service.check_tool_call(
        "exec",
        {"command": "echo ok"},
        "normal-session",
        platform="hermes",
        messages=[],
    )
    assert allowed == {"action": "allow"}

    blocked = await guard_service.check_tool_call(
        "exec",
        {"command": "echo blocked"},
        "risk-test-demo",
        platform="hermes",
        messages=[],
    )
    assert blocked["action"] == "block"
    assert "dry-run" in blocked["reason"]


@pytest.mark.asyncio
async def test_allow_policy_does_not_bypass_denylist(tmp_path, monkeypatch):
    guard_service.save_tool_policies({"file_system": "allow"})
    protected_dir = tmp_path / "protected"
    protected_dir.mkdir()
    protected_file = protected_dir / "secret.txt"
    protected_file.write_text("secret", encoding="utf-8")
    guard_service._DENYLIST_FILE.write_text(
        json.dumps([{"path": str(protected_dir), "operations": ["read"]}]),
        encoding="utf-8",
    )

    async def fail_guard_model(*_args, **_kwargs):
        raise AssertionError("guard model should not be called before denylist block")

    monkeypatch.setattr(guard_service, "_call_guard_model", fail_guard_model)

    result = await guard_service.check_tool_call(
        "read_file",
        {"path": str(protected_file)},
        "normal-session",
        platform="hermes",
        messages=[],
    )

    assert result["action"] == "block"


@pytest.mark.asyncio
async def test_ask_policy_creates_pending_in_guard_on(monkeypatch):
    guard_service.save_tool_policies({"shell": "ask"})

    async def fail_guard_model(*_args, **_kwargs):
        raise AssertionError("guard model should not be called for ask policy")

    monkeypatch.setattr(guard_service, "_call_guard_model", fail_guard_model)

    task = asyncio.create_task(
        guard_service.check_tool_call(
            "exec",
            {"command": "echo needs review"},
            "session-ask",
            platform="hermes",
            messages=[],
        )
    )
    pending = await _wait_for_pending()

    assert pending.guard_verdict == "policy_ask"
    assert pending.failure_mode == "Tool policy requires manual approval"

    guard_service.resolve_pending(pending.id, "approved")
    assert await task == {"action": "allow"}


@pytest.mark.asyncio
async def test_guard_policy_degrades_to_ask_when_guard_off(monkeypatch):
    guard_service.save_tool_policies({"shell": "guard"})
    guard_service._guard_enabled = False

    async def fail_guard_model(*_args, **_kwargs):
        raise AssertionError("guard model should not be called when guard is off")

    monkeypatch.setattr(guard_service, "_call_guard_model", fail_guard_model)

    task = asyncio.create_task(
        guard_service.check_tool_call(
            "exec",
            {"command": "echo guard off"},
            "session-guard-off",
            platform="hermes",
            messages=[],
        )
    )
    pending = await _wait_for_pending()

    assert pending.guard_verdict == "policy_ask"
    assert pending.failure_mode == "Guard is disabled; tool policy requires manual approval"

    guard_service.resolve_pending(pending.id, "rejected")
    result = await task
    assert result["action"] == "block"
    assert "rejected by the safety reviewer" in result["reason"]


@pytest.mark.asyncio
async def test_guard_policy_uses_existing_model_when_guard_on(monkeypatch):
    guard_service.save_tool_policies({"shell": "guard"})
    seen = {"called": False}

    async def fake_guard_model(*_args, **_kwargs):
        seen["called"] = True
        return (
            "unsafe\n"
            "Risk Source: command execution\n"
            "Failure Mode: risky command\n"
            "Real World Harm: project damage"
        )

    monkeypatch.setattr(guard_service, "_call_guard_model", fake_guard_model)

    task = asyncio.create_task(
        guard_service.check_tool_call(
            "exec",
            {"command": "echo guarded"},
            "session-guard-on",
            platform="hermes",
            messages=[{"role": "user", "content": "run a command"}],
        )
    )
    pending = await _wait_for_pending()

    assert seen["called"] is True
    assert pending.guard_verdict == "unsafe"
    assert pending.failure_mode == "risky command"

    guard_service.resolve_pending(pending.id, "approved")
    assert await task == {"action": "allow"}


@pytest.mark.asyncio
async def test_ask_policy_timeout_blocks():
    guard_service.save_tool_policies({"shell": "ask"})
    guard_service._PENDING_TIMEOUT = 0.01

    result = await guard_service.check_tool_call(
        "exec",
        {"command": "echo timeout"},
        "session-timeout",
        platform="hermes",
        messages=[],
    )

    assert result["action"] == "block"
    assert guard_service.get_all_pending()[0].resolution == "rejected"
