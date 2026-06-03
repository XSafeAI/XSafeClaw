from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastapi.testclient import TestClient

from xsafeclaw.api.main import app
from xsafeclaw.api.routes import chat as chat_routes
from xsafeclaw.runtime.models import RuntimeInstance, empty_capabilities
from xsafeclaw.services.openclaw_trace_tailer import OpenClawJsonlTraceTailer


def _write_lines(path: Path, lines: list[dict]) -> None:
    path.write_text("\n".join(json.dumps(line, ensure_ascii=False) for line in lines) + "\n", encoding="utf-8")


def _write_openclaw_session_index(
    sessions_dir: Path,
    *,
    session_key: str = "chat-1",
    session_id: str = "session-abc",
    wrapped_key: bool = False,
) -> Path:
    sessions_dir.mkdir(parents=True, exist_ok=True)
    key = f"agent:main:{session_key}" if wrapped_key else session_key
    (sessions_dir / "sessions.json").write_text(
        json.dumps({key: {"sessionId": session_id}}, ensure_ascii=False),
        encoding="utf-8",
    )
    return sessions_dir / f"{session_id}.jsonl"


def test_openclaw_trace_tailer_emits_incremental_start_and_result(tmp_path: Path):
    session_file = _write_openclaw_session_index(tmp_path)
    tailer = OpenClawJsonlTraceTailer(
        sessions_json=tmp_path / "sessions.json",
        sessions_dir=tmp_path,
        session_key="chat-1",
    )

    _write_lines(
        session_file,
        [
            {"type": "message", "message": {"role": "user", "content": "read file"}},
            {
                "type": "message",
                "message": {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "I'll inspect it."},
                        {
                            "type": "toolCall",
                            "id": "call-1",
                            "name": "read_file",
                            "input": {"path": "README.md"},
                        },
                    ],
                },
            },
        ],
    )
    assert tailer.poll() == [
        {
            "type": "tool_start",
            "tool_id": "call-1",
            "tool_name": "read_file",
            "args": {"path": "README.md"},
        }
    ]

    _write_lines(
        session_file,
        [
            {"type": "message", "message": {"role": "user", "content": "read file"}},
            {
                "type": "message",
                "message": {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "toolCall",
                            "id": "call-1",
                            "name": "read_file",
                            "input": {"path": "README.md"},
                        },
                    ],
                },
            },
            {
                "type": "message",
                "message": {
                    "role": "toolResult",
                    "toolCallId": "call-1",
                    "content": [{"type": "text", "text": "ok"}],
                },
            },
        ],
    )
    assert tailer.poll() == [
        {
            "type": "tool_result",
            "tool_id": "call-1",
            "tool_name": "read_file",
            "result": "ok",
            "is_error": False,
        }
    ]
    assert tailer.poll() == []


def test_openclaw_trace_tailer_resolves_agent_main_key_and_skips_bad_lines(tmp_path: Path):
    session_file = _write_openclaw_session_index(tmp_path, wrapped_key=True)
    tailer = OpenClawJsonlTraceTailer(
        sessions_json=tmp_path / "sessions.json",
        sessions_dir=tmp_path,
        session_key="chat-1",
    )

    session_file.write_text(
        "\n".join(
            [
                json.dumps({"type": "message", "message": {"role": "user", "content": "run"}}, ensure_ascii=False),
                json.dumps(
                    {
                        "type": "message",
                        "message": {
                            "role": "assistant",
                            "content": [
                                {
                                    "type": "toolCall",
                                    "id": "call-2",
                                    "name": "shell",
                                    "arguments": "{\"cmd\":\"pwd\"}",
                                }
                            ],
                        },
                    },
                    ensure_ascii=False,
                ),
                '{"type":"message","message":{"role":"toolResult"',  # half-written JSONL line
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    assert tailer.poll() == [
        {
            "type": "tool_start",
            "tool_id": "call-2",
            "tool_name": "shell",
            "args": {"cmd": "pwd"},
        }
    ]


def test_openclaw_trace_tailer_maps_explicit_reasoning_only(tmp_path: Path):
    session_file = _write_openclaw_session_index(tmp_path)
    tailer = OpenClawJsonlTraceTailer(
        sessions_json=tmp_path / "sessions.json",
        sessions_dir=tmp_path,
        session_key="chat-1",
    )

    _write_lines(
        session_file,
        [
            {"type": "message", "message": {"role": "user", "content": "plan"}},
            {
                "type": "message",
                "message": {
                    "role": "assistant",
                    "reasoning_summary": "I will inspect the project first.",
                    "content": [
                        {"type": "thinking", "text": "Checking relevant files."},
                    ],
                },
            },
        ],
    )

    assert tailer.poll() == [
        {
            "type": "reasoning_summary",
            "text": "I will inspect the project first.",
            "phase": "reasoning_summary",
        },
        {
            "type": "trace_step",
            "text": "Checking relevant files.",
            "phase": "thinking",
        },
    ]
    assert tailer.poll() == []


def test_openclaw_trace_tailer_matches_history_fallback_parser(tmp_path: Path):
    session_file = _write_openclaw_session_index(tmp_path, session_key="chat-7", session_id="session-7")
    _write_lines(
        session_file,
        [
            {"type": "message", "message": {"role": "user", "content": "query"}},
            {
                "type": "message",
                "message": {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "toolCall",
                            "id": "call-a",
                            "name": "search_web",
                            "input": {"q": "openclaw"},
                        },
                    ],
                },
            },
            {
                "type": "message",
                "message": {
                    "role": "toolResult",
                    "toolCallId": "call-a",
                    "content": "done",
                },
            },
        ],
    )

    tailer = OpenClawJsonlTraceTailer(
        sessions_json=tmp_path / "sessions.json",
        sessions_dir=tmp_path,
        session_key="chat-7",
    )
    realtime_events = [*tailer.poll(), *tailer.poll()]

    instance = RuntimeInstance(
        instance_id="openclaw-default",
        platform="openclaw",
        display_name="OpenClaw",
        capabilities=empty_capabilities(),
        sessions_path=str(tmp_path),
    )
    fallback_events = chat_routes._read_tool_calls_from_jsonl(instance, "chat-7")
    assert realtime_events == fallback_events


def test_send_message_stream_openclaw_emits_tool_events_before_final(monkeypatch, tmp_path: Path):
    session_file = _write_openclaw_session_index(tmp_path, session_key="chat-1", session_id="session-1")
    instance = RuntimeInstance(
        instance_id="openclaw-default",
        platform="openclaw",
        display_name="OpenClaw",
        capabilities=empty_capabilities(),
        sessions_path=str(tmp_path),
    )

    class _FakeOpenClawClient:
        async def stream_chat(self, **_kwargs):
            _write_lines(
                session_file,
                [
                    {"type": "message", "message": {"role": "user", "content": "inspect"}},
                    {
                        "type": "message",
                        "message": {
                            "role": "assistant",
                            "content": [
                                {
                                    "type": "toolCall",
                                    "id": "call-1",
                                    "name": "read_file",
                                    "input": {"path": "README.md"},
                                },
                            ],
                        },
                    },
                ],
            )
            await asyncio.sleep(0)
            yield {"type": "delta", "text": "checking"}
            _write_lines(
                session_file,
                [
                    {"type": "message", "message": {"role": "user", "content": "inspect"}},
                    {
                        "type": "message",
                        "message": {
                            "role": "assistant",
                            "content": [
                                {
                                    "type": "toolCall",
                                    "id": "call-1",
                                    "name": "read_file",
                                    "input": {"path": "README.md"},
                                },
                            ],
                        },
                    },
                    {
                        "type": "message",
                        "message": {
                            "role": "toolResult",
                            "toolCallId": "call-1",
                            "content": "ok",
                        },
                    },
                ],
            )
            await asyncio.sleep(0)
            yield {"type": "final", "text": "done", "run_id": "chat-1", "stop_reason": "stop"}

    async def _fake_resolve_chat_runtime(*, session_key=None, instance_id=None):
        _ = session_key, instance_id
        return instance, "chat-1", "openclaw::openclaw-default::chat-1"

    async def _fake_get_or_create_client(_instance, _session_key):
        return _FakeOpenClawClient()

    monkeypatch.setattr(chat_routes, "_resolve_chat_runtime", _fake_resolve_chat_runtime)
    monkeypatch.setattr(chat_routes, "_get_or_create_client", _fake_get_or_create_client)

    client = TestClient(app)
    response = client.post(
        "/api/chat/send-message-stream",
        json={"session_key": "openclaw::openclaw-default::chat-1", "message": "inspect"},
    )
    assert response.status_code == 200
    events = [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ") and line != "data: [DONE]"
    ]
    event_types = [event.get("type") for event in events]
    assert event_types.count("tool_start") == 1
    assert event_types.count("tool_result") == 1
    assert event_types.index("tool_start") < event_types.index("final")
    assert event_types.index("tool_result") < event_types.index("final")
    assert events[-1]["type"] == "final"
