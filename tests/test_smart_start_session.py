from __future__ import annotations

import json

import pytest
from fastapi import HTTPException

from xsafeclaw.api.routes import chat as chat_routes
from xsafeclaw.runtime.models import RuntimeInstance, empty_capabilities


def _runtime(
    platform: str,
    *,
    enabled: bool = True,
    is_default: bool = True,
    health_status: str = "healthy",
) -> RuntimeInstance:
    caps = empty_capabilities()
    caps["chat"] = True
    return RuntimeInstance(
        instance_id=f"{platform}-default",
        platform=platform,  # type: ignore[arg-type]
        display_name={
            "openclaw": "OpenClaw",
            "hermes": "Hermes",
            "nanobot": "Nanobot",
        }[platform],
        enabled=enabled,
        is_default=is_default,
        capabilities=caps,
        health_status=health_status,  # type: ignore[arg-type]
    )


def _response(instance: RuntimeInstance) -> chat_routes.StartSessionResponse:
    return chat_routes.StartSessionResponse(
        session_key=f"{instance.platform}::{instance.instance_id}::chat-1",
        status="connected",
        instance_id=instance.instance_id,
        platform=instance.platform,
        instance={"instance_id": instance.instance_id, "platform": instance.platform},
    )


@pytest.mark.asyncio
async def test_smart_start_with_no_available_agents_fails_without_creating(monkeypatch):
    async def fake_list_instances():
        return []

    monkeypatch.setattr(chat_routes, "list_instances", fake_list_instances)

    async def fail_create(*_args, **_kwargs):
        raise AssertionError("smart routing must not create a session")

    monkeypatch.setattr(chat_routes, "_create_chat_session", fail_create)

    with pytest.raises(HTTPException) as exc_info:
        await chat_routes.smart_start_session(
            chat_routes.SmartStartSessionRequest(message="scan the repo")
        )

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["reason"] == "smart_routing_failed"


@pytest.mark.asyncio
async def test_smart_start_single_available_agent_skips_router_model(monkeypatch):
    instance = _runtime("nanobot")
    captured: dict[str, object] = {}

    async def fake_list_instances():
        return [instance]

    async def fake_budget_allows(platform: str):
        captured["budget_platform"] = platform
        return True

    async def fail_router(*_args, **_kwargs):
        raise AssertionError("single available agent must not call router model")

    async def fake_create(request):
        captured["request"] = request
        return _response(instance)

    monkeypatch.setattr(chat_routes, "list_instances", fake_list_instances)
    monkeypatch.setattr(chat_routes, "_smart_runtime_budget_allows", fake_budget_allows)
    monkeypatch.setattr(chat_routes, "call_runtime_model_prompt", fail_router)
    monkeypatch.setattr(chat_routes, "_create_chat_session", fake_create)

    response = await chat_routes.smart_start_session(
        chat_routes.SmartStartSessionRequest(message="use the browser safely")
    )

    request = captured["request"]
    assert isinstance(request, chat_routes.StartSessionRequest)
    assert request.instance_id == "nanobot-default"
    assert request.label_mode is None
    assert captured["budget_platform"] == "nanobot"
    assert response.selected_agent == "Nanobot"
    assert response.platform == "nanobot"
    assert response.router_source is None


@pytest.mark.asyncio
async def test_smart_start_routes_multiple_agents_with_openclaw_source(monkeypatch):
    openclaw = _runtime("openclaw")
    hermes = _runtime("hermes")
    captured: dict[str, object] = {}

    async def fake_list_instances():
        return [openclaw, hermes]

    async def fake_budget_allows(_platform: str):
        return True

    async def fake_router(
        prompt: str,
        *,
        platform: str,
        instance_id: str,
        max_tokens: int,
        system_prompt: str | None = None,
    ):
        captured["prompt"] = prompt
        captured["router_platform"] = platform
        captured["router_instance_id"] = instance_id
        captured["router_max_tokens"] = max_tokens
        captured["router_system_prompt"] = system_prompt
        return json.dumps({"agent": "Hermes"})

    async def fake_create(request):
        captured["request"] = request
        return _response(hermes)

    monkeypatch.setattr(chat_routes, "list_instances", fake_list_instances)
    monkeypatch.setattr(chat_routes, "_smart_runtime_budget_allows", fake_budget_allows)
    monkeypatch.setattr(chat_routes, "call_runtime_model_prompt", fake_router)
    monkeypatch.setattr(chat_routes, "_create_chat_session", fake_create)

    response = await chat_routes.smart_start_session(
        chat_routes.SmartStartSessionRequest(message="review this codebase")
    )

    request = captured["request"]
    assert isinstance(request, chat_routes.StartSessionRequest)
    assert captured["router_platform"] == "openclaw"
    assert captured["router_instance_id"] == "openclaw-default"
    assert "silent Agent router" in str(captured["router_system_prompt"])
    assert "Do not return JSON" in str(captured["router_system_prompt"])
    assert "Do not return JSON" not in str(captured["prompt"])
    assert "OpenClaw" in str(captured["prompt"])
    assert "Hermes" in str(captured["prompt"])
    assert request.instance_id == "hermes-default"
    assert request.label_mode == "server_timestamp"
    assert response.selected_agent == "Hermes"
    assert response.router_source == "openclaw"


@pytest.mark.asyncio
async def test_smart_start_accepts_candidate_id_output(monkeypatch):
    openclaw = _runtime("openclaw")
    hermes = _runtime("hermes")
    nanobot = _runtime("nanobot")
    captured: dict[str, object] = {}

    async def fake_list_instances():
        return [openclaw, hermes, nanobot]

    async def fake_budget_allows(_platform: str):
        return True

    async def fake_router(
        prompt: str,
        *,
        platform: str,
        instance_id: str,
        max_tokens: int,
        system_prompt: str | None = None,
    ):
        captured["prompt"] = prompt
        captured["router_system_prompt"] = system_prompt
        return "B"

    async def fake_create(request):
        captured["request"] = request
        return _response(hermes)

    monkeypatch.setattr(chat_routes, "list_instances", fake_list_instances)
    monkeypatch.setattr(chat_routes, "_smart_runtime_budget_allows", fake_budget_allows)
    monkeypatch.setattr(chat_routes, "call_runtime_model_prompt", fake_router)
    monkeypatch.setattr(chat_routes, "_create_chat_session", fake_create)

    response = await chat_routes.smart_start_session(
        chat_routes.SmartStartSessionRequest(message="review this codebase")
    )

    request = captured["request"]
    assert isinstance(request, chat_routes.StartSessionRequest)
    assert '"id": "A"' in str(captured["prompt"])
    assert '"id": "B"' in str(captured["prompt"])
    assert "Return only one uppercase candidate id" in str(captured["router_system_prompt"])
    assert request.instance_id == "hermes-default"
    assert response.selected_agent == "Hermes"
    assert response.router_source == "openclaw"


@pytest.mark.asyncio
async def test_smart_start_uses_hermes_source_when_openclaw_router_fails(monkeypatch):
    openclaw = _runtime("openclaw")
    hermes = _runtime("hermes")
    calls: list[str] = []

    async def fake_list_instances():
        return [openclaw, hermes]

    async def fake_budget_allows(_platform: str):
        return True

    async def fake_router(
        _prompt: str,
        *,
        platform: str,
        instance_id: str,
        max_tokens: int,
        system_prompt: str | None = None,
    ):
        _ = instance_id, max_tokens, system_prompt
        calls.append(platform)
        if platform == "openclaw":
            raise RuntimeError("router model unavailable")
        return json.dumps({"agent": "OpenClaw"})

    async def fake_create(request):
        assert request.instance_id == "openclaw-default"
        return _response(openclaw)

    monkeypatch.setattr(chat_routes, "list_instances", fake_list_instances)
    monkeypatch.setattr(chat_routes, "_smart_runtime_budget_allows", fake_budget_allows)
    monkeypatch.setattr(chat_routes, "call_runtime_model_prompt", fake_router)
    monkeypatch.setattr(chat_routes, "_create_chat_session", fake_create)

    response = await chat_routes.smart_start_session(
        chat_routes.SmartStartSessionRequest(message="inspect terminal safety")
    )

    assert calls == ["openclaw", "hermes"]
    assert response.selected_agent == "OpenClaw"
    assert response.router_source == "hermes"


@pytest.mark.asyncio
async def test_smart_start_falls_back_when_router_agent_outside_candidates(monkeypatch):
    openclaw = _runtime("openclaw")
    hermes = _runtime("hermes")
    captured: dict[str, object] = {}

    async def fake_list_instances():
        return [openclaw, hermes]

    async def fake_budget_allows(_platform: str):
        return True

    async def fake_router(*_args, **_kwargs):
        return json.dumps({"agent": "Nanobot"})

    async def fake_create(request):
        captured["request"] = request
        return _response(openclaw)

    monkeypatch.setattr(chat_routes, "list_instances", fake_list_instances)
    monkeypatch.setattr(chat_routes, "_smart_runtime_budget_allows", fake_budget_allows)
    monkeypatch.setattr(chat_routes, "call_runtime_model_prompt", fake_router)
    monkeypatch.setattr(chat_routes, "_create_chat_session", fake_create)

    response = await chat_routes.smart_start_session(
        chat_routes.SmartStartSessionRequest(message="run a safe check")
    )

    request = captured["request"]
    assert isinstance(request, chat_routes.StartSessionRequest)
    assert request.instance_id == "openclaw-default"
    assert response.selected_agent == "OpenClaw"
    assert response.router_source == "deterministic_fallback"


@pytest.mark.asyncio
async def test_smart_start_falls_back_when_all_router_sources_fail(monkeypatch):
    openclaw = _runtime("openclaw")
    hermes = _runtime("hermes")
    calls: list[str] = []

    async def fake_list_instances():
        return [openclaw, hermes]

    async def fake_budget_allows(_platform: str):
        return True

    async def fake_router(
        _prompt: str,
        *,
        platform: str,
        instance_id: str,
        max_tokens: int,
        system_prompt: str | None = None,
    ):
        _ = instance_id, max_tokens, system_prompt
        calls.append(platform)
        raise RuntimeError("router model unavailable")

    async def fake_create(request):
        assert request.instance_id == "openclaw-default"
        return _response(openclaw)

    monkeypatch.setattr(chat_routes, "list_instances", fake_list_instances)
    monkeypatch.setattr(chat_routes, "_smart_runtime_budget_allows", fake_budget_allows)
    monkeypatch.setattr(chat_routes, "call_runtime_model_prompt", fake_router)
    monkeypatch.setattr(chat_routes, "_create_chat_session", fake_create)

    response = await chat_routes.smart_start_session(
        chat_routes.SmartStartSessionRequest(message="inspect terminal safety")
    )

    assert calls == ["openclaw", "hermes", "openclaw", "hermes", "openclaw"]
    assert response.selected_agent == "OpenClaw"
    assert response.router_source == "deterministic_fallback"


@pytest.mark.asyncio
async def test_smart_start_uses_fifth_router_attempt_when_it_succeeds(monkeypatch):
    openclaw = _runtime("openclaw")
    hermes = _runtime("hermes")
    calls: list[str] = []

    async def fake_list_instances():
        return [openclaw, hermes]

    async def fake_budget_allows(_platform: str):
        return True

    async def fake_router(
        _prompt: str,
        *,
        platform: str,
        instance_id: str,
        max_tokens: int,
        system_prompt: str | None = None,
    ):
        _ = instance_id, max_tokens, system_prompt
        calls.append(platform)
        if len(calls) < 5:
            return "Nanobot"
        return "B"

    async def fake_create(request):
        assert request.instance_id == "hermes-default"
        return _response(hermes)

    monkeypatch.setattr(chat_routes, "list_instances", fake_list_instances)
    monkeypatch.setattr(chat_routes, "_smart_runtime_budget_allows", fake_budget_allows)
    monkeypatch.setattr(chat_routes, "call_runtime_model_prompt", fake_router)
    monkeypatch.setattr(chat_routes, "_create_chat_session", fake_create)

    response = await chat_routes.smart_start_session(
        chat_routes.SmartStartSessionRequest(message="review this codebase")
    )

    assert calls == ["openclaw", "hermes", "openclaw", "hermes", "openclaw"]
    assert response.selected_agent == "Hermes"
    assert response.router_source == "openclaw"


@pytest.mark.asyncio
async def test_smart_start_accepts_plain_text_router_output(monkeypatch):
    openclaw = _runtime("openclaw")
    hermes = _runtime("hermes")

    async def fake_list_instances():
        return [openclaw, hermes]

    async def fake_budget_allows(_platform: str):
        return True

    async def fake_router(*_args, **_kwargs):
        return "I recommend Hermes for this request."

    async def fake_create(request):
        assert request.instance_id == "hermes-default"
        return _response(hermes)

    monkeypatch.setattr(chat_routes, "list_instances", fake_list_instances)
    monkeypatch.setattr(chat_routes, "_smart_runtime_budget_allows", fake_budget_allows)
    monkeypatch.setattr(chat_routes, "call_runtime_model_prompt", fake_router)
    monkeypatch.setattr(chat_routes, "_create_chat_session", fake_create)

    response = await chat_routes.smart_start_session(
        chat_routes.SmartStartSessionRequest(message="review this codebase")
    )

    assert response.selected_agent == "Hermes"
    assert response.router_source == "openclaw"


@pytest.mark.asyncio
async def test_smart_start_accepts_candidate_id_inside_sentence(monkeypatch):
    openclaw = _runtime("openclaw")
    hermes = _runtime("hermes")

    async def fake_list_instances():
        return [openclaw, hermes]

    async def fake_budget_allows(_platform: str):
        return True

    async def fake_router(*_args, **_kwargs):
        return "I choose option B."

    async def fake_create(request):
        assert request.instance_id == "hermes-default"
        return _response(hermes)

    monkeypatch.setattr(chat_routes, "list_instances", fake_list_instances)
    monkeypatch.setattr(chat_routes, "_smart_runtime_budget_allows", fake_budget_allows)
    monkeypatch.setattr(chat_routes, "call_runtime_model_prompt", fake_router)
    monkeypatch.setattr(chat_routes, "_create_chat_session", fake_create)

    response = await chat_routes.smart_start_session(
        chat_routes.SmartStartSessionRequest(message="review this codebase")
    )

    assert response.selected_agent == "Hermes"
    assert response.router_source == "openclaw"


@pytest.mark.asyncio
async def test_smart_available_candidates_exclude_budget_and_unreachable(monkeypatch):
    openclaw = _runtime("openclaw")
    hermes = _runtime("hermes", health_status="unreachable")
    nanobot = _runtime("nanobot")

    async def fake_budget_allows(platform: str):
        return platform != "openclaw"

    monkeypatch.setattr(chat_routes, "_smart_runtime_budget_allows", fake_budget_allows)

    candidates = await chat_routes._smart_available_agent_candidates(
        [openclaw, hermes, nanobot]
    )

    assert [(agent, instance.platform) for agent, instance in candidates] == [
        ("Nanobot", "nanobot")
    ]
