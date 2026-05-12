"""Regression tests for OpenClaw 2026.5.x non-interactive onboarding compat."""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from xsafeclaw.api.routes import system as system_routes


class _FakeProc:
    def __init__(self, *, returncode: int = 0, output: str = "ok"):
        self.returncode = returncode
        self._output = output

    async def communicate(self):
        return self._output.encode("utf-8"), b""


def test_append_openclaw_auth_args_adds_auth_choice_and_cli_flag():
    args = ["openclaw", "onboard", "--non-interactive"]

    system_routes._append_openclaw_auth_args(
        args,
        provider="openai-api-key",
        api_key="sk-test",
        method_cli_flags={"openai-api-key": "--openai-api-key"},
    )

    assert "--auth-choice" in args
    assert "openai-api-key" in args
    assert "--openai-api-key" in args
    assert "sk-test" in args


def test_append_openclaw_auth_args_skips_skip_and_patch_only():
    base = ["openclaw", "onboard", "--non-interactive"]

    args_skip = list(base)
    system_routes._append_openclaw_auth_args(
        args_skip,
        provider="skip",
        api_key="",
        method_cli_flags={"skip": "--unused"},
    )
    assert args_skip == base

    args_patch_only = list(base)
    system_routes._append_openclaw_auth_args(
        args_patch_only,
        provider="custom-api-key",
        api_key="sk-custom",
        method_cli_flags={"custom-api-key": "--custom-api-key"},
        patch_only_providers={"custom-api-key"},
    )
    assert args_patch_only == base


def test_quick_model_config_includes_auth_choice_and_fails_if_config_missing(monkeypatch, tmp_path):
    config_path = tmp_path / "openclaw.json"
    captured: dict[str, list[str]] = {}

    async def _fake_create_subprocess_exec(*args, **_kwargs):
        captured["args"] = [str(item) for item in args]
        return _FakeProc(returncode=0, output="onboard ok")

    monkeypatch.setattr(system_routes, "_CONFIG_PATH", config_path)
    monkeypatch.setattr(system_routes, "_find_openclaw", lambda: "/usr/bin/openclaw")
    monkeypatch.setattr(system_routes, "_build_env", lambda: {})
    monkeypatch.setattr(
        system_routes,
        "_get_auth_providers_and_flags",
        lambda: ([], {"openai-api-key": "--openai-api-key"}),
    )
    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", _fake_create_subprocess_exec)

    body = system_routes.QuickModelConfigRequest(
        provider="openai-api-key",
        api_key="sk-test",
        model_id="openai/gpt-5.5",
        platform="openclaw",
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(system_routes.quick_model_config(body))

    assert exc.value.status_code == 500
    assert "did not create" in str(exc.value.detail)
    assert "openclaw.json" in str(exc.value.detail)
    assert "--auth-choice" in captured["args"]
    assert "openai-api-key" in captured["args"]
    assert "--openai-api-key" in captured["args"]
    assert "sk-test" in captured["args"]


def test_onboard_config_includes_auth_choice_and_fails_if_config_missing(monkeypatch, tmp_path):
    config_path = tmp_path / "openclaw.json"
    captured: dict[str, list[str]] = {}

    async def _fake_create_subprocess_exec(*args, **_kwargs):
        captured["args"] = [str(item) for item in args]
        return _FakeProc(returncode=0, output="onboard ok")

    monkeypatch.setattr(system_routes, "_CONFIG_PATH", config_path)
    monkeypatch.setattr(system_routes, "_find_openclaw", lambda: "/usr/bin/openclaw")
    monkeypatch.setattr(system_routes, "_build_env", lambda: {})
    monkeypatch.setattr(
        system_routes,
        "_get_auth_providers_and_flags",
        lambda: ([], {"openai-api-key": "--openai-api-key"}),
    )
    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", _fake_create_subprocess_exec)

    body = system_routes.OnboardConfigRequest(
        mode="remote",
        provider="openai-api-key",
        api_key="sk-test",
        model_id="openai/gpt-5.5",
        platform="openclaw",
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(system_routes.onboard_config(body))

    assert exc.value.status_code == 500
    assert "did not create" in str(exc.value.detail)
    assert "openclaw.json" in str(exc.value.detail)
    assert "--auth-choice" in captured["args"]
    assert "openai-api-key" in captured["args"]
    assert "--openai-api-key" in captured["args"]
    assert "sk-test" in captured["args"]
