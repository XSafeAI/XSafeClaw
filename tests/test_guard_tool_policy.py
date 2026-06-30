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
def _guard_runtime_state(tmp_path, monkeypatch):
    original_enabled = guard_service._guard_enabled
    original_timeout = guard_service._PENDING_TIMEOUT
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


def test_tool_policy_api_is_removed():
    client = TestClient(app)

    paths = {route.path for route in app.routes}
    assert "/api/guard/tool-policies" not in paths
    assert client.get("/api/guard/tool-policies").status_code == 404
    assert client.put("/api/guard/tool-policies", json={"policies": {"shell": "allow"}}).status_code in {404, 405}


@pytest.mark.parametrize(
    ("tool_name", "params", "category"),
    [
        ("exec", {"command": "git status"}, "git"),
        ("exec", {"command": "bash -lc 'git status'"}, "git"),
        ("exec", {"command": "curl https://example.com"}, "network"),
        ("exec", {"command": "pwsh -Command \"Invoke-WebRequest https://example.com\""}, "network"),
        ("read_file", {"path": "README.md"}, "file_system"),
        ("browser_navigate", {"url": "https://example.com"}, "browser"),
        ("mcp_list_tools", {"server": "github"}, "mcp"),
        ("search_web", {"q": "weather"}, "network"),
        ("ls", {}, "shell"),
        ("custom_tool", {"value": 1}, "unknown"),
    ],
)
def test_classify_tool_category(tool_name, params, category):
    assert guard_service.classify_tool_category(tool_name, params) == category


@pytest.mark.parametrize(
    ("tool_name", "params", "expected"),
    [
        ("exec", {"command": "git status"}, ("git", "inspect", "tool_git", "low")),
        ("read_file", {"path": "README.md"}, ("file_system", "read", "tool_file_read", "low")),
        ("write_file", {"path": "README.md"}, ("file_system", "write", "tool_file_write", "medium")),
        ("delete_file", {"path": "README.md"}, ("file_system", "delete", "tool_file_delete", "high")),
        ("browser_navigate", {"url": "https://example.com"}, ("browser", "navigate", "tool_browser", "low")),
        ("curl", {"url": "https://example.com"}, ("network", "request", "tool_network", "medium")),
        ("mcp_list_tools", {"server": "github"}, ("mcp", "request", "tool_mcp", "medium")),
        ("custom_tool", {"value": 1}, ("unknown", "unknown", "tool_unknown", "unknown")),
    ],
)
def test_timeline_tool_metadata(tool_name, params, expected):
    metadata = guard_service.timeline_tool_metadata(tool_name, params)

    assert (
        metadata["tool_category"],
        metadata["tool_action"],
        metadata["timeline_kind"],
        metadata["risk_level"],
    ) == expected


def test_enrich_timeline_event_marks_blocked_tool_high_risk():
    event = guard_service.enrich_timeline_event(
        {"type": "tool_blocked", "tool_name": "exec", "args": {"command": "rm -rf tmp"}}
    )

    assert event["tool_category"] == "file_system"
    assert event["tool_action"] == "delete"
    assert event["timeline_kind"] == "guard_blocked"
    assert event["risk_level"] == "high"


def test_pending_and_observation_responses_include_timeline_metadata():
    client = TestClient(app)
    pending = guard_service.PendingApproval(
        id="pending-1",
        platform="hermes",
        instance_id="hermes-default",
        guard_mode="prompt",
        session_key="session-1",
        tool_name="delete_file",
        params={"path": "secret.txt"},
        guard_verdict="unsafe",
        created_at=1710000000,
    )
    guard_service._pending[pending.id] = pending
    guard_service._store_observation(
        guard_service.RuntimeToolObservation(
            id="obs-1",
            platform="hermes",
            instance_id="hermes-default",
            guard_mode="prompt",
            session_key="session-1",
            tool_name="delete_file",
            params={"path": "secret.txt"},
            action="block",
            guard_verdict="unsafe",
            created_at=1710000001,
        )
    )

    pending_payload = client.get("/api/guard/pending").json()[0]
    observation_payload = client.get("/api/guard/observations").json()[0]

    assert pending_payload["tool_category"] == "file_system"
    assert pending_payload["tool_action"] == "delete"
    assert pending_payload["timeline_kind"] == "approval_request"
    assert pending_payload["risk_level"] == "high"
    assert observation_payload["tool_category"] == "file_system"
    assert observation_payload["tool_action"] == "delete"
    assert observation_payload["timeline_kind"] == "guard_blocked"
    assert observation_payload["risk_level"] == "high"


@pytest.mark.asyncio
async def test_runtime_tool_check_calls_guard_model_without_policy_shortcut(monkeypatch):
    seen = {"called": False}

    async def fake_guard_model(*_args, **_kwargs):
        seen["called"] = True
        return "safe"

    monkeypatch.setattr(guard_service, "_call_guard_model", fake_guard_model)
    monkeypatch.setattr(guard_service, "_guard_enabled", True)

    result = await guard_service.check_runtime_tool_call(
        platform="codex",
        instance_id="codex-cli",
        guard_mode="blocking",
        session_key="codex:thread-1",
        tool_name="exec",
        params={"command": "echo ok"},
        messages=[],
    )

    assert result == {"action": "allow"}
    assert seen["called"] is True


@pytest.mark.asyncio
async def test_runtime_tool_check_guard_disabled_keeps_existing_allow_semantics(monkeypatch):
    async def fail_guard_model(*_args, **_kwargs):
        raise AssertionError("guard model should not run when Guard is disabled")

    monkeypatch.setattr(guard_service, "_call_guard_model", fail_guard_model)
    monkeypatch.setattr(guard_service, "_guard_enabled", False)

    result = await guard_service.check_runtime_tool_call(
        platform="codex",
        instance_id="codex-cli",
        guard_mode="blocking",
        session_key="codex:thread-1",
        tool_name="exec",
        params={"command": "echo ok"},
        messages=[],
    )

    assert result == {"action": "allow"}
    observation = guard_service.get_all_observations()[0]
    assert observation.guard_verdict == "disabled"


@pytest.mark.asyncio
async def test_runtime_tool_check_unsafe_blocking_creates_pending(monkeypatch):
    async def fake_guard_model(*_args, **_kwargs):
        return (
            "unsafe\n"
            "Risk Source: command execution\n"
            "Failure Mode: risky command\n"
            "Real World Harm: project damage"
        )

    monkeypatch.setattr(guard_service, "_call_guard_model", fake_guard_model)
    monkeypatch.setattr(guard_service, "_guard_enabled", True)

    task = asyncio.create_task(
        guard_service.check_runtime_tool_call(
            platform="codex",
            instance_id="codex-cli",
            guard_mode="blocking",
            session_key="codex:thread-1",
            tool_name="exec",
            params={"command": "echo guarded"},
            messages=[{"role": "user", "content": "run a command"}],
        )
    )
    pending = await _wait_for_pending()

    assert pending.platform == "codex"
    assert pending.guard_verdict == "unsafe"
    assert pending.failure_mode == "risky command"

    guard_service.resolve_pending(pending.id, "approved")
    assert await task == {"action": "allow"}


@pytest.mark.asyncio
async def test_guard_flow_still_honors_risk_rules_before_model(monkeypatch):
    async def fail_guard_model(*_args, **_kwargs):
        raise AssertionError("risk-rule precheck should run before guard model")

    monkeypatch.setattr(guard_service, "_call_guard_model", fail_guard_model)

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
async def test_denylist_still_blocks_before_model(tmp_path, monkeypatch):
    protected_dir = tmp_path / "protected"
    protected_dir.mkdir()
    protected_file = protected_dir / "secret.txt"
    protected_file.write_text("secret", encoding="utf-8")
    guard_service._DENYLIST_FILE.write_text(
        json.dumps([{"path": str(protected_dir), "operations": ["read"]}]),
        encoding="utf-8",
    )

    async def fail_guard_model(*_args, **_kwargs):
        raise AssertionError("denylist precheck should run before guard model")

    monkeypatch.setattr(guard_service, "_call_guard_model", fail_guard_model)

    result = await guard_service.check_tool_call(
        "read_file",
        {"path": str(protected_file)},
        "normal-session",
        platform="hermes",
        messages=[],
    )

    assert result["action"] == "block"
