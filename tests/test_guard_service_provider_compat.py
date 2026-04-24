from __future__ import annotations

import asyncio
import json

import pytest

from xsafeclaw.services import guard_service


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
def _reset_guard_runtime_state():
    original_enabled = guard_service._guard_enabled
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
        "_get_openclaw_model_info",
        lambda: {
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
        "_get_openclaw_model_info",
        lambda: {
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
