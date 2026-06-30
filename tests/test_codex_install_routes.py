from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from xsafeclaw.api.main import app
from xsafeclaw.api.routes import system as system_routes


@pytest.fixture(autouse=True)
def _reset_codex_probe_cache():
    system_routes._codex_probe_cache = None
    yield
    system_routes._codex_probe_cache = None


class FakeInstallStdout:
    def __init__(self, lines: list[str]):
        self._lines = [line.encode("utf-8") + b"\n" for line in lines]

    async def readline(self) -> bytes:
        if self._lines:
            return self._lines.pop(0)
        return b""


class FakeInstallProcess:
    def __init__(self, returncode: int = 0, lines: list[str] | None = None):
        self.returncode = returncode
        self.stdout = FakeInstallStdout(lines or ["installer output"])

    async def wait(self) -> int:
        return self.returncode


def _sse_events(body: str) -> list[dict]:
    events: list[dict] = []
    for part in body.split("\n\n"):
        line = part.strip()
        if not line.startswith("data:"):
            continue
        events.append(json.loads(line.removeprefix("data:").strip()))
    return events


def test_codex_install_windows_downloads_official_script_and_verifies(monkeypatch, tmp_path):
    calls: list[dict] = []
    local_appdata = tmp_path / "LocalAppData"
    monkeypatch.setenv("LOCALAPPDATA", str(local_appdata))
    monkeypatch.setattr(system_routes, "_host_is_windows", lambda: True)

    def fake_which(name: str, path: str | None = None) -> str | None:
        lowered = name.lower()
        if lowered == "curl.exe":
            return "C:/Windows/System32/curl.exe"
        if lowered in {"pwsh", "powershell"}:
            return f"C:/Windows/System32/{name}.exe"
        return None

    monkeypatch.setattr(system_routes.shutil, "which", fake_which)

    async def fake_create_subprocess_exec(*args, stdout=None, stderr=None, stdin=None, env=None, cwd=None):
        calls.append({"args": list(args), "env": dict(env or {})})
        return FakeInstallProcess(lines=[f"ran {Path(str(args[0])).name}"])

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    find_envs: list[dict] = []

    def fake_find_codex(*, env=None):
        find_envs.append(dict(env or {}))
        return str(local_appdata / "Programs" / "OpenAI" / "Codex" / "bin" / "codex.exe")

    probe_calls: list[dict] = []

    async def fake_probe_codex_install_async(codex_path, *, env=None, **kwargs):
        probe_calls.append({"codex_path": codex_path, "env": dict(env or {})})
        return {
            "installed": True,
            "configured": True,
            "version": "0.139.0",
            "path": codex_path,
            "entry_path": codex_path,
            "install_context": None,
            "status": "ready",
            "error": None,
            "warnings": [],
        }

    monkeypatch.setattr(system_routes, "_find_codex", fake_find_codex)
    monkeypatch.setattr(system_routes, "_probe_codex_install_async", fake_probe_codex_install_async)

    response = TestClient(app).post("/api/system/codex/install")

    assert response.status_code == 200
    events = _sse_events(response.text)
    assert events[-1]["type"] == "done"
    assert events[-1]["success"] is True
    assert events[-1]["version"] == "0.139.0"
    assert calls[0]["args"][0].endswith("curl.exe")
    assert "https://chatgpt.com/codex/install.ps1" in calls[0]["args"]
    assert "-o" in calls[0]["args"]
    assert any("install.ps1" in str(arg) for arg in calls[0]["args"])
    assert calls[1]["args"][0].lower().endswith(("powershell.exe", "pwsh.exe"))
    assert "-File" in calls[1]["args"]
    assert calls[1]["env"]["CODEX_NON_INTERACTIVE"] == "1"
    expected_bin = str(local_appdata / "Programs" / "OpenAI" / "Codex" / "bin")
    assert any(expected_bin in env.get("PATH", "") for env in find_envs)
    assert probe_calls


def test_codex_install_linux_uses_wget_when_curl_is_missing(monkeypatch):
    calls: list[dict] = []
    monkeypatch.setattr(system_routes, "_host_is_windows", lambda: False)
    monkeypatch.setattr(system_routes, "_host_platform", lambda: "linux")

    def fake_which(name: str, path: str | None = None) -> str | None:
        if name == "wget":
            return "/usr/bin/wget"
        if name == "sh":
            return "/bin/sh"
        return None

    monkeypatch.setattr(system_routes.shutil, "which", fake_which)

    async def fake_create_subprocess_exec(*args, stdout=None, stderr=None, stdin=None, env=None, cwd=None):
        calls.append({"args": list(args), "env": dict(env or {})})
        return FakeInstallProcess(lines=["installed with wget"])

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: "/home/user/.local/bin/codex")

    async def fake_probe_codex_install_async(codex_path, *, env=None, **kwargs):
        return {
            "installed": True,
            "configured": False,
            "version": "0.139.0",
            "path": codex_path,
            "entry_path": codex_path,
            "install_context": None,
            "status": "installed",
            "error": None,
            "warnings": [],
        }

    monkeypatch.setattr(system_routes, "_probe_codex_install_async", fake_probe_codex_install_async)

    response = TestClient(app).post("/api/system/codex/install")

    assert response.status_code == 200
    events = _sse_events(response.text)
    assert events[-1]["type"] == "done"
    assert events[-1]["success"] is True
    assert calls[0]["args"] == [
        "/bin/sh",
        "-c",
        "wget -qO- https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh",
    ]
    assert calls[0]["env"]["CODEX_NON_INTERACTIVE"] == "1"


def test_codex_install_reports_missing_unix_downloader(monkeypatch):
    monkeypatch.setattr(system_routes, "_host_is_windows", lambda: False)
    monkeypatch.setattr(system_routes, "_host_platform", lambda: "linux")
    monkeypatch.setattr(system_routes.shutil, "which", lambda name, path=None: "/bin/sh" if name == "sh" else None)

    response = TestClient(app).post("/api/system/codex/install")

    assert response.status_code == 200
    events = _sse_events(response.text)
    assert events[-1]["type"] == "error"
    assert "curl or wget" in events[-1]["message"]
