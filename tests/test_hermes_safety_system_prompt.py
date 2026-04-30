"""Tests for the §57 Hermes safety system-prompt injection path.

Pins three things together so any regression on this surface fails loudly:

1. ``HermesClient.{stream,send}_chat`` puts ``role: "system"`` first when
   ``safety_system_prompt`` is non-empty, and keeps the legacy
   user-only body when it isn't (this is what guarantees OpenClaw and
   Nanobot — which never pass the kwarg — see no behaviour change).
2. ``services.hermes_safety_prompt.load_hermes_safety_system_prompt``
   returns an empty string when neither workspace nor templates have
   any SAFETY/PERMISSION text, so callers can no-op cleanly.
3. The Hermes guard plugin only registers ``pre_llm_call`` when the
   ``XSAFECLAW_HERMES_PRE_LLM_CONTEXT_FALLBACK`` env switch is on,
   keeping the §57 default off without UI changes.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import httpx
import pytest

from xsafeclaw.hermes_client import HermesClient
from xsafeclaw.services import hermes_safety_prompt


@pytest.fixture(autouse=True)
def _reset_safety_prompt_cache():
    """Drop the in-process cache before and after every test.

    The cache is keyed by file (mtime, size); tests that monkeypatch
    workspace contents would otherwise see stale results from earlier
    tests in the same process.
    """
    hermes_safety_prompt.reset_cache()
    yield
    hermes_safety_prompt.reset_cache()


def _build_mock_transport(captured: list[dict]) -> httpx.MockTransport:
    """Return a transport that records POST /v1/chat/completions bodies.

    Streaming-mode tests need a body that emits a single ``data: [DONE]``
    line so ``HermesClient.stream_chat`` exits cleanly without falling
    into the §49 empty-stream fallback (which would issue a *second*
    request and confuse the assertion).
    """

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        captured.append(body)
        if body.get("stream"):
            return httpx.Response(
                200,
                headers={"Content-Type": "text/event-stream"},
                content=b"data: [DONE]\n\n",
            )
        return httpx.Response(
            200,
            json={
                "id": "test",
                "choices": [
                    {
                        "message": {"content": "ok"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": None,
            },
        )

    return httpx.MockTransport(handler)


def _install_mock_client(client: HermesClient, transport: httpx.MockTransport) -> None:
    """Bypass ``connect()`` so we don't need a real Hermes server.

    ``HermesClient`` lazy-creates ``self._client`` inside ``connect()``;
    we substitute an httpx client backed by ``MockTransport`` directly.
    """
    client._client = httpx.AsyncClient(transport=transport, timeout=5.0)


@pytest.mark.asyncio
async def test_send_chat_prepends_system_message_when_prompt_provided():
    """Non-streaming path: system message is the very first entry."""
    captured: list[dict] = []
    client = HermesClient(base_url="http://test.invalid")
    _install_mock_client(client, _build_mock_transport(captured))
    try:
        await client.send_chat(
            session_key="sess-1",
            message="hello",
            safety_system_prompt="POLICY-XYZ",
        )
    finally:
        await client.disconnect()

    assert len(captured) == 1
    messages = captured[0]["messages"]
    assert messages[0] == {"role": "system", "content": "POLICY-XYZ"}
    assert messages[1] == {"role": "user", "content": "hello"}
    assert len(messages) == 2


@pytest.mark.asyncio
async def test_send_chat_omits_system_message_when_prompt_missing():
    """Default behaviour preserves the legacy body byte-for-byte.

    OpenClaw and Nanobot never pass ``safety_system_prompt`` (their
    branches in ``chat.py`` don't even reach this client), so this test
    pins that signature compatibility hasn't drifted.
    """
    captured: list[dict] = []
    client = HermesClient(base_url="http://test.invalid")
    _install_mock_client(client, _build_mock_transport(captured))
    try:
        await client.send_chat(session_key="sess-2", message="ping")
    finally:
        await client.disconnect()

    assert captured[0]["messages"] == [{"role": "user", "content": "ping"}]


@pytest.mark.asyncio
async def test_stream_chat_prepends_system_message_when_prompt_provided():
    """Streaming path: same contract as ``send_chat``."""
    captured: list[dict] = []
    client = HermesClient(base_url="http://test.invalid")
    _install_mock_client(client, _build_mock_transport(captured))
    try:
        async for _ in client.stream_chat(
            session_key="sess-3",
            message="stream hi",
            safety_system_prompt="STREAM-POLICY",
        ):
            pass
    finally:
        await client.disconnect()

    assert captured[0]["stream"] is True
    messages = captured[0]["messages"]
    assert messages[0] == {"role": "system", "content": "STREAM-POLICY"}
    assert messages[1] == {"role": "user", "content": "stream hi"}


def test_load_hermes_safety_system_prompt_returns_empty_when_no_files(monkeypatch, tmp_path):
    """When workspace AND templates are empty, callers must get ``""``.

    Returning ``""`` is the §57 contract that keeps the request body
    identical to the legacy shape — anything else would silently
    enable the new injection on environments that never deployed any
    SAFETY content (e.g. early-bring-up clusters).
    """
    # Point ``hermes_home`` at a guaranteed-empty workspace.
    fake_home = tmp_path / "hermes"
    (fake_home / "workspace").mkdir(parents=True)
    monkeypatch.setattr(
        hermes_safety_prompt.settings, "hermes_home", fake_home, raising=False
    )
    # Redirect the templates directory at an empty folder too. The
    # module captured ``_TEMPLATES_DIR`` at import time so we patch the
    # symbol the function actually reads.
    empty_templates = tmp_path / "templates_empty"
    empty_templates.mkdir()
    monkeypatch.setattr(hermes_safety_prompt, "_TEMPLATES_DIR", empty_templates)

    assert hermes_safety_prompt.load_hermes_safety_system_prompt() == ""
    assert hermes_safety_prompt.build_hermes_safety_block() == ""


def _load_hermes_guard_plugin():
    """Import ``plugins/safeclaw-guard-hermes/__init__.py`` standalone.

    The plugin lives outside the ``xsafeclaw`` Python package (it is
    intentionally copied into ``~/.hermes/plugins/`` at deploy time),
    so we can't ``import`` it through the normal mechanism.
    """
    plugin_dir = (
        Path(__file__).resolve().parent.parent
        / "plugins"
        / "safeclaw-guard-hermes"
    )
    init_path = plugin_dir / "__init__.py"
    spec = importlib.util.spec_from_file_location(
        "_xsafeclaw_test_hermes_guard_plugin", init_path
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


class _RecordingCtx:
    """Minimal stand-in for the Hermes plugin context object."""

    def __init__(self) -> None:
        self.hooks: list[str] = []

    def register_hook(self, name: str, _handler) -> None:
        self.hooks.append(name)


def test_hermes_plugin_default_register_skips_pre_llm_call(monkeypatch):
    """§57 default: ``pre_llm_call`` must NOT be registered.

    The env check lives inside ``register()`` (not at module import
    time), so we don't need to reload — just clear the var and call
    ``register`` against a fresh recording ctx.
    """
    monkeypatch.delenv("XSAFECLAW_HERMES_PRE_LLM_CONTEXT_FALLBACK", raising=False)
    plugin = _load_hermes_guard_plugin()

    ctx = _RecordingCtx()
    plugin.register(ctx)
    assert ctx.hooks == ["pre_tool_call"]


def test_hermes_plugin_env_switch_re_enables_pre_llm_call(monkeypatch):
    """Setting the env var to ``1`` brings back the §56b user-message hook."""
    monkeypatch.setenv("XSAFECLAW_HERMES_PRE_LLM_CONTEXT_FALLBACK", "1")
    plugin = _load_hermes_guard_plugin()

    ctx = _RecordingCtx()
    plugin.register(ctx)
    assert ctx.hooks == ["pre_tool_call", "pre_llm_call"]
