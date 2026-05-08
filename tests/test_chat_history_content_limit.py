from __future__ import annotations

from xsafeclaw.api.routes.chat import _apply_history_content_limit


def test_history_content_limit_is_opt_in() -> None:
    messages = [
        {"role": "assistant", "content": "x" * 600},
        {"role": "tool_call", "args": {"a": "b"}, "result": "ok"},
    ]

    assert _apply_history_content_limit(messages, max_content_chars=None) == messages
    assert _apply_history_content_limit(messages, max_content_chars=0) == messages


def test_history_content_limit_truncates_text_and_tool_payloads() -> None:
    messages = [
        {"role": "assistant", "content": "A" * 600},
        {"role": "tool_call", "args": {"payload": "B" * 600}, "result": "C" * 600, "content": "D" * 600},
    ]

    limited = _apply_history_content_limit(messages, max_content_chars=200)

    assert len(limited) == 2
    assert limited[0]["content"].endswith("[truncated, showing 200 chars]")
    assert isinstance(limited[1]["args"], str)
    assert isinstance(limited[1]["result"], str)
    assert isinstance(limited[1]["content"], str)
    assert limited[1]["args"].endswith("[truncated, showing 200 chars]")
    assert limited[1]["result"].endswith("[truncated, showing 200 chars]")
