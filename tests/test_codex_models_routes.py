from __future__ import annotations

import asyncio
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


class FakeStdout:
    def __init__(self, queue: asyncio.Queue[bytes]):
        self._queue = queue

    async def readline(self) -> bytes:
        return await self._queue.get()


class FakeStdin:
    def __init__(
        self,
        queue: asyncio.Queue[bytes],
        sent_messages: list[dict],
        *,
        model_list_result: dict | None = None,
        model_list_error: str | None = None,
    ):
        self._queue = queue
        self._sent_messages = sent_messages
        self._model_list_result = model_list_result or {}
        self._model_list_error = model_list_error

    def write(self, payload: bytes) -> None:
        message = json.loads(payload.decode("utf-8"))
        self._sent_messages.append(message)
        method = message.get("method")
        if method == "initialize":
            self._queue.put_nowait(
                json.dumps({"id": message["id"], "result": {"serverInfo": {"name": "codex"}}}).encode("utf-8") + b"\n"
            )
        elif method == "model/list":
            if self._model_list_error:
                self._queue.put_nowait(
                    json.dumps({"id": message["id"], "error": {"code": -32601, "message": self._model_list_error}}).encode("utf-8")
                    + b"\n"
                )
                return
            self._queue.put_nowait(json.dumps({"id": message["id"], "result": self._model_list_result}).encode("utf-8") + b"\n")

    async def drain(self) -> None:
        return None


class FakeStderr:
    async def read(self) -> bytes:
        return b""


class FakeModelListProcess:
    def __init__(
        self,
        sent_messages: list[dict],
        *,
        model_list_result: dict | None = None,
        model_list_error: str | None = None,
    ):
        self.returncode = None
        self._queue: asyncio.Queue[bytes] = asyncio.Queue()
        self.stdin = FakeStdin(
            self._queue,
            sent_messages,
            model_list_result=model_list_result,
            model_list_error=model_list_error,
        )
        self.stdout = FakeStdout(self._queue)
        self.stderr = FakeStderr()

    def terminate(self) -> None:
        self.returncode = 0

    def kill(self) -> None:
        self.returncode = -9

    async def wait(self) -> int:
        return self.returncode if self.returncode is not None else 0


class FakeDebugModelsProcess:
    def __init__(self, *, stdout_payload: dict, returncode: int = 0):
        self.returncode = returncode
        self._stdout_payload = stdout_payload

    async def communicate(self):
        return json.dumps(self._stdout_payload).encode("utf-8"), b""

    def kill(self) -> None:
        self.returncode = -9

    async def wait(self) -> int:
        return self.returncode


def _model_list_catalog() -> dict:
    return {
        "models": [
            {
                "id": "gpt-5.5",
                "model": "gpt-5.5",
                "displayName": "GPT-5.5",
                "isDefault": True,
                "defaultReasoningEffort": "medium",
                "supportedReasoningEfforts": ["low", "medium", "high", "xhigh"],
                "serviceTiers": [
                    {"id": "priority", "name": "Fast", "description": "1.5x speed, increased usage"},
                ],
                "baseInstructions": "must not be returned",
            },
            {
                "id": "gpt-5.4-mini",
                "model": "gpt-5.4-mini",
                "displayName": "GPT-5.4-Mini",
                "isDefault": False,
                "defaultReasoningEffort": "medium",
                "supportedReasoningEfforts": ["low", "medium", "high"],
                "serviceTiers": [],
            },
        ]
    }


def test_codex_models_route_reads_app_server_catalog(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sent_messages: list[dict] = []
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)

    async def fake_create_subprocess_exec(*args, **kwargs):
        assert list(args) == [codex_path, "app-server"]
        assert kwargs.get("stdin") == system_routes.asyncio.subprocess.PIPE
        return FakeModelListProcess(sent_messages, model_list_result=_model_list_catalog())

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    client = TestClient(app)

    response = client.get("/api/system/codex/models")

    assert response.status_code == 200
    data = response.json()
    assert data["installed"] is True
    assert data["status"] == "ready"
    assert data["source"] == "app_server"
    assert data["models"] == [
        {
            "id": "gpt-5.5",
            "model": "gpt-5.5",
            "display_name": "GPT-5.5",
            "is_default": True,
            "default_reasoning_effort": "medium",
            "supported_reasoning_efforts": ["low", "medium", "high", "xhigh"],
            "service_tiers": [
                {"id": "standard", "name": "Standard", "description": "Default speed", "service_tier": None},
                {"id": "priority", "name": "Fast", "description": "1.5x speed, increased usage", "service_tier": "priority"},
            ],
        },
        {
            "id": "gpt-5.4-mini",
            "model": "gpt-5.4-mini",
            "display_name": "GPT-5.4-Mini",
            "is_default": False,
            "default_reasoning_effort": "medium",
            "supported_reasoning_efforts": ["low", "medium", "high"],
            "service_tiers": [{"id": "standard", "name": "Standard", "description": "Default speed", "service_tier": None}],
        },
    ]
    assert "baseInstructions" not in json.dumps(data)
    assert [message.get("method") for message in sent_messages] == ["initialize", "initialized", "model/list"]
    assert sent_messages[-1]["params"] == {"includeHidden": False, "limit": 100}


def test_codex_models_route_falls_back_to_debug_models(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sent_messages: list[dict] = []
    commands: list[list[str]] = []
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)

    async def fake_create_subprocess_exec(*args, **_kwargs):
        commands.append(list(args))
        if list(args) == [codex_path, "app-server"]:
            return FakeModelListProcess(sent_messages, model_list_error="method not found")
        if list(args) == [codex_path, "debug", "models", "--bundled"]:
            return FakeDebugModelsProcess(
                stdout_payload={
                    "models": [
                        {
                            "slug": "gpt-5.4",
                            "name": "GPT-5.4",
                            "is_default": False,
                            "default_reasoning_effort": "medium",
                            "supported_reasoning_efforts": ["low", "medium", "high", "xhigh"],
                            "service_tiers": [{"id": "priority", "name": "Fast"}],
                        }
                    ]
                }
            )
        raise AssertionError(f"unexpected command: {args}")

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    client = TestClient(app)

    response = client.get("/api/system/codex/models")

    assert response.status_code == 200
    data = response.json()
    assert data["installed"] is True
    assert data["status"] == "ready"
    assert data["source"] == "debug_models"
    assert data["models"][0]["id"] == "gpt-5.4"
    assert data["models"][0]["service_tiers"][1] == {
        "id": "priority",
        "name": "Fast",
        "description": None,
        "service_tier": "priority",
    }
    assert commands == [[codex_path, "app-server"], [codex_path, "debug", "models", "--bundled"]]


def test_codex_models_route_reports_missing_cli(monkeypatch):
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: None)
    client = TestClient(app)

    response = client.get("/api/system/codex/models")

    assert response.status_code == 200
    assert response.json() == {
        "installed": False,
        "status": "missing",
        "source": None,
        "models": [],
        "message": "",
        "error": "codex executable not found",
    }
