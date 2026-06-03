from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from xsafeclaw.api.main import app
from xsafeclaw.api.routes import chat as chat_routes
from xsafeclaw.runtime.models import RuntimeInstance, empty_capabilities


def _sse_events(response) -> list[dict]:
    return [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ") and line != "data: [DONE]"
    ]


def test_runtime_guard_markdown_instruction_can_be_stripped_from_history_text():
    message = chat_routes._runtime_guard_markdown_user_message("inspect README", enabled=True)
    assert "GitHub Flavored Markdown" in message
    assert chat_routes._strip_runtime_guard_markdown_instruction(message) == "inspect README"
    assert chat_routes._runtime_guard_markdown_user_message("plain", enabled=False) == "plain"


def test_runtime_guard_openclaw_stream_adds_markdown_instruction(monkeypatch):
    instance = RuntimeInstance(
        instance_id="openclaw-default",
        platform="openclaw",
        display_name="OpenClaw",
        capabilities=empty_capabilities(),
    )
    captured: dict = {}

    class _FakeOpenClawClient:
        async def stream_chat(self, **kwargs):
            captured.update(kwargs)
            yield {"type": "final", "text": "done", "stop_reason": "stop"}

    async def _fake_resolve_chat_runtime(*, session_key=None, instance_id=None):
        _ = session_key, instance_id
        return instance, "chat-1", "openclaw::openclaw-default::chat-1"

    async def _fake_get_or_create_client(_instance, _session_key):
        return _FakeOpenClawClient()

    monkeypatch.setattr(chat_routes, "_resolve_chat_runtime", _fake_resolve_chat_runtime)
    monkeypatch.setattr(chat_routes, "_get_or_create_client", _fake_get_or_create_client)
    monkeypatch.setattr(chat_routes, "_read_tool_calls_from_jsonl", lambda *_args, **_kwargs: [])

    response = TestClient(app).post(
        "/api/chat/send-message-stream",
        json={
            "session_key": "openclaw::openclaw-default::chat-1",
            "message": "inspect README",
            "client_context": "runtime_guard",
        },
    )

    assert response.status_code == 200
    assert "GitHub Flavored Markdown" in captured["message"]
    assert captured["message"].endswith("inspect README")
    assert _sse_events(response)[-1] == {"type": "final", "text": "done", "stop_reason": "stop"}


def test_runtime_guard_hermes_stream_uses_system_prompt_not_user_prefix(monkeypatch):
    instance = RuntimeInstance(
        instance_id="hermes-default",
        platform="hermes",
        display_name="Hermes",
        capabilities=empty_capabilities(),
    )
    captured: dict = {}

    class _FakeHermesClient:
        last_session_id = "sess-local"

        async def stream_chat(self, **kwargs):
            captured.update(kwargs)
            yield {"type": "final", "text": "done", "stop_reason": "stop"}

    async def _fake_resolve_chat_runtime(*, session_key=None, instance_id=None):
        _ = session_key, instance_id
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
    monkeypatch.setattr(chat_routes, "load_hermes_safety_system_prompt", lambda: "SAFETY")
    monkeypatch.setattr(chat_routes, "_read_tool_calls_from_jsonl", lambda *_args, **_kwargs: [])

    response = TestClient(app).post(
        "/api/chat/send-message-stream",
        json={
            "session_key": "hermes::hermes-default::sess-local",
            "message": "summarize status",
            "client_context": "runtime_guard",
        },
    )

    assert response.status_code == 200
    assert captured["message"] == "summarize status"
    assert "SAFETY" in captured["safety_system_prompt"]
    assert "GitHub Flavored Markdown" in captured["safety_system_prompt"]
    assert _sse_events(response)[-1]["type"] == "final"


def test_runtime_guard_nanobot_stream_adds_markdown_instruction(monkeypatch):
    instance = RuntimeInstance(
        instance_id="nanobot-default",
        platform="nanobot",
        display_name="Nanobot",
        capabilities=empty_capabilities(),
    )
    captured: dict = {}

    class _FakeNanobotClient:
        async def stream_chat(self, message: str, timeout_s: float | None = None):
            _ = timeout_s
            captured["message"] = message
            yield {"type": "final", "text": "done", "run_id": "chat-1", "stop_reason": "stop"}

    async def _fake_resolve_chat_runtime(*, session_key=None, instance_id=None):
        _ = session_key, instance_id
        return instance, "websocket:chat-1", "nanobot::nanobot-default::chat-1"

    async def _fake_get_nanobot_gateway_session(public_session_key, local_session_key, _instance):
        _ = public_session_key, local_session_key, _instance
        return _FakeNanobotClient(), "websocket:chat-1", "nanobot::nanobot-default::chat-1", False

    monkeypatch.setattr(chat_routes, "_resolve_chat_runtime", _fake_resolve_chat_runtime)
    monkeypatch.setattr(chat_routes, "_get_nanobot_gateway_session", _fake_get_nanobot_gateway_session)
    monkeypatch.setattr(chat_routes, "_find_nanobot_session_file", lambda *_args, **_kwargs: Path("missing.jsonl"))
    monkeypatch.setattr(chat_routes, "_read_nanobot_tool_calls_from_jsonl", lambda *_args, **_kwargs: [])

    response = TestClient(app).post(
        "/api/chat/send-message-stream",
        json={
            "session_key": "nanobot::nanobot-default::chat-1",
            "message": "inspect README",
            "client_context": "runtime_guard",
        },
    )

    assert response.status_code == 200
    assert "GitHub Flavored Markdown" in captured["message"]
    assert captured["message"].endswith("inspect README")
    assert _sse_events(response)[-1]["type"] == "final"
