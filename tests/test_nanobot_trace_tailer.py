from __future__ import annotations

import json
from pathlib import Path

from xsafeclaw.api.routes import chat as chat_routes
from xsafeclaw.runtime.models import RuntimeInstance, empty_capabilities
from xsafeclaw.services.nanobot_trace_tailer import NanobotJsonlTraceTailer


def _write_lines(path: Path, lines: list[dict]) -> None:
    path.write_text("\n".join(json.dumps(line, ensure_ascii=False) for line in lines) + "\n", encoding="utf-8")


def test_nanobot_trace_tailer_emits_incremental_start_and_result(tmp_path: Path):
    session_file = tmp_path / "ws_chat.jsonl"
    tailer = NanobotJsonlTraceTailer(session_file)

    _write_lines(
        session_file,
        [
            {"_type": "metadata", "key": "websocket:chat-1"},
            {"role": "user", "content": "search"},
            {
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": "call-1",
                        "function": {
                            "name": "read_file",
                            "arguments": "{\"path\":\"README.md\"}",
                        },
                    }
                ],
            },
        ],
    )
    first = tailer.poll()
    assert first == [
        {
            "type": "tool_start",
            "tool_id": "call-1",
            "tool_name": "read_file",
            "args": {"path": "README.md"},
            "tool_category": "file_system",
            "tool_action": "read",
            "timeline_kind": "tool_file_read",
            "risk_level": "low",
        }
    ]

    _write_lines(
        session_file,
        [
            {"_type": "metadata", "key": "websocket:chat-1"},
            {"role": "user", "content": "search"},
            {
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": "call-1",
                        "function": {
                            "name": "read_file",
                            "arguments": "{\"path\":\"README.md\"}",
                        },
                    }
                ],
            },
            {"role": "tool", "tool_call_id": "call-1", "content": "ok"},
        ],
    )
    second = tailer.poll()
    assert second == [
        {
            "type": "tool_result",
            "tool_id": "call-1",
            "tool_name": "read_file",
            "result": "ok",
            "is_error": False,
            "tool_category": "file_system",
            "tool_action": "read",
            "timeline_kind": "tool_file_read",
            "risk_level": "low",
        }
    ]
    assert tailer.poll() == []


def test_nanobot_trace_tailer_skips_partial_bad_json(tmp_path: Path):
    session_file = tmp_path / "ws_chat.jsonl"
    tailer = NanobotJsonlTraceTailer(session_file)

    session_file.write_text(
        "\n".join(
            [
                json.dumps({"_type": "metadata", "key": "websocket:chat-1"}, ensure_ascii=False),
                json.dumps({"role": "user", "content": "go"}, ensure_ascii=False),
                json.dumps(
                    {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "id": "call-2",
                                "function": {"name": "ls", "arguments": "{}"},
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                '{"role":"tool","tool_call_id":"call-2","content":"ok"',  # half-written JSONL line
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    assert tailer.poll() == [
        {
            "type": "tool_start",
            "tool_id": "call-2",
            "tool_name": "ls",
            "args": {},
            "tool_category": "shell",
            "tool_action": "execute",
            "timeline_kind": "tool_shell",
            "risk_level": "medium",
        }
    ]


def test_nanobot_trace_tailer_matches_history_fallback_parser(tmp_path: Path):
    session_file = tmp_path / "websocket_chat-7.jsonl"
    _write_lines(
        session_file,
        [
            {"_type": "metadata", "key": "websocket:chat-7"},
            {"role": "user", "content": "query"},
            {
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": "call-a",
                        "function": {
                            "name": "search_web",
                            "arguments": "{\"q\":\"nanobot\"}",
                        },
                    }
                ],
            },
            {"role": "tool", "tool_call_id": "call-a", "content": "done"},
        ],
    )

    tailer = NanobotJsonlTraceTailer(session_file)
    first = tailer.poll()
    second = tailer.poll()
    realtime_events = [*first, *second]

    instance = RuntimeInstance(
        instance_id="nanobot-default",
        platform="nanobot",
        display_name="Nanobot",
        capabilities=empty_capabilities(),
        sessions_path=str(tmp_path),
    )
    fallback_events = chat_routes._read_nanobot_tool_calls_from_jsonl(instance, "chat-7")
    assert realtime_events == fallback_events
    history_messages = chat_routes._read_nanobot_history_from_jsonl(instance, "chat-7")
    tool_messages = [message for message in history_messages if message.get("role") == "tool_call"]
    assert tool_messages[0]["tool_category"] == "network"
    assert tool_messages[0]["tool_action"] == "request"
    assert tool_messages[0]["timeline_kind"] == "tool_network"
