from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from xsafeclaw.api.main import app
from xsafeclaw.api.routes import system as system_routes


@pytest.fixture(autouse=True)
def _reset_codex_probe_cache():
    system_routes._codex_probe_cache = None
    yield
    system_routes._codex_probe_cache = None


class FakeProcess:
    def __init__(self, args, *, returncode: int, stdout: bytes = b"", stderr: bytes = b""):
        self.args = args
        self.returncode = returncode
        self._stdout = stdout
        self._stderr = stderr

    async def communicate(self):
        return self._stdout, self._stderr


def _client_with_codex(monkeypatch: pytest.MonkeyPatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)
    return TestClient(app), codex_path


def test_codex_auth_status_reports_chatgpt_login(monkeypatch, tmp_path):
    client, codex_path = _client_with_codex(monkeypatch, tmp_path)

    async def fake_create_subprocess_exec(*args, **_kwargs):
        assert list(args)[-2:] == ["login", "status"]
        return FakeProcess(args, returncode=0, stdout=b"Logged in using ChatGPT\n")

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    response = client.get("/api/system/codex/auth/status")

    assert response.status_code == 200
    data = response.json()
    assert data == {
        "installed": True,
        "logged_in": True,
        "auth_mode": "chatgpt",
        "status": "logged_in",
        "codex_path": codex_path,
        "message": "Logged in using ChatGPT",
        "error": None,
    }


def test_codex_auth_status_reports_logged_out(monkeypatch, tmp_path):
    client, codex_path = _client_with_codex(monkeypatch, tmp_path)

    async def fake_create_subprocess_exec(*args, **_kwargs):
        assert list(args)[-2:] == ["login", "status"]
        return FakeProcess(args, returncode=1, stderr=b"Not logged in\n")

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    response = client.get("/api/system/codex/auth/status")

    assert response.status_code == 200
    data = response.json()
    assert data["installed"] is True
    assert data["logged_in"] is False
    assert data["auth_mode"] is None
    assert data["status"] == "logged_out"
    assert data["codex_path"] == codex_path
    assert data["message"] == "Not logged in"
    assert data["error"] is None


def test_codex_auth_login_runs_cli_refreshes_status_and_clears_cache(monkeypatch, tmp_path):
    client, _codex_path = _client_with_codex(monkeypatch, tmp_path)
    system_routes._codex_probe_cache = (123.0, "old", {"status": "ready"})
    seen_commands: list[list[str]] = []

    async def fake_create_subprocess_exec(*args, **kwargs):
        command = list(args)
        seen_commands.append(command)
        env = kwargs.get("env") or {}
        if command[-1] == "login":
            assert env.get("CI") is None
            return FakeProcess(args, returncode=0, stdout=b"Login successful\n")
        if command[-2:] == ["login", "status"]:
            return FakeProcess(args, returncode=0, stdout=b"Logged in using ChatGPT\n")
        raise AssertionError(f"unexpected command: {command}")

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    response = client.post("/api/system/codex/auth/login")

    assert response.status_code == 200
    assert [cmd[-1] for cmd in seen_commands] == ["login", "status"]
    assert response.json()["logged_in"] is True
    assert response.json()["auth_mode"] == "chatgpt"
    assert system_routes._codex_probe_cache is None


def test_codex_auth_logout_runs_cli_refreshes_status_and_clears_cache(monkeypatch, tmp_path):
    client, _codex_path = _client_with_codex(monkeypatch, tmp_path)
    system_routes._codex_probe_cache = (123.0, "old", {"status": "ready"})
    seen_commands: list[list[str]] = []

    async def fake_create_subprocess_exec(*args, **_kwargs):
        command = list(args)
        seen_commands.append(command)
        if command[-1] == "logout":
            return FakeProcess(args, returncode=0, stdout=b"Logged out\n")
        if command[-2:] == ["login", "status"]:
            return FakeProcess(args, returncode=1, stderr=b"Not logged in\n")
        raise AssertionError(f"unexpected command: {command}")

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    response = client.post("/api/system/codex/auth/logout")

    assert response.status_code == 200
    assert [cmd[-1] for cmd in seen_commands] == ["logout", "status"]
    assert response.json()["logged_in"] is False
    assert response.json()["status"] == "logged_out"
    assert system_routes._codex_probe_cache is None


def test_codex_auth_status_missing_cli(monkeypatch):
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: None)
    client = TestClient(app)

    response = client.get("/api/system/codex/auth/status")

    assert response.status_code == 200
    assert response.json() == {
        "installed": False,
        "logged_in": False,
        "auth_mode": None,
        "status": "missing",
        "codex_path": None,
        "message": "",
        "error": "codex executable not found",
    }


def test_codex_auth_login_missing_cli_returns_displayable_error(monkeypatch):
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: None)
    client = TestClient(app)

    response = client.post("/api/system/codex/auth/login")

    assert response.status_code == 404
    assert response.json()["detail"] == "codex executable not found"


def test_codex_runtime_status_reports_doctor_details(monkeypatch, tmp_path):
    client, entry_path = _client_with_codex(monkeypatch, tmp_path)
    executable_path = str(tmp_path / "vendor" / "codex.exe")
    doctor_payload = {
        "codexVersion": "0.139.0",
        "overallStatus": "ok",
        "checks": {
            "installation": {
                "status": "ok",
                "details": {
                    "current executable": executable_path,
                    "install context": "npm",
                },
            },
            "auth.credentials": {
                "status": "ok",
                "summary": "Authenticated using ChatGPT",
            },
        },
    }

    async def fake_create_subprocess_exec(*args, **_kwargs):
        command = list(args)
        if command[-1] == "--version":
            return FakeProcess(args, returncode=0, stdout=b"codex-cli 0.139.0\n")
        if command[-3:] == ["doctor", "--json", "--summary"]:
            return FakeProcess(args, returncode=0, stdout=json.dumps(doctor_payload).encode("utf-8"))
        raise AssertionError(f"unexpected command: {command}")

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    response = client.get("/api/system/codex/runtime")

    assert response.status_code == 200
    assert response.json() == {
        "installed": True,
        "configured": True,
        "status": "ready",
        "version": "0.139.0",
        "path": executable_path,
        "entry_path": entry_path,
        "install_context": "npm",
        "warnings": [],
        "error": None,
    }


def test_codex_runtime_status_missing_cli(monkeypatch):
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: None)
    client = TestClient(app)

    response = client.get("/api/system/codex/runtime")

    assert response.status_code == 200
    assert response.json() == {
        "installed": False,
        "configured": False,
        "status": "missing",
        "version": None,
        "path": None,
        "entry_path": None,
        "install_context": None,
        "warnings": [],
        "error": "codex executable not found",
    }


def test_codex_runtime_status_falls_back_when_doctor_fails(monkeypatch, tmp_path):
    client, entry_path = _client_with_codex(monkeypatch, tmp_path)

    async def fake_create_subprocess_exec(*args, **_kwargs):
        command = list(args)
        if command[-1] == "--version":
            return FakeProcess(args, returncode=0, stdout=b"codex-cli 0.139.0\n")
        if command[-3:] == ["doctor", "--json", "--summary"]:
            return FakeProcess(args, returncode=1, stderr=b"doctor failed\n")
        raise AssertionError(f"unexpected command: {command}")

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    response = client.get("/api/system/codex/runtime")

    assert response.status_code == 200
    data = response.json()
    assert data["installed"] is True
    assert data["configured"] is False
    assert data["status"] == "installed"
    assert data["version"] == "0.139.0"
    assert data["path"] == entry_path
    assert data["entry_path"] == entry_path
    assert data["install_context"] is None
    assert data["error"] is None
    assert data["warnings"] == ["doctor failed"]


def test_codex_runtime_refresh_invalidates_probe_cache(monkeypatch, tmp_path):
    client, entry_path = _client_with_codex(monkeypatch, tmp_path)
    system_routes._codex_probe_cache = (123.0, entry_path, {"status": "ready", "version": "old"})
    commands: list[list[str]] = []
    doctor_payload = {
        "codexVersion": "0.140.0",
        "overallStatus": "ok",
        "checks": {
            "installation": {
                "status": "ok",
                "details": {"current executable": entry_path},
            },
            "auth.credentials": {"status": "ok"},
        },
    }

    async def fake_create_subprocess_exec(*args, **_kwargs):
        command = list(args)
        commands.append(command)
        if command[-1] == "--version":
            return FakeProcess(args, returncode=0, stdout=b"codex-cli 0.140.0\n")
        if command[-3:] == ["doctor", "--json", "--summary"]:
            return FakeProcess(args, returncode=0, stdout=json.dumps(doctor_payload).encode("utf-8"))
        raise AssertionError(f"unexpected command: {command}")

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    response = client.get("/api/system/codex/runtime?refresh=true")

    assert response.status_code == 200
    assert response.json()["version"] == "0.140.0"
    assert [command[-1] for command in commands] == ["--version", "--summary"]
