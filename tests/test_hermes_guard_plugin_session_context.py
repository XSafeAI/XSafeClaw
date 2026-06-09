from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_plugin_module():
    plugin_path = (
        Path(__file__).resolve().parents[1]
        / "plugins"
        / "safeclaw-guard-hermes"
        / "__init__.py"
    )
    spec = importlib.util.spec_from_file_location(
        "safeclaw_guard_hermes_test_module",
        plugin_path,
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_pre_tool_call_recovers_real_session_id_from_previous_llm_hook():
    plugin = _load_plugin_module()
    plugin._SESSION_ID_BY_TASK_ID.clear()
    plugin._RECENT_SESSION_IDS.clear()

    plugin._remember_session_context("chat-real-session", "turn-task")

    assert plugin._resolve_session_context("", "turn-task") == "chat-real-session"
    assert plugin._encode_session_key(
        session_id=plugin._resolve_session_context("", "turn-task"),
        task_id="turn-task",
    ) == (
        "chat-real-session",
        "hermes::hermes-default::chat-real-session",
    )


def test_pre_tool_call_falls_back_to_task_id_when_session_is_unknown():
    plugin = _load_plugin_module()
    plugin._SESSION_ID_BY_TASK_ID.clear()
    plugin._RECENT_SESSION_IDS.clear()

    assert plugin._resolve_session_context("", "standalone-task") == "standalone-task"
