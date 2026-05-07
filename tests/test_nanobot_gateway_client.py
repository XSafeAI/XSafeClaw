import json

import pytest
from websockets.connection import State

from xsafeclaw.nanobot_gateway_client import NanobotGatewayClient


class FakeWebSocket:
    def __init__(self, frames):
        self.frames = list(frames)
        self.sent = []
        self.state = State.OPEN

    async def send(self, raw):
        self.sent.append(json.loads(raw))

    async def recv(self):
        if not self.frames:
            raise AssertionError("unexpected recv after test frames were exhausted")
        return self.frames.pop(0)


@pytest.mark.asyncio
async def test_stream_chat_ignores_empty_nanobot_stream_boundaries():
    client = NanobotGatewayClient("ws://127.0.0.1:8765/")
    client.chat_id = "chat-1"
    client._ws = FakeWebSocket(
        [
            json.dumps({"event": "stream_end", "stream_id": "tool-boundary"}),
            json.dumps({"event": "delta", "text": "final reply"}),
            json.dumps({"event": "stream_end", "stream_id": "final"}),
        ]
    )

    chunks = [chunk async for chunk in client.stream_chat("look it up", timeout_s=1.0)]

    assert client._ws.sent == [{"content": "look it up"}]
    assert chunks == [
        {"type": "delta", "text": "final reply"},
        {
            "type": "final",
            "text": "final reply",
            "run_id": "chat-1",
            "stop_reason": "stop",
        },
    ]


@pytest.mark.asyncio
async def test_stream_chat_does_not_finalize_on_tool_boundary_with_partial_text():
    client = NanobotGatewayClient("ws://127.0.0.1:8765/")
    client.chat_id = "chat-2"
    client._ws = FakeWebSocket(
        [
            json.dumps({"event": "delta", "text": "是的，我是nanobot！"}),
            json.dumps({"event": "stream_end", "stream_id": "tool-boundary"}),
            json.dumps({"event": "delta", "text": "对于我使用的模型，我查一下配置文件。"}),
            json.dumps({"event": "stream_end", "stream_id": "final"}),
        ]
    )

    chunks = [chunk async for chunk in client.stream_chat("你是nanobot吗？", timeout_s=1.0)]

    assert client._ws.sent == [{"content": "你是nanobot吗？"}]
    assert chunks == [
        {"type": "delta", "text": "是的，我是nanobot！"},
        {"type": "delta", "text": "是的，我是nanobot！对于我使用的模型，我查一下配置文件。"},
        {
            "type": "final",
            "text": "是的，我是nanobot！对于我使用的模型，我查一下配置文件。",
            "run_id": "chat-2",
            "stop_reason": "stop",
        },
    ]


@pytest.mark.asyncio
async def test_stream_chat_uses_content_fallback_for_message_event():
    client = NanobotGatewayClient("ws://127.0.0.1:8765/")
    client.chat_id = "chat-3"
    client._ws = FakeWebSocket(
        [
            json.dumps({"event": "message", "content": "fallback message"}),
        ]
    )

    chunks = [chunk async for chunk in client.stream_chat("hello", timeout_s=1.0)]

    assert chunks == [
        {
            "type": "final",
            "text": "fallback message",
            "run_id": "chat-3",
            "stop_reason": "stop",
        },
    ]


@pytest.mark.asyncio
async def test_stream_chat_ignores_empty_message_then_continues_stream():
    client = NanobotGatewayClient("ws://127.0.0.1:8765/")
    client.chat_id = "chat-4"
    client._ws = FakeWebSocket(
        [
            json.dumps({"event": "message", "text": ""}),
            json.dumps({"event": "delta", "text": "continued"}),
            json.dumps({"event": "stream_end", "stream_id": "final"}),
        ]
    )

    chunks = [chunk async for chunk in client.stream_chat("hello", timeout_s=1.0)]

    assert chunks == [
        {"type": "delta", "text": "continued"},
        {
            "type": "final",
            "text": "continued",
            "run_id": "chat-4",
            "stop_reason": "stop",
        },
    ]
