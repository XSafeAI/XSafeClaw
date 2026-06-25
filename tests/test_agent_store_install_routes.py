from __future__ import annotations

from pathlib import Path

from fastapi.responses import PlainTextResponse
from fastapi.testclient import TestClient

from xsafeclaw.api.main import app
from xsafeclaw.api.routes import system as system_routes


class _FakeStdout:
    def __init__(self, lines: list[bytes]) -> None:
        self._lines = [*lines, b""]

    async def readline(self) -> bytes:
        return self._lines.pop(0)


class _FakeProcess:
    def __init__(self, lines: list[bytes] | None = None, returncode: int = 0) -> None:
        self.stdout = _FakeStdout(lines or [b"native installer output\n"])
        self.returncode = returncode

    async def wait(self) -> None:
        return None


def test_agent_store_openclaw_auto_uses_windows_native_installer(monkeypatch):
    captured_args: list[tuple[object, ...]] = []

    async def fake_create_subprocess_exec(*args, **_kwargs):
        captured_args.append(args)
        return _FakeProcess()

    monkeypatch.setattr(system_routes, "_host_is_windows", lambda: True)
    monkeypatch.setattr(system_routes, "_find_available_launcher", lambda *_args, **_kwargs: "powershell")
    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    monkeypatch.setattr(system_routes, "trigger_onboard_scan_preload", lambda *args, **kwargs: None)

    response = TestClient(app).post("/api/system/agent-store/openclaw/install")

    assert response.status_code == 200
    assert "https://openclaw.ai/install.ps1" in response.text
    assert "native installer output" in response.text
    assert '"success": true' in response.text
    command = " ".join(str(part) for part in captured_args[0])
    assert "powershell" in command
    assert "openclaw.ai/install.ps1" in command


def test_agent_store_hermes_auto_uses_windows_native_installer(monkeypatch):
    captured_args: list[tuple[object, ...]] = []

    async def fake_create_subprocess_exec(*args, **_kwargs):
        captured_args.append(args)
        return _FakeProcess([b"hermes native installer output\n"])

    monkeypatch.setattr(system_routes, "_host_is_windows", lambda: True)
    monkeypatch.setattr(system_routes, "_find_available_launcher", lambda *_args, **_kwargs: "pwsh")
    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    monkeypatch.setattr(system_routes, "trigger_onboard_scan_preload", lambda *args, **kwargs: None)

    response = TestClient(app).post("/api/system/agent-store/hermes/install")

    assert response.status_code == 200
    assert "https://hermes-agent.nousresearch.com/install.ps1" in response.text
    assert "hermes native installer output" in response.text
    assert '"success": true' in response.text
    command = " ".join(str(part) for part in captured_args[0])
    assert "pwsh" in command
    assert "hermes-agent.nousresearch.com/install.ps1" in command


def test_agent_store_codex_auto_uses_windows_standalone_installer(monkeypatch):
    captured_args: list[tuple[object, ...]] = []
    captured_envs: list[dict[str, str]] = []

    async def fake_create_subprocess_exec(*args, **kwargs):
        captured_args.append(args)
        captured_envs.append(kwargs.get("env") or {})
        return _FakeProcess([b"codex native installer output\n"])

    monkeypatch.setattr(system_routes, "_host_is_windows", lambda: True)
    monkeypatch.setattr(system_routes, "_find_available_launcher", lambda *_args, **_kwargs: "powershell")
    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    monkeypatch.setattr(system_routes, "trigger_onboard_scan_preload", lambda *args, **kwargs: None)

    response = TestClient(app).post("/api/system/agent-store/codex/install")

    assert response.status_code == 200
    assert "https://chatgpt.com/codex/install.ps1" in response.text
    assert "codex native installer output" in response.text
    assert '"success": true' in response.text
    command = " ".join(str(part) for part in captured_args[0])
    assert "powershell" in command
    assert "chatgpt.com/codex/install.ps1" in command
    assert "CODEX_NON_INTERACTIVE" in command
    assert captured_envs[0]["CODEX_NON_INTERACTIVE"] == "1"


def test_agent_store_codex_failed_process_streams_failure(monkeypatch):
    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return _FakeProcess([b"codex native installer failed\n"], returncode=7)

    preload_calls: list[bool] = []
    monkeypatch.setattr(system_routes, "_host_is_windows", lambda: True)
    monkeypatch.setattr(system_routes, "_find_available_launcher", lambda *_args, **_kwargs: "powershell")
    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    monkeypatch.setattr(system_routes, "trigger_onboard_scan_preload", lambda *args, **kwargs: preload_calls.append(True))

    response = TestClient(app).post("/api/system/agent-store/codex/install")

    assert response.status_code == 200
    assert "codex native installer failed" in response.text
    assert '"success": false' in response.text
    assert '"exit_code": 7' in response.text
    assert preload_calls == []


def test_agent_store_openclaw_legacy_preserves_existing_installer(monkeypatch):
    async def fake_install_openclaw():
        return PlainTextResponse("legacy openclaw installer")

    monkeypatch.setattr(system_routes, "install_openclaw", fake_install_openclaw)

    response = TestClient(app).post("/api/system/agent-store/openclaw/install?method=legacy")

    assert response.status_code == 200
    assert response.text == "legacy openclaw installer"


def test_agent_store_nanobot_delegates_to_existing_installer(monkeypatch):
    async def fake_install_nanobot():
        return PlainTextResponse("existing nanobot installer")

    monkeypatch.setattr(system_routes, "install_nanobot", fake_install_nanobot)

    response = TestClient(app).post("/api/system/agent-store/nanobot/install")

    assert response.status_code == 200
    assert response.text == "existing nanobot installer"


def test_find_hermes_checks_windows_localappdata_install(monkeypatch, tmp_path):
    hermes_bin = tmp_path / "LocalAppData" / "hermes" / "bin"
    hermes_bin.mkdir(parents=True)
    hermes_cmd = hermes_bin / "hermes.cmd"
    hermes_cmd.write_text("@echo off\n", encoding="utf-8")

    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "LocalAppData"))
    monkeypatch.setattr(system_routes, "_host_is_windows", lambda: True)
    monkeypatch.setattr(system_routes, "_build_env", lambda: {"PATH": ""})
    monkeypatch.setattr(system_routes.Path, "home", lambda: tmp_path / "home")

    assert Path(system_routes._find_hermes() or "") == hermes_cmd


def test_find_openclaw_checks_windows_npm_global_shim(monkeypatch, tmp_path):
    if system_routes.os.name != "nt":
        return

    npm_bin = tmp_path / "Roaming" / "npm"
    npm_bin.mkdir(parents=True)
    openclaw_cmd = npm_bin / "openclaw.cmd"
    openclaw_cmd.write_text("@echo off\n", encoding="utf-8")

    monkeypatch.setenv("PATH", "")
    monkeypatch.setenv("APPDATA", str(tmp_path / "Roaming"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "LocalAppData"))
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setenv("USERPROFILE", str(tmp_path / "home"))
    monkeypatch.setattr(system_routes.Path, "home", lambda: tmp_path / "home")
    monkeypatch.setattr(system_routes, "_active_python_script_dirs", lambda: [])
    monkeypatch.setattr(system_routes, "_python_user_script_dirs", lambda: [])

    assert Path(system_routes._find_openclaw() or "") == openclaw_cmd


def test_find_codex_checks_windows_standalone_install_dir(monkeypatch, tmp_path):
    if system_routes.os.name != "nt":
        return

    codex_bin = tmp_path / "LocalAppData" / "Programs" / "OpenAI" / "Codex" / "bin"
    codex_bin.mkdir(parents=True)
    codex_exe = codex_bin / "codex.exe"
    codex_exe.write_text("", encoding="utf-8")

    monkeypatch.setenv("PATH", "")
    monkeypatch.setenv("APPDATA", str(tmp_path / "Roaming"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "LocalAppData"))
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setenv("USERPROFILE", str(tmp_path / "home"))
    monkeypatch.delenv("CODEX_INSTALL_DIR", raising=False)
    monkeypatch.setattr(system_routes.Path, "home", lambda: tmp_path / "home")
    monkeypatch.setattr(system_routes, "_active_python_script_dirs", lambda: [])
    monkeypatch.setattr(system_routes, "_python_user_script_dirs", lambda: [])

    assert Path(system_routes._find_codex() or "") == codex_exe


def test_find_codex_checks_windows_codex_install_dir_override(monkeypatch, tmp_path):
    if system_routes.os.name != "nt":
        return

    codex_bin = tmp_path / "CustomCodexBin"
    codex_bin.mkdir(parents=True)
    codex_exe = codex_bin / "codex.exe"
    codex_exe.write_text("", encoding="utf-8")

    monkeypatch.setenv("PATH", "")
    monkeypatch.setenv("APPDATA", str(tmp_path / "Roaming"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "LocalAppData"))
    monkeypatch.setenv("CODEX_INSTALL_DIR", str(codex_bin))
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setenv("USERPROFILE", str(tmp_path / "home"))
    monkeypatch.setattr(system_routes.Path, "home", lambda: tmp_path / "home")
    monkeypatch.setattr(system_routes, "_active_python_script_dirs", lambda: [])
    monkeypatch.setattr(system_routes, "_python_user_script_dirs", lambda: [])

    assert Path(system_routes._find_codex() or "") == codex_exe


def test_find_openclaw_checks_windows_portable_node_prefix(monkeypatch, tmp_path):
    if system_routes.os.name != "nt":
        return

    portable_node = tmp_path / "LocalAppData" / "OpenClaw" / "deps" / "portable-node"
    portable_node.mkdir(parents=True)
    openclaw_cmd = portable_node / "openclaw.cmd"
    openclaw_cmd.write_text("@echo off\n", encoding="utf-8")

    monkeypatch.setenv("PATH", "")
    monkeypatch.setenv("APPDATA", str(tmp_path / "Roaming"))
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "LocalAppData"))
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setenv("USERPROFILE", str(tmp_path / "home"))
    monkeypatch.setattr(system_routes.Path, "home", lambda: tmp_path / "home")
    monkeypatch.setattr(system_routes, "_active_python_script_dirs", lambda: [])
    monkeypatch.setattr(system_routes, "_python_user_script_dirs", lambda: [])

    assert Path(system_routes._find_openclaw() or "") == openclaw_cmd
