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
