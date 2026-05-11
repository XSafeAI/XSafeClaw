from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from xsafeclaw.api.main import app
from xsafeclaw.api.routes import chat as chat_routes
from xsafeclaw.runtime.models import RuntimeInstance, empty_capabilities
from xsafeclaw.services.hermes_event_bridge import HermesEventBridge


def test_hermes_event_bridge_isolates_session_and_bounds_result():
    bridge = HermesEventBridge(max_result_chars=128)
    bridge.publish(
        "hermes::hermes-default::s1",
        {"type": "tool_start", "tool_name": "exec", "tool_call_id": "call-1", "args": {"cmd": "ls"}},
    )
    bridge.publish(
        "hermes::hermes-default::s1",
        {"type": "tool_result", "tool_name": "exec", "tool_call_id": "call-1", "result": "x" * 512},
    )
    bridge.publish(
        "hermes::hermes-default::s2",
        {"type": "tool_start", "tool_name": "read", "tool_call_id": "call-2", "args": {"path": "a.txt"}},
    )
    bridge.publish(
        "hermes::hermes-default::s1",
        {"type": "trace_step", "text": "Hermes planning", "phase": "planning", "step": 1},
    )
    bridge.publish(
        "hermes::hermes-default::s1",
        {"type": "unknown", "text": "ignored"},
    )

    s1 = bridge.drain("hermes::hermes-default::s1")
    s2 = bridge.drain("hermes::hermes-default::s2")

    assert [item["type"] for item in s1] == ["tool_start", "tool_result", "trace_step"]
    assert s1[1]["tool_id"] == "call-1"
    assert isinstance(s1[1]["result"], str)
    assert "truncated" in s1[1]["result"]
    assert s1[2]["phase"] == "planning"
    assert [item["tool_name"] for item in s2] == ["read"]


def test_hermes_events_endpoint_rejects_non_hermes_session_and_accepts_raw(monkeypatch):
    recorded: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        chat_routes.hermes_event_bridge,
        "publish",
        lambda session_key, event: recorded.append((session_key, event)) or True,
    )
    client = TestClient(app)

    bad = client.post(
        "/api/chat/hermes-events",
        json={"session_key": "openclaw::default::s1", "event_type": "tool_start", "tool_name": "exec"},
    )
    assert bad.status_code == 400

    ok = client.post(
        "/api/chat/hermes-events",
        json={"session_key": "raw-session", "event_type": "tool_start", "tool_name": "exec"},
    )
    assert ok.status_code == 200
    assert ok.json() == {"ok": True}
    assert recorded[0][0] == "hermes::hermes-default::raw-session"
    assert recorded[0][1]["type"] == "tool_start"


@pytest.mark.asyncio
async def test_send_message_stream_merges_hermes_bridge_and_dedupes_jsonl(monkeypatch):
    instance = RuntimeInstance(
        instance_id="hermes-default",
        platform="hermes",
        display_name="Hermes",
        capabilities=empty_capabilities(),
    )

    class _FakeHermesClient:
        def __init__(self):
            self.last_session_id = "sess-local"

        async def stream_chat(self, **_kwargs):
            chat_routes.hermes_event_bridge.publish(
                "hermes::hermes-default::sess-local",
                {
                    "type": "trace_start",
                    "text": "start",
                    "phase": "start",
                },
            )
            chat_routes.hermes_event_bridge.publish(
                "hermes::hermes-default::sess-local",
                {
                    "type": "tool_start",
                    "tool_name": "exec",
                    "tool_call_id": "call-1",
                    "args": {"command": "echo hi"},
                },
            )
            yield {"type": "delta", "text": "thinking"}
            chat_routes.hermes_event_bridge.publish(
                "hermes::hermes-default::sess-local",
                {
                    "type": "tool_result",
                    "tool_name": "exec",
                    "tool_call_id": "call-1",
                    "result": "ok",
                    "is_error": False,
                },
            )
            yield {"type": "final", "text": "done"}

    async def _fake_resolve_chat_runtime(*, session_key=None, instance_id=None):
        return instance, "sess-local", "hermes::hermes-default::sess-local"

    async def _fake_get_or_create_client(_instance, _session_key):
        return _FakeHermesClient()

    async def _fake_resolve_model_info(_session_key):
        return {}

    async def _fake_persist(*_args, **_kwargs):
        return None

    monkeypatch.setattr(chat_routes, "_resolve_chat_runtime", _fake_resolve_chat_runtime)
    monkeypatch.setattr(chat_routes, "_get_or_create_client", _fake_get_or_create_client)
    monkeypatch.setattr(chat_routes, "_resolve_hermes_session_model_info", _fake_resolve_model_info)
    monkeypatch.setattr(chat_routes, "_persist_hermes_chat_turn", _fake_persist)
    monkeypatch.setattr(chat_routes, "load_hermes_safety_system_prompt", lambda: "")
    monkeypatch.setattr(
        chat_routes,
        "_read_tool_calls_from_jsonl",
        lambda *_args, **_kwargs: [
            {"type": "tool_start", "tool_id": "call-1", "tool_name": "exec", "args": {"command": "echo hi"}},
            {"type": "tool_result", "tool_id": "call-1", "tool_name": "exec", "result": "ok", "is_error": False},
        ],
    )
    chat_routes.hermes_event_bridge.reset()
    client = TestClient(app)
    response = client.post(
        "/api/chat/send-message-stream",
        json={"session_key": "hermes::hermes-default::sess-local", "message": "run"},
    )
    assert response.status_code == 200
    events = [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ") and line != "data: [DONE]"
    ]
    tool_starts = [event for event in events if event.get("type") == "tool_start"]
    tool_results = [event for event in events if event.get("type") == "tool_result"]
    trace_starts = [event for event in events if event.get("type") == "trace_start"]
    assert len(tool_starts) == 1
    assert len(tool_results) == 1
    assert len(trace_starts) == 1
    assert tool_starts[0]["tool_id"] == "call-1"
    assert events[-1]["type"] == "final"
