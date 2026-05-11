from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from websockets.connection import State

from xsafeclaw.api.main import app
from xsafeclaw.api.routes import chat as chat_routes
from xsafeclaw.nanobot_gateway_client import NanobotGatewayClient
from xsafeclaw.runtime.models import RuntimeInstance, empty_capabilities


class _FakeWebSocket:
    def __init__(self, frames):
        self.frames = list(frames)
        self.sent = []
        self.state = State.OPEN

    async def send(self, raw):
        self.sent.append(json.loads(raw))

    async def recv(self):
        if not self.frames:
            await asyncio.sleep(0)
            raise AssertionError("unexpected recv after test frames were exhausted")
        return self.frames.pop(0)


@pytest.mark.asyncio
async def test_nanobot_gateway_stream_chat_maps_progress_and_turn_end(monkeypatch):
    client = NanobotGatewayClient("ws://127.0.0.1:8765/")
    client.chat_id = "chat-5"
    client._ws = _FakeWebSocket(
        [
            json.dumps({"event": "message", "kind": "tool_hint", "text": "即将调用 read_file"}),
            json.dumps({"event": "message", "kind": "progress", "text": "正在读取文件"}),
            json.dumps({"event": "delta", "text": "Let me check."}),
            json.dumps({"event": "turn_end"}),
        ]
    )
    monkeypatch.setattr(client, "_drain_stale", lambda: asyncio.sleep(0))
    chunks = [chunk async for chunk in client.stream_chat("check file", timeout_s=1.0)]
    assert chunks == [
        {"type": "trace_step", "text": "即将调用 read_file", "phase": "tool_hint"},
        {"type": "trace_step", "text": "正在读取文件", "phase": "progress"},
        {"type": "delta", "text": "Let me check."},
        {"type": "final", "text": "Let me check.", "run_id": "chat-5", "stop_reason": "stop"},
    ]


@pytest.mark.asyncio
async def test_nanobot_gateway_stream_chat_plain_message_as_final(monkeypatch):
    client = NanobotGatewayClient("ws://127.0.0.1:8765/")
    client.chat_id = "chat-6"
    client._ws = _FakeWebSocket(
        [
            json.dumps({"event": "message", "text": "final answer"}),
        ]
    )
    monkeypatch.setattr(client, "_drain_stale", lambda: asyncio.sleep(0))
    chunks = [chunk async for chunk in client.stream_chat("go", timeout_s=1.0)]
    assert chunks == [
        {"type": "final", "text": "final answer", "run_id": "chat-6", "stop_reason": "stop"},
    ]


def test_send_message_stream_nanobot_merges_tailer_and_dedupes_jsonl(monkeypatch):
    instance = RuntimeInstance(
        instance_id="nanobot-default",
        platform="nanobot",
        display_name="Nanobot",
        capabilities=empty_capabilities(),
    )

    class _FakeNanobotClient:
        async def stream_chat(self, _message: str, timeout_s: float | None = None):
            _ = timeout_s
            yield {"type": "delta", "text": "checking"}
            yield {"type": "final", "text": "done", "run_id": "chat-1", "stop_reason": "stop"}

    class _FakeTailer:
        def __init__(self, _path: Path):
            self.calls = 0

        def poll(self, *, max_events: int = 32):
            _ = max_events
            self.calls += 1
            if self.calls == 1:
                return [
                    {
                        "type": "tool_start",
                        "tool_id": "call-1",
                        "tool_name": "read_file",
                        "args": {"path": "README.md"},
                    }
                ]
            if self.calls == 2:
                return [
                    {
                        "type": "tool_result",
                        "tool_id": "call-1",
                        "tool_name": "read_file",
                        "result": "ok",
                        "is_error": False,
                    }
                ]
            return []

    async def _fake_resolve_chat_runtime(*, session_key=None, instance_id=None):
        _ = session_key, instance_id
        return instance, "websocket:chat-1", "nanobot::nanobot-default::chat-1"

    async def _fake_get_nanobot_gateway_session(public_session_key, local_session_key, _instance):
        _ = public_session_key, local_session_key, _instance
        return _FakeNanobotClient(), "websocket:chat-1", "nanobot::nanobot-default::chat-1", False

    monkeypatch.setattr(chat_routes, "_resolve_chat_runtime", _fake_resolve_chat_runtime)
    monkeypatch.setattr(chat_routes, "_get_nanobot_gateway_session", _fake_get_nanobot_gateway_session)
    monkeypatch.setattr(chat_routes, "_find_nanobot_session_file", lambda *_args, **_kwargs: Path("dummy.jsonl"))
    monkeypatch.setattr(chat_routes, "NanobotJsonlTraceTailer", _FakeTailer)
    monkeypatch.setattr(
        chat_routes,
        "_read_nanobot_tool_calls_from_jsonl",
        lambda *_args, **_kwargs: [
            {
                "type": "tool_start",
                "tool_id": "call-1",
                "tool_name": "read_file",
                "args": {"path": "README.md"},
            },
            {
                "type": "tool_result",
                "tool_id": "call-1",
                "tool_name": "read_file",
                "result": "ok",
                "is_error": False,
            },
        ],
    )
    client = TestClient(app)
    response = client.post(
        "/api/chat/send-message-stream",
        json={"session_key": "nanobot::nanobot-default::chat-1", "message": "check"},
    )
    assert response.status_code == 200
    events = [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ") and line != "data: [DONE]"
    ]

    tool_starts = [evt for evt in events if evt.get("type") == "tool_start"]
    tool_results = [evt for evt in events if evt.get("type") == "tool_result"]
    assert len(tool_starts) == 1
    assert len(tool_results) == 1
    assert any(evt.get("type") == "delta" for evt in events)
    assert events[-1]["type"] == "final"
