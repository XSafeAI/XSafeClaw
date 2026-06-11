from __future__ import annotations

import asyncio
import json

import pytest

from xsafeclaw.services import guard_service
from xsafeclaw.services import openclaw_silent_credentials


class _FakeResponse:
    def __init__(self, payload: dict):
        self._payload = payload
        self.status_code = 200

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


def _install_fake_async_client(monkeypatch, payload: dict, seen: dict[str, object]) -> None:
    class FakeClient:
        def __init__(self, *args, **kwargs):
            seen["kwargs"] = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, json=None, headers=None):
            seen["url"] = url
            seen["json"] = json
            seen["headers"] = headers
            return _FakeResponse(payload)

    monkeypatch.setattr(guard_service.httpx, "AsyncClient", FakeClient)


async def _wait_for_pending() -> guard_service.PendingApproval:
    for _ in range(50):
        pending = guard_service.get_all_pending()
        if pending:
            return pending[0]
        await asyncio.sleep(0)
    raise AssertionError("pending approval was not created")


@pytest.fixture(autouse=True)
def _reset_guard_runtime_state(tmp_path, monkeypatch):
    original_enabled = guard_service._guard_enabled
    monkeypatch.setattr(guard_service, "_TOOL_POLICY_FILE", tmp_path / "tool_policies.json")
    guard_service.invalidate_model_cache()
    guard_service._pending.clear()
    guard_service._observations.clear()
    yield
    guard_service.invalidate_model_cache()
    guard_service._pending.clear()
    guard_service._observations.clear()
    guard_service._guard_enabled = original_enabled


def test_get_openclaw_model_info_reads_api_type_and_provider_api_key(monkeypatch, tmp_path):
    openclaw_dir = tmp_path / ".openclaw"
    config_path = openclaw_dir / "openclaw.json"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        json.dumps(
            {
                "agents": {
                    "defaults": {
                        "model": {
                            "primary": "custom-api-deepseek-com/deepseek-v4-pro",
                        }
                    }
                },
                "models": {
                    "providers": {
                        "custom-api-deepseek-com": {
                            "baseUrl": "https://api.deepseek.com/anthropic",
                            "api": "anthropic-messages",
                            "apiKey": "provider-key",
                            "models": [{"id": "deepseek-v4-pro"}],
                        }
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(guard_service, "_OPENCLAW_DIR", openclaw_dir)
    monkeypatch.setattr(guard_service, "_CONFIG_PATH", config_path)

    info = guard_service._get_openclaw_model_info()

    assert info["provider"] == "custom-api-deepseek-com"
    assert info["model"] == "deepseek-v4-pro"
    assert info["base_url"] == "https://api.deepseek.com/anthropic"
    assert info["api_key"] == "provider-key"
    assert info["api_type"] == "anthropic-messages"


def test_get_openclaw_model_info_prefers_matching_silent_credentials(monkeypatch, tmp_path):
    openclaw_dir = tmp_path / ".openclaw"
    config_path = openclaw_dir / "openclaw.json"
    data_dir = tmp_path / ".xsafeclaw"
    config = {
        "agents": {"defaults": {"model": {"primary": "deepseek/deepseek-v4-flash"}}},
        "models": {
            "providers": {
                "deepseek": {
                    "baseUrl": "https://api.deepseek.com",
                    "api": "openai-completions",
                    "models": [{"id": "deepseek-v4-flash"}],
                }
            }
        },
    }
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(config), encoding="utf-8")
    monkeypatch.setattr(guard_service, "_OPENCLAW_DIR", openclaw_dir)
    monkeypatch.setattr(guard_service, "_CONFIG_PATH", config_path)
    monkeypatch.setattr(guard_service.settings, "data_dir", data_dir)
    openclaw_silent_credentials.save_openclaw_silent_model_credentials(
        config,
        api_key="sk-silent",
        source="test",
    )

    info = guard_service._get_openclaw_model_info()

    assert info["provider"] == "deepseek"
    assert info["model"] == "deepseek-v4-flash"
    assert info["base_url"] == "https://api.deepseek.com"
    assert info["api_key"] == "sk-silent"
    assert info["api_type"] == "openai-completions"
    assert info["credential_source"] == "openclaw-silent-model"


def test_get_openclaw_model_info_ignores_stale_silent_credentials(monkeypatch, tmp_path):
    openclaw_dir = tmp_path / ".openclaw"
    config_path = openclaw_dir / "openclaw.json"
    data_dir = tmp_path / ".xsafeclaw"
    stale_config = {
        "agents": {"defaults": {"model": {"primary": "deepseek/deepseek-v4-flash"}}},
        "models": {
            "providers": {
                "deepseek": {
                    "baseUrl": "https://api.deepseek.com",
                    "models": [{"id": "deepseek-v4-flash"}],
                }
            }
        },
    }
    active_config = {
        "agents": {"defaults": {"model": {"primary": "openai/gpt-5-mini"}}},
        "models": {
            "providers": {
                "openai": {
                    "baseUrl": "https://api.openai.com/v1",
                    "apiKey": "provider-key",
                    "models": [{"id": "gpt-5-mini"}],
                }
            }
        },
    }
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(active_config), encoding="utf-8")
    monkeypatch.setattr(guard_service, "_OPENCLAW_DIR", openclaw_dir)
    monkeypatch.setattr(guard_service, "_CONFIG_PATH", config_path)
    monkeypatch.setattr(guard_service.settings, "data_dir", data_dir)
    openclaw_silent_credentials.save_openclaw_silent_model_credentials(
        stale_config,
        api_key="sk-stale",
        source="test",
    )

    info = guard_service._get_openclaw_model_info()

    assert info["provider"] == "openai"
    assert info["model"] == "gpt-5-mini"
    assert info["api_key"] == "provider-key"
    assert "credential_source" not in info


def test_resolve_guard_model_info_uses_hermes_runtime_model(monkeypatch, tmp_path):
    hermes_home = tmp_path / ".hermes"
    config_path = hermes_home / "config.yaml"
    hermes_home.mkdir(parents=True)
    config_path.write_text("model:\n  default: openai/gpt-4.1\n", encoding="utf-8")
    (hermes_home / ".env").write_text("API_SERVER_KEY=hermes-secret\n", encoding="utf-8")
    monkeypatch.setattr(guard_service.settings, "hermes_config_path", config_path)
    monkeypatch.setattr(guard_service.settings, "hermes_home", hermes_home)
    monkeypatch.setattr(guard_service.settings, "hermes_api_port", 8642)
    monkeypatch.setattr(guard_service.settings, "hermes_api_key", "")

    info = guard_service._resolve_guard_model_info(platform="hermes", instance_id="hermes-default")

    assert info == {
        "provider": "hermes",
        "model": "openai/gpt-4.1",
        "base_url": "http://127.0.0.1:8642/v1",
        "api_key": "hermes-secret",
        "api_type": "openai-completions",
    }


def test_resolve_guard_model_info_uses_nanobot_runtime_model(monkeypatch, tmp_path):
    config_path = tmp_path / ".nanobot" / "config.json"
    config_path.parent.mkdir(parents=True)
    config_path.write_text(
        json.dumps(
            {
                "agents": {
                    "defaults": {
                        "provider": "minimax",
                        "model": "minimax/MiniMax-M2.7",
                    }
                },
                "providers": {
                    "minimax": {
                        "apiKey": "nanobot-secret",
                        "apiBase": "https://api.minimax.io/v1",
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(guard_service, "_NANOBOT_CONFIG_PATH", config_path)

    info = guard_service._resolve_guard_model_info(platform="nanobot", instance_id="nanobot-default")

    assert info == {
        "provider": "minimax",
        "model": "minimax/MiniMax-M2.7",
        "base_url": "https://api.minimax.io/v1",
        "api_key": "nanobot-secret",
        "api_type": "openai-completions",
    }


@pytest.mark.asyncio
async def test_call_runtime_model_prompt_openai_uses_system_message(monkeypatch):
    seen: dict[str, object] = {}
    _install_fake_async_client(
        monkeypatch,
        {"choices": [{"message": {"content": "ok"}}]},
        seen,
    )
    monkeypatch.setattr(
        guard_service,
        "_resolve_guard_model_info",
        lambda **_kwargs: {
            "provider": "openai",
            "model": "gpt-5-mini",
            "base_url": "https://api.openai.com/v1",
            "api_key": "sk-openai",
            "api_type": "openai-completions",
        },
    )

    result = await guard_service.call_runtime_model_prompt(
        "User request",
        platform="openclaw",
        instance_id="openclaw-default",
        max_tokens=64,
        system_prompt="System rules",
    )

    assert result == "ok"
    assert seen["url"] == "https://api.openai.com/v1/chat/completions"
    assert seen["kwargs"] == {"timeout": 30}
    body = seen["json"]
    assert isinstance(body, dict)
    assert body["messages"] == [
        {"role": "system", "content": "System rules"},
        {"role": "user", "content": "User request"},
    ]
    assert body["max_tokens"] == 64
    assert body["temperature"] == 0.2


@pytest.mark.asyncio
async def test_call_runtime_model_prompt_without_system_prompt_keeps_single_user_message(monkeypatch):
    seen: dict[str, object] = {}
    _install_fake_async_client(
        monkeypatch,
        {"choices": [{"message": {"content": "ok"}}]},
        seen,
    )
    monkeypatch.setattr(
        guard_service,
        "_resolve_guard_model_info",
        lambda **_kwargs: {
            "provider": "openai",
            "model": "gpt-5-mini",
            "base_url": "https://api.openai.com/v1",
            "api_key": "sk-openai",
            "api_type": "openai-completions",
        },
    )

    result = await guard_service.call_runtime_model_prompt(
        "Plain prompt",
        platform="openclaw",
        instance_id="openclaw-default",
        max_tokens=8,
    )

    assert result == "ok"
    body = seen["json"]
    assert isinstance(body, dict)
    assert body["messages"] == [{"role": "user", "content": "Plain prompt"}]
    assert "system" not in body
    assert body["max_tokens"] == 16


@pytest.mark.asyncio
async def test_call_runtime_model_prompt_anthropic_uses_top_level_system(monkeypatch):
    seen: dict[str, object] = {}
    _install_fake_async_client(
        monkeypatch,
        {"content": [{"type": "text", "text": "ok"}]},
        seen,
    )
    monkeypatch.setattr(
        guard_service,
        "_resolve_guard_model_info",
        lambda **_kwargs: {
            "provider": "anthropic",
            "model": "claude-sonnet",
            "base_url": "https://api.anthropic.com",
            "api_key": "sk-anthropic",
            "api_type": "anthropic-messages",
        },
    )

    result = await guard_service.call_runtime_model_prompt(
        "User request",
        platform="hermes",
        instance_id="hermes-default",
        max_tokens=64,
        system_prompt="System rules",
    )

    assert result == "ok"
    body = seen["json"]
    assert isinstance(body, dict)
    assert body["system"] == "System rules"
    assert body["messages"] == [{"role": "user", "content": "User request"}]
    assert body["max_tokens"] == 64
    assert body["temperature"] == 0.2


@pytest.mark.asyncio
async def test_call_runtime_model_prompt_deletes_silent_credentials_on_auth_failure(monkeypatch, tmp_path):
    data_dir = tmp_path / ".xsafeclaw"
    monkeypatch.setattr(guard_service.settings, "data_dir", data_dir)
    openclaw_silent_credentials.save_openclaw_silent_model_credentials(
        {
            "agents": {"defaults": {"model": {"primary": "deepseek/deepseek-v4-flash"}}},
            "models": {
                "providers": {
                    "deepseek": {
                        "baseUrl": "https://api.deepseek.com",
                        "models": [{"id": "deepseek-v4-flash"}],
                    }
                }
            },
        },
        api_key="sk-bad",
        source="test",
    )
    credential_path = openclaw_silent_credentials.openclaw_silent_model_credentials_path()

    class UnauthorizedResponse:
        status_code = 401

        def raise_for_status(self):
            request = guard_service.httpx.Request("POST", "https://api.deepseek.com/v1/chat/completions")
            response = guard_service.httpx.Response(401, request=request)
            raise guard_service.httpx.HTTPStatusError(
                "Unauthorized",
                request=request,
                response=response,
            )

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, *_args, **_kwargs):
            return UnauthorizedResponse()

    monkeypatch.setattr(guard_service.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(
        guard_service,
        "_resolve_guard_model_info",
        lambda **_kwargs: {
            "provider": "deepseek",
            "model": "deepseek-v4-flash",
            "base_url": "https://api.deepseek.com",
            "api_key": "sk-bad",
            "api_type": "openai-completions",
            "credential_source": "openclaw-silent-model",
        },
    )

    with pytest.raises(guard_service.httpx.HTTPStatusError):
        await guard_service.call_runtime_model_prompt("title this")

    assert not credential_path.exists()


@pytest.mark.asyncio
async def test_call_guard_model_uses_openai_chat_completions(monkeypatch):
    seen: dict[str, object] = {}
    _install_fake_async_client(
        monkeypatch,
        {"choices": [{"message": {"content": "safe"}}]},
        seen,
    )
    monkeypatch.setattr(
        guard_service,
        "_get_openclaw_model_info",
        lambda: {
            "provider": "openai",
            "model": "gpt-5-mini",
            "base_url": "https://api.openai.com/v1",
            "api_key": "sk-openai",
            "api_type": "openai-completions",
        },
    )

    result = await guard_service._call_guard_model("test trajectory")

    assert result == "safe"
    assert seen["url"] == "https://api.openai.com/v1/chat/completions"
    assert seen["headers"] == {
        "Content-Type": "application/json",
        "Authorization": "Bearer sk-openai",
    }
    assert seen["kwargs"] == {"timeout": 60}
    body = seen["json"]
    assert isinstance(body, dict)
    assert body["model"] == "gpt-5-mini"
    assert body["max_tokens"] == 1024
    assert "test trajectory" in body["messages"][0]["content"]


@pytest.mark.asyncio
async def test_check_tool_call_uses_anthropic_messages_and_creates_pending(monkeypatch):
    seen: dict[str, object] = {}
    guard_service.save_tool_policies({"shell": "guard"})
    _install_fake_async_client(
        monkeypatch,
        {
            "content": [
                {
                    "type": "text",
                    "text": (
                        "unsafe\n"
                        "Risk Source: prompt injection\n"
                        "Failure Mode: secret exfiltration\n"
                        "Real World Harm: data leak"
                    ),
                }
            ]
        },
        seen,
    )
    monkeypatch.setattr(
        guard_service,
        "_resolve_guard_model_info",
        lambda **_kwargs: {
            "provider": "custom-api-deepseek-com",
            "model": "deepseek-v4-pro",
            "base_url": "https://api.deepseek.com/anthropic",
            "api_key": "sk-anthropic",
            "api_type": "anthropic-messages",
        },
    )
    monkeypatch.setattr(guard_service, "_guard_enabled", True)

    task = asyncio.create_task(
        guard_service.check_tool_call(
            tool_name="exec",
            params={"command": "Get-ChildItem"},
            session_key="hermes:test-session",
            platform="hermes",
            instance_id="hermes-default",
            messages=[
                {"role": "user", "content": "list files"},
                {"role": "assistant", "content": "I will inspect the workspace."},
            ],
        )
    )

    pending = await _wait_for_pending()

    assert pending.platform == "hermes"
    assert pending.instance_id == "hermes-default"
    assert pending.guard_verdict == "unsafe"
    assert pending.tool_name == "exec"
    assert seen["url"] == "https://api.deepseek.com/anthropic/v1/messages"
    headers = seen["headers"]
    assert isinstance(headers, dict)
    assert headers["Content-Type"] == "application/json"
    assert headers["x-api-key"] == "sk-anthropic"
    assert headers["Authorization"] == "Bearer sk-anthropic"
    assert headers["anthropic-version"] == "2023-06-01"

    guard_service.resolve_pending(pending.id, "approved")
    result = await task

    assert result["action"] == "allow"


@pytest.mark.asyncio
async def test_runtime_tool_check_blocking_uses_anthropic_messages(monkeypatch):
    seen: dict[str, object] = {}
    _install_fake_async_client(
        monkeypatch,
        {
            "content": [
                {
                    "type": "text",
                    "text": (
                        "unsafe\n"
                        "Risk Source: prompt injection\n"
                        "Failure Mode: credential theft\n"
                        "Real World Harm: account compromise"
                    ),
                }
            ]
        },
        seen,
    )
    monkeypatch.setattr(
        guard_service,
        "_resolve_guard_model_info",
        lambda **_kwargs: {
            "provider": "custom-api-deepseek-com",
            "model": "deepseek-v4-pro",
            "base_url": "https://api.deepseek.com/anthropic",
            "api_key": "sk-anthropic",
            "api_type": "anthropic-messages",
        },
    )
    monkeypatch.setattr(guard_service, "_guard_enabled", True)

    task = asyncio.create_task(
        guard_service.check_runtime_tool_call(
            platform="nanobot",
            instance_id="nanobot-default",
            guard_mode="blocking",
            session_key="websocket:test-session",
            tool_name="read",
            params={"path": "C:/guard_lab/secrets.txt"},
            messages=[
                {"role": "user", "content": "inspect the fake secret file"},
                {"role": "assistant", "content": "I will read the file."},
            ],
        )
    )

    pending = await _wait_for_pending()

    assert pending.platform == "nanobot"
    assert pending.instance_id == "nanobot-default"
    assert pending.guard_verdict == "unsafe"
    assert seen["url"] == "https://api.deepseek.com/anthropic/v1/messages"

    guard_service.resolve_pending(pending.id, "rejected")
    result = await task

    assert result["action"] == "block"
    assert "rejected by the safety reviewer" in result["reason"]


@pytest.mark.asyncio
async def test_call_guard_model_rejects_unsupported_api_type(monkeypatch):
    monkeypatch.setattr(
        guard_service,
        "_get_openclaw_model_info",
        lambda: {
            "provider": "google",
            "model": "gemini-2.5-pro",
            "base_url": "https://generativelanguage.googleapis.com/v1beta",
            "api_key": "sk-google",
            "api_type": "google-generative-ai",
        },
    )

    with pytest.raises(RuntimeError, match="Unsupported guard model api type: google-generative-ai"):
        await guard_service._call_guard_model("test trajectory")
