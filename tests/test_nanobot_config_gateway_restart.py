"""Tests for the nanobot gateway hot-reload triggered by ``POST /system/nanobot/config``.

This module covers the behavior added on top of the original
``set_nanobot_config()`` endpoint — namely the gateway-only stop helper
and the auto-restart leg that runs after the on-disk config has been
written. The original config-write/redact behavior is still covered by
``tests/test_nanobot_runtime_guard.py``; here we focus on:

  * ``_stop_running_nanobot_gateway_processes()`` only matches processes
    whose argv contains ``gateway``, so user-launched ``nanobot run`` /
    ``nanobot tools`` sessions are not killed.
  * ``set_nanobot_config()`` always tries the restart and returns
    ``restart_attempted`` / ``restart_status`` / ``restart_detail`` /
    ``stopped_gateway_processes`` regardless of restart outcome.
  * A failing restart leaves ``success: True`` and surfaces a clear
    ``restart_status: "failed"`` plus detail so the frontend can let the
    user retry.
  * A skipped restart (no nanobot installed) reports
    ``restart_status: "skipped"`` and still keeps ``success: True``.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

import pytest
from fastapi.testclient import TestClient

from xsafeclaw.api.main import app
from xsafeclaw.api.routes import system as system_routes


def _common_monkeypatch(monkeypatch, *, config_path, plugin_dir):
    async def fake_discover():
        return []

    monkeypatch.setattr(system_routes, "NANOBOT_DEFAULT_CONFIG", config_path)
    monkeypatch.setattr(system_routes.runtime_registry, "discover", fake_discover)
    monkeypatch.setattr(
        system_routes,
        "_install_safeclaw_guard_plugin",
        lambda **_kwargs: plugin_dir,
    )
    monkeypatch.setattr(
        system_routes,
        "_ensure_nanobot_xsafeclaw_overlay",
        lambda **_kwargs: asyncio.sleep(0, result=(True, "success", "overlay installed")),
    )


def _basic_payload(workspace) -> dict[str, Any]:
    return {
        "workspace": str(workspace),
        "provider": "minimax",
        "model": "MiniMax-M2.7",
        "api_key": "secret-key",
        "gateway_host": "127.0.0.1",
        "gateway_port": 18790,
        "websocket_enabled": True,
        "websocket_host": "127.0.0.1",
        "websocket_port": 8765,
        "websocket_path": "/",
        "websocket_requires_token": False,
        "guard_mode": "blocking",
        "guard_base_url": "http://127.0.0.1:6874",
        "guard_timeout_s": 30,
    }


# ---------------------------------------------------------------------------
# _stop_running_nanobot_gateway_processes
# ---------------------------------------------------------------------------


class _FakeProc:
    def __init__(self, info: dict[str, Any], terminate_raises: Exception | None = None):
        self.pid = info.get("pid", 0)
        self.info = info
        self._terminate_raises = terminate_raises
        self.terminate_called = False
        self.kill_called = False

    def terminate(self) -> None:
        self.terminate_called = True
        if self._terminate_raises is not None:
            raise self._terminate_raises

    def kill(self) -> None:
        self.kill_called = True

    def is_running(self) -> bool:
        return False


def _install_fake_psutil(monkeypatch, processes: list[_FakeProc]):
    """Install a minimal ``psutil`` stand-in inside the system module."""

    class _FakePsutil:
        @staticmethod
        def process_iter(_attrs):
            return iter(processes)

        @staticmethod
        def wait_procs(_procs, timeout: float = 0.5):  # noqa: ARG004
            return ([], [])

    import sys

    monkeypatch.setitem(sys.modules, "psutil", _FakePsutil)


def test_stop_gateway_only_skips_non_gateway_nanobot_processes(monkeypatch):
    own_pid = os.getpid()
    other_pid = own_pid + 9999
    while other_pid == own_pid:
        other_pid += 1

    gateway_proc = _FakeProc({
        "pid": other_pid + 1,
        "name": "nanobot.exe",
        "exe": "C:/Users/u/.local/bin/nanobot.exe",
        "cmdline": ["nanobot", "gateway", "--port", "18790"],
    })
    run_proc = _FakeProc({
        "pid": other_pid + 2,
        "name": "nanobot.exe",
        "exe": "C:/Users/u/.local/bin/nanobot.exe",
        "cmdline": ["nanobot", "run", "demo"],
    })
    own_gateway_proc = _FakeProc({
        "pid": own_pid,
        "name": "nanobot.exe",
        "exe": "C:/Users/u/.local/bin/nanobot.exe",
        "cmdline": ["nanobot", "gateway"],
    })
    unrelated_proc = _FakeProc({
        "pid": other_pid + 3,
        "name": "python.exe",
        "exe": "C:/Python/python.exe",
        "cmdline": ["python", "manage.py", "runserver"],
    })

    _install_fake_psutil(monkeypatch, [gateway_proc, run_proc, own_gateway_proc, unrelated_proc])

    stopped = system_routes._stop_running_nanobot_gateway_processes()

    assert [r["pid"] for r in stopped] == [gateway_proc.pid]
    assert gateway_proc.terminate_called is True
    assert run_proc.terminate_called is False
    assert own_gateway_proc.terminate_called is False
    assert unrelated_proc.terminate_called is False


def test_stop_gateway_returns_empty_when_no_processes_match(monkeypatch):
    # An iterable that yields nothing simulates a clean machine with no
    # nanobot gateway running. The helper must not raise and must return
    # an empty list (so callers know they didn't kill anything).
    _install_fake_psutil(monkeypatch, processes=[])

    result = system_routes._stop_running_nanobot_gateway_processes()

    assert result == []


def test_stop_gateway_records_terminate_failure(monkeypatch):
    """If ``proc.terminate()`` raises, the helper still records the attempt
    in the returned list so the caller can surface a useful detail."""

    own_pid = os.getpid()
    failing_proc = _FakeProc(
        {
            "pid": own_pid + 7777,
            "name": "nanobot.exe",
            "exe": "C:/Users/u/.local/bin/nanobot.exe",
            "cmdline": ["nanobot", "gateway", "--port", "18790"],
        },
        terminate_raises=PermissionError("access denied"),
    )

    _install_fake_psutil(monkeypatch, [failing_proc])

    result = system_routes._stop_running_nanobot_gateway_processes()

    assert len(result) == 1
    assert result[0]["pid"] == failing_proc.pid
    assert result[0]["method"] == "terminate-failed"
    assert "PermissionError" in result[0]["error"]


# ---------------------------------------------------------------------------
# /system/nanobot/config – restart status fields
# ---------------------------------------------------------------------------


def test_set_nanobot_config_returns_started_restart_status(monkeypatch, tmp_path):
    config_path = tmp_path / "nanobot-config.json"
    plugin_dir = tmp_path / "plugins" / "safeclaw-guard"
    _common_monkeypatch(monkeypatch, config_path=config_path, plugin_dir=plugin_dir)

    captured: dict[str, Any] = {}

    async def _fake_restart(*, timeout_s: float = 45.0):
        captured["timeout_s"] = timeout_s
        return "started", "nanobot gateway is now serving /health on :18790", [
            {"pid": 4242, "method": "terminate"}
        ]

    monkeypatch.setattr(
        system_routes,
        "_restart_nanobot_gateway_after_config_save",
        _fake_restart,
    )

    client = TestClient(app)
    response = client.post(
        "/api/system/nanobot/config",
        json=_basic_payload(tmp_path / "workspace"),
    )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["restart_attempted"] is True
    assert data["restart_status"] == "started"
    assert "nanobot gateway is now serving" in data["restart_detail"]
    assert data["stopped_gateway_processes"] == 1
    assert captured["timeout_s"] == 45.0

    # The on-disk config file was still written.
    stored = json.loads(config_path.read_text(encoding="utf-8"))
    assert stored["agents"]["defaults"]["model"] == "MiniMax-M2.7"
    assert stored["providers"]["minimax"]["apiKey"] == "secret-key"


def test_set_nanobot_config_reports_failed_restart_but_keeps_success(monkeypatch, tmp_path):
    config_path = tmp_path / "nanobot-config.json"
    plugin_dir = tmp_path / "plugins" / "safeclaw-guard"
    _common_monkeypatch(monkeypatch, config_path=config_path, plugin_dir=plugin_dir)

    async def _fake_restart(**_kwargs):
        return "failed", "spawn failed: PermissionError(13, 'Permission denied')", []

    monkeypatch.setattr(
        system_routes,
        "_restart_nanobot_gateway_after_config_save",
        _fake_restart,
    )

    client = TestClient(app)
    response = client.post(
        "/api/system/nanobot/config",
        json=_basic_payload(tmp_path / "workspace"),
    )

    assert response.status_code == 200
    data = response.json()
    # The config write itself succeeded — we don't roll back when the
    # gateway restart fails. The frontend uses ``restart_status`` /
    # ``restart_detail`` to surface the failure and offer retry.
    assert data["success"] is True
    assert data["restart_attempted"] is True
    assert data["restart_status"] == "failed"
    assert "spawn failed" in data["restart_detail"]
    assert data["stopped_gateway_processes"] == 0


def test_set_nanobot_config_reports_skipped_when_nanobot_not_installed(monkeypatch, tmp_path):
    config_path = tmp_path / "nanobot-config.json"
    plugin_dir = tmp_path / "plugins" / "safeclaw-guard"
    _common_monkeypatch(monkeypatch, config_path=config_path, plugin_dir=plugin_dir)

    async def _fake_restart(**_kwargs):
        return "skipped", "nanobot CLI missing on PATH", []

    monkeypatch.setattr(
        system_routes,
        "_restart_nanobot_gateway_after_config_save",
        _fake_restart,
    )

    client = TestClient(app)
    response = client.post(
        "/api/system/nanobot/config",
        json=_basic_payload(tmp_path / "workspace"),
    )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["restart_attempted"] is True
    assert data["restart_status"] == "skipped"
    assert data["restart_detail"] == "nanobot CLI missing on PATH"
    assert data["stopped_gateway_processes"] == 0


# ---------------------------------------------------------------------------
# _restart_nanobot_gateway_after_config_save (composition)
# ---------------------------------------------------------------------------


def test_restart_helper_propagates_autostart_failure(monkeypatch):
    """If ``autostart_nanobot`` raises, we wrap the error as ``status=failed``
    instead of bubbling a 500 up to the user."""

    monkeypatch.setattr(
        system_routes,
        "_stop_running_nanobot_gateway_processes",
        lambda **_: [{"pid": 1234, "method": "terminate"}],
    )

    async def _broken_autostart(**_kwargs):
        raise RuntimeError("simulated startup crash")

    import xsafeclaw.services.runtime_autostart as runtime_autostart_module

    monkeypatch.setattr(runtime_autostart_module, "autostart_nanobot", _broken_autostart)

    status, detail, stopped = asyncio.run(
        system_routes._restart_nanobot_gateway_after_config_save(timeout_s=1.0)
    )

    assert status == "failed"
    assert "simulated startup crash" in detail
    assert stopped == [{"pid": 1234, "method": "terminate"}]


def test_restart_helper_returns_started_when_autostart_succeeds(monkeypatch):
    monkeypatch.setattr(
        system_routes,
        "_stop_running_nanobot_gateway_processes",
        lambda **_: [],
    )

    async def _fake_autostart(*, timeout_s: float = 45.0):  # noqa: ARG001
        return "started", "nanobot gateway is now serving /health on :18790"

    import xsafeclaw.services.runtime_autostart as runtime_autostart_module

    monkeypatch.setattr(runtime_autostart_module, "autostart_nanobot", _fake_autostart)

    status, detail, stopped = asyncio.run(
        system_routes._restart_nanobot_gateway_after_config_save(timeout_s=1.0)
    )

    assert status == "started"
    assert "nanobot gateway is now serving" in detail
    assert stopped == []
