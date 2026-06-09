from __future__ import annotations

import re

import pytest
from fastapi import HTTPException

from xsafeclaw.api.routes import chat as chat_routes
from xsafeclaw.runtime.models import RuntimeInstance, empty_capabilities


def _runtime(platform: str) -> RuntimeInstance:
    caps = empty_capabilities()
    caps["chat"] = True
    return RuntimeInstance(
        instance_id=f"{platform}-default",
        platform=platform,  # type: ignore[arg-type]
        display_name={"openclaw": "OpenClaw", "hermes": "Hermes", "nanobot": "Nanobot"}[platform],
        capabilities=caps,
        health_status="healthy",
    )


async def _fake_resolve(instance: RuntimeInstance):
    async def inner(session_key=None, instance_id=None):
        _ = session_key, instance_id
        return (
            instance,
            "chat-123",
            f"{instance.platform}::{instance.instance_id}::chat-123",
        )

    return inner


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("platform", "expected_prefix"),
    [("openclaw", "OpenClaw"), ("hermes", "Hermes")],
)
async def test_start_session_server_timestamp_label_patches_openclaw_and_hermes(
    monkeypatch,
    platform,
    expected_prefix,
):
    instance = _runtime(platform)
    captured: dict[str, object] = {}

    class FakeClient:
        async def patch_session(self, session_key, **kwargs):
            captured["session_key"] = session_key
            captured.update(kwargs)

    async def fake_get_or_create_client(instance_arg, session_key):
        assert instance_arg == instance
        assert session_key == f"{platform}::{platform}-default::chat-123"
        return FakeClient()

    async def fake_persist_hermes_session(*_args, **_kwargs):
        return None

    monkeypatch.setattr(chat_routes, "_resolve_chat_runtime", await _fake_resolve(instance))
    monkeypatch.setattr(chat_routes, "_get_or_create_client", fake_get_or_create_client)
    monkeypatch.setattr(chat_routes, "_persist_hermes_session", fake_persist_hermes_session)
    monkeypatch.setattr(chat_routes, "serialize_instance", lambda item: {"instance_id": item.instance_id})

    response = await chat_routes.start_session(
        chat_routes.StartSessionRequest(label_mode="server_timestamp")
    )

    assert response.session_key == f"{platform}::{platform}-default::chat-123"
    assert captured["session_key"] == "chat-123"
    assert re.fullmatch(
        rf"{expected_prefix} \d{{2}}:\d{{2}}:\d{{2}}:\d{{2}}:\d{{2}}:\d{{2}}",
        str(captured["label"]),
    )
    assert captured["verbose_level"] == "on"


@pytest.mark.asyncio
async def test_start_session_server_timestamp_label_ignores_nanobot(monkeypatch):
    instance = _runtime("nanobot")

    class FakeNanobotClient:
        chat_id = "nanobot-chat"

    async def fake_connect_nanobot_gateway(instance_arg):
        assert instance_arg == instance
        return FakeNanobotClient()

    async def fail_get_or_create_client(*_args, **_kwargs):
        raise AssertionError("nanobot must not patch runtime labels")

    monkeypatch.setattr(chat_routes, "_resolve_chat_runtime", await _fake_resolve(instance))
    monkeypatch.setattr(chat_routes, "_connect_nanobot_gateway", fake_connect_nanobot_gateway)
    monkeypatch.setattr(chat_routes, "_get_or_create_client", fail_get_or_create_client)
    monkeypatch.setattr(chat_routes, "serialize_instance", lambda item: {"instance_id": item.instance_id})

    response = await chat_routes.start_session(
        chat_routes.StartSessionRequest(label_mode="server_timestamp")
    )

    assert response.session_key == "nanobot::nanobot-default::websocket:nanobot-chat"
    assert response.platform == "nanobot"


@pytest.mark.asyncio
async def test_start_session_metadata_error_message_is_not_model_specific(monkeypatch):
    instance = _runtime("openclaw")

    class FakeClient:
        async def patch_session(self, *_args, **_kwargs):
            raise RuntimeError("label already in use: OpenClaw")

    async def fake_get_or_create_client(*_args, **_kwargs):
        return FakeClient()

    monkeypatch.setattr(chat_routes, "_resolve_chat_runtime", await _fake_resolve(instance))
    monkeypatch.setattr(chat_routes, "_get_or_create_client", fake_get_or_create_client)

    with pytest.raises(HTTPException) as exc_info:
        await chat_routes.start_session(
            chat_routes.StartSessionRequest(label_mode="server_timestamp")
        )

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == (
        "Failed to initialize session metadata: label already in use: OpenClaw"
    )
