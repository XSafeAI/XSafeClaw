"""Regression tests for OpenClaw 2026.5.x non-interactive onboarding compat."""

from __future__ import annotations

import asyncio
import json

import pytest
from fastapi import HTTPException

from xsafeclaw import gateway_client
from xsafeclaw.api.routes import system as system_routes
from xsafeclaw.services import openclaw_silent_credentials, runtime_autostart


class _FakeProc:
    def __init__(self, *, returncode: int = 0, output: str = "ok"):
        self.returncode = returncode
        self._output = output

    async def communicate(self):
        return self._output.encode("utf-8"), b""


def _write_openclaw_model_config(config_path, *, provider="deepseek", model="deepseek-v4-flash"):
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        json.dumps(
            {
                "gateway": {
                    "port": 18789,
                    "bind": "loopback",
                    "auth": {"mode": "token", "token": "gateway-token"},
                },
                "agents": {"defaults": {"model": {"primary": f"{provider}/{model}"}}},
                "models": {
                    "providers": {
                        provider: {
                            "baseUrl": "https://api.deepseek.com",
                            "api": "openai-completions",
                            "models": [{"id": model}],
                        }
                    }
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


class _FakeGatewayClient:
    async def connect(self):
        return None

    async def list_models(self):
        return {"models": [{"id": "deepseek/deepseek-v4-flash", "name": "DeepSeek"}]}

    async def disconnect(self):
        return None


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
    order: list[str] = []

    async def _fake_create_subprocess_exec(*args, **_kwargs):
        order.append("subprocess")
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
    monkeypatch.setattr(
        system_routes,
        "_install_safeclaw_guard_plugin",
        lambda platform="openclaw": order.append("install"),
    )
    monkeypatch.setattr(
        system_routes,
        "sanitize_legacy_openclaw_config",
        lambda: order.append("sanitize") or False,
    )

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
    assert order[:3] == ["install", "sanitize", "subprocess"]


def test_onboard_config_includes_auth_choice_and_fails_if_config_missing(monkeypatch, tmp_path):
    config_path = tmp_path / "openclaw.json"
    captured: dict[str, list[str]] = {}
    order: list[str] = []

    async def _fake_create_subprocess_exec(*args, **_kwargs):
        order.append("subprocess")
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
    monkeypatch.setattr(
        system_routes,
        "_install_safeclaw_guard_plugin",
        lambda platform="openclaw": order.append("install"),
    )
    monkeypatch.setattr(
        system_routes,
        "sanitize_legacy_openclaw_config",
        lambda: order.append("sanitize") or False,
    )

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
    assert order[:3] == ["install", "sanitize", "subprocess"]


def test_patch_config_extras_repairs_existing_safeclaw_guard_plugin(monkeypatch, tmp_path):
    config_path = tmp_path / "openclaw.json"
    openclaw_root = tmp_path / ".openclaw"
    config_path.write_text(
        json.dumps(
            {
                "plugins": {
                    "load": {
                        "paths": [
                            "/tmp/old-safeclaw",
                            "/tmp/old-safeclaw",
                            "",
                        ]
                    },
                    "entries": {
                        "safeclaw-guard": {
                            "enabled": True,
                            "path": "/tmp/old-safeclaw",
                            "config": {
                                "safeclawUrl": "http://127.0.0.1:9999",
                                "unexpected": "remove-me",
                            },
                        }
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(system_routes, "_CONFIG_PATH", config_path)
    monkeypatch.setattr(system_routes, "_OPENCLAW_DIR", openclaw_root)

    body = system_routes.OnboardConfigRequest(
        mode="remote",
        provider="openai-api-key",
        api_key="sk-test",
        model_id="openai/gpt-5.5",
        platform="openclaw",
    )

    system_routes._patch_config_extras(body)

    saved = json.loads(config_path.read_text(encoding="utf-8"))
    paths = saved["plugins"]["load"]["paths"]
    entry = saved["plugins"]["entries"]["safeclaw-guard"]
    assert paths == ["/tmp/old-safeclaw", str(openclaw_root / "extensions" / "safeclaw-guard")]
    assert entry["enabled"] is True
    assert "path" not in entry
    assert entry["config"]["safeclawUrl"] == "http://127.0.0.1:9999"
    assert entry["config"]["failOpenOnGuardError"] is False
    assert "unexpected" not in entry["config"]


def test_sanitize_legacy_openclaw_config_repairs_stale_safeclaw_guard_plugin(monkeypatch, tmp_path):
    config_path = tmp_path / "openclaw.json"
    openclaw_root = tmp_path / ".openclaw"
    config_path.write_text(
        json.dumps(
            {
                "plugins": {
                    "load": {"paths": ["stale", "stale"]},
                    "entries": {
                        "safeclaw-guard": {
                            "path": "stale",
                            "enabled": True,
                            "config": {
                                "safeclawUrl": "",
                                "legacy": True,
                            },
                        }
                    },
                }
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(system_routes, "_CONFIG_PATH", config_path)
    monkeypatch.setattr(system_routes, "_OPENCLAW_DIR", openclaw_root)

    changed = system_routes.sanitize_legacy_openclaw_config()

    assert changed is True
    saved = json.loads(config_path.read_text(encoding="utf-8"))
    paths = saved["plugins"]["load"]["paths"]
    entry = saved["plugins"]["entries"]["safeclaw-guard"]
    assert paths == ["stale", str(openclaw_root / "extensions" / "safeclaw-guard")]
    assert "path" not in entry
    assert entry["enabled"] is True
    assert entry["config"] == {
        "safeclawUrl": "http://localhost:6874",
        "failOpenOnGuardError": False,
    }


def test_openclaw_guard_plugin_metadata_declares_runtime_entry_and_startup_activation():
    plugin_root = system_routes._plugins_root() / "safeclaw-guard"

    package = json.loads(plugin_root.joinpath("package.json").read_text(encoding="utf-8"))
    manifest = json.loads(plugin_root.joinpath("openclaw.plugin.json").read_text(encoding="utf-8"))

    assert package["openclaw"]["extensions"] == ["./index.js"]
    assert manifest["activation"]["onStartup"] is True


def test_quick_model_config_persists_openclaw_silent_credentials(monkeypatch, tmp_path):
    config_path = tmp_path / ".openclaw" / "openclaw.json"
    data_dir = tmp_path / ".xsafeclaw"
    captured: dict[str, list[str]] = {}
    _write_openclaw_model_config(config_path)

    async def _fake_create_subprocess_exec(*args, **_kwargs):
        captured["args"] = [str(item) for item in args]
        return _FakeProc(returncode=0, output="onboard ok")

    async def _fake_sleep(_seconds):
        return None

    monkeypatch.setattr(system_routes.settings, "data_dir", data_dir)
    monkeypatch.setattr(system_routes, "_CONFIG_PATH", config_path)
    monkeypatch.setattr(system_routes, "_find_openclaw", lambda: "/usr/bin/openclaw")
    monkeypatch.setattr(system_routes, "_build_env", lambda: {})
    monkeypatch.setattr(
        system_routes,
        "_get_auth_providers_and_flags",
        lambda: ([], {"deepseek-api-key": "--deepseek-api-key"}),
    )
    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", _fake_create_subprocess_exec)
    monkeypatch.setattr(system_routes.asyncio, "sleep", _fake_sleep)
    monkeypatch.setattr(system_routes, "_install_safeclaw_guard_plugin", lambda platform="openclaw": True)
    monkeypatch.setattr(system_routes, "trigger_onboard_scan_preload", lambda force=False: None)
    monkeypatch.setattr("xsafeclaw.gateway_client.GatewayClient", _FakeGatewayClient)

    body = system_routes.QuickModelConfigRequest(
        provider="deepseek-api-key",
        api_key="sk-deepseek",
        model_id="deepseek/deepseek-v4-flash",
        platform="openclaw",
    )

    result = asyncio.run(system_routes.quick_model_config(body))

    assert result["success"] is True
    assert "--deepseek-api-key" in captured["args"]
    credential_path = openclaw_silent_credentials.openclaw_silent_model_credentials_path()
    saved = json.loads(credential_path.read_text(encoding="utf-8"))
    assert saved["provider"] == "deepseek"
    assert saved["model"] == "deepseek-v4-flash"
    assert saved["base_url"] == "https://api.deepseek.com"
    assert saved["api_type"] == "openai-completions"
    assert saved["api_key"] == "sk-deepseek"
    assert saved["source"] == "quick_model_config"


def test_onboard_config_persists_openclaw_silent_credentials(monkeypatch, tmp_path):
    config_path = tmp_path / ".openclaw" / "openclaw.json"
    data_dir = tmp_path / ".xsafeclaw"
    _write_openclaw_model_config(config_path)

    async def _fake_create_subprocess_exec(*_args, **_kwargs):
        return _FakeProc(returncode=0, output="onboard ok")

    async def _fake_auto_approve_devices():
        return None

    monkeypatch.setattr(system_routes.settings, "data_dir", data_dir)
    monkeypatch.setattr(system_routes, "_CONFIG_PATH", config_path)
    monkeypatch.setattr(system_routes, "_find_openclaw", lambda: "/usr/bin/openclaw")
    monkeypatch.setattr(system_routes, "_build_env", lambda: {})
    monkeypatch.setattr(
        system_routes,
        "_get_auth_providers_and_flags",
        lambda: ([], {"deepseek-api-key": "--deepseek-api-key"}),
    )
    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", _fake_create_subprocess_exec)
    monkeypatch.setattr(system_routes, "_install_safeclaw_guard_plugin", lambda platform="openclaw": True)
    monkeypatch.setattr(system_routes, "_deploy_safety_files", lambda _workspace: None)
    monkeypatch.setattr(system_routes, "_auto_approve_devices", _fake_auto_approve_devices)
    monkeypatch.setattr(system_routes, "trigger_onboard_scan_preload", lambda force=False: None)

    body = system_routes.OnboardConfigRequest(
        mode="remote",
        provider="deepseek-api-key",
        api_key="sk-deepseek",
        model_id="deepseek/deepseek-v4-flash",
        platform="openclaw",
    )

    result = asyncio.run(system_routes.onboard_config(body))

    assert result["success"] is True
    saved = json.loads(
        openclaw_silent_credentials.openclaw_silent_model_credentials_path().read_text(encoding="utf-8")
    )
    assert saved["api_key"] == "sk-deepseek"
    assert saved["source"] == "onboard_config"


def test_config_reset_removes_openclaw_silent_credentials(monkeypatch, tmp_path):
    data_dir = tmp_path / ".xsafeclaw"
    monkeypatch.setattr(system_routes.settings, "data_dir", data_dir)
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
        api_key="sk-deepseek",
        source="test",
    )
    credential_path = openclaw_silent_credentials.openclaw_silent_model_credentials_path()
    assert credential_path.exists()

    result = asyncio.run(
        system_routes.config_reset(
            system_routes.ConfigResetRequest(scope="config+creds+sessions")
        )
    )

    assert str(credential_path) in result["deleted"]
    assert not credential_path.exists()


def test_config_reset_removes_openclaw_workspace_attestations(monkeypatch, tmp_path):
    openclaw_root = tmp_path / ".openclaw"
    attestations = openclaw_root / "workspace-attestations"
    attestation_file = attestations / "stale.attested"
    attestation_file.parent.mkdir(parents=True)
    attestation_file.write_text("workspace attested", encoding="utf-8")
    monkeypatch.setattr(system_routes, "_OPENCLAW_DIR", openclaw_root)
    monkeypatch.setattr(system_routes, "_CONFIG_PATH", openclaw_root / "openclaw.json")
    monkeypatch.setattr(
        system_routes,
        "_EXPLICIT_MODELS_PATH",
        openclaw_root / "xsafeclaw-explicit-models.json",
    )

    result = asyncio.run(
        system_routes.config_reset(
            system_routes.ConfigResetRequest(scope="config+creds+sessions")
        )
    )

    assert str(attestations) in result["deleted"]
    assert not attestations.exists()


def test_autostart_openclaw_uses_bundled_cli_and_configured_port(monkeypatch, tmp_path):
    home = tmp_path
    openclaw_root = home / ".openclaw"
    config_path = openclaw_root / "openclaw.json"
    config_path.parent.mkdir(parents=True)
    config_path.write_text(
        json.dumps({"gateway": {"bind": "loopback", "port": 19876}}),
        encoding="utf-8",
    )
    bundled_cli = home / ".xsafeclaw" / "node" / "bin" / "openclaw"
    bundled_cli.parent.mkdir(parents=True)
    bundled_cli.write_text("#!/bin/sh\n", encoding="utf-8")

    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    monkeypatch.setattr(gateway_client, "_find_openclaw_binary", lambda: str(bundled_cli))

    probe_calls: list[tuple[str, int]] = []
    captured: dict[str, list[str]] = {}

    async def _fake_probe_tcp_listener(host, port, **_kwargs):
        probe_calls.append((host, port))
        return len(probe_calls) > 1

    async def _fake_wait_http_health(*_args, **_kwargs):
        return False

    async def _fake_run_cmd(args, **_kwargs):
        captured["args"] = list(args)
        return 0, "started"

    async def _fake_auto_approve_repairs():
        return None

    monkeypatch.setattr(runtime_autostart, "_probe_tcp_listener", _fake_probe_tcp_listener)
    monkeypatch.setattr(runtime_autostart, "_wait_http_health", _fake_wait_http_health)
    monkeypatch.setattr(runtime_autostart, "_run_cmd", _fake_run_cmd)
    monkeypatch.setattr(runtime_autostart, "_auto_approve_openclaw_plugin_repairs", _fake_auto_approve_repairs)

    status, detail = asyncio.run(runtime_autostart.autostart_openclaw(timeout_s=0.1))

    assert status == "started"
    assert "19876" in detail
    assert captured["args"] == [str(bundled_cli), "gateway", "start", "--json"]
    assert probe_calls == [("127.0.0.1", 19876), ("127.0.0.1", 19876)]


def test_provider_has_key_uses_silent_credentials_without_exposing_key(monkeypatch, tmp_path):
    data_dir = tmp_path / ".xsafeclaw"
    monkeypatch.setattr(system_routes.settings, "data_dir", data_dir)
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
        api_key="sk-secret-never-return",
        source="test",
    )

    result = asyncio.run(
        system_routes.provider_has_key(provider="deepseek-api-key", platform="openclaw")
    )

    assert result == {"has_key": True}
    assert "sk-secret-never-return" not in json.dumps(result, ensure_ascii=False)
