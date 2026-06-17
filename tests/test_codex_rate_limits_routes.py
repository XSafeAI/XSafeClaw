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


class FakeAppServerStdout:
    def __init__(self, queue: asyncio.Queue[bytes]):
        self._queue = queue

    async def readline(self) -> bytes:
        return await self._queue.get()


class FakeAppServerStdin:
    def __init__(
        self,
        queue: asyncio.Queue[bytes],
        sent_messages: list[dict],
        *,
        rate_limits_result: dict | None = None,
        rate_limits_error: str | None = None,
    ):
        self._queue = queue
        self._sent_messages = sent_messages
        self._rate_limits_result = rate_limits_result or {}
        self._rate_limits_error = rate_limits_error

    def write(self, payload: bytes) -> None:
        message = json.loads(payload.decode("utf-8"))
        self._sent_messages.append(message)
        method = message.get("method")
        if method == "initialize":
            self._queue.put_nowait(
                json.dumps({"id": message["id"], "result": {"serverInfo": {"name": "codex"}}}).encode("utf-8") + b"\n"
            )
        elif method == "account/rateLimits/read":
            if self._rate_limits_error:
                self._queue.put_nowait(
                    json.dumps({"id": message["id"], "error": {"code": -32000, "message": self._rate_limits_error}}).encode("utf-8")
                    + b"\n"
                )
                return
            self._queue.put_nowait(
                json.dumps({"id": message["id"], "result": self._rate_limits_result}).encode("utf-8") + b"\n"
            )

    async def drain(self) -> None:
        return None


class FakeAppServerStderr:
    async def read(self) -> bytes:
        return b""


class FakeAppServerProcess:
    def __init__(
        self,
        sent_messages: list[dict],
        *,
        rate_limits_result: dict | None = None,
        rate_limits_error: str | None = None,
    ):
        self.returncode = None
        self._queue: asyncio.Queue[bytes] = asyncio.Queue()
        self.stdin = FakeAppServerStdin(
            self._queue,
            sent_messages,
            rate_limits_result=rate_limits_result,
            rate_limits_error=rate_limits_error,
        )
        self.stdout = FakeAppServerStdout(self._queue)
        self.stderr = FakeAppServerStderr()

    def terminate(self) -> None:
        self.returncode = 0

    def kill(self) -> None:
        self.returncode = -9

    async def wait(self) -> int:
        return self.returncode if self.returncode is not None else 0


def _rate_limit_snapshot(*, primary_duration: int = 300, secondary_duration: int = 10080) -> dict:
    windows = {
        300: {"usedPercent": 32, "windowDurationMins": 300, "resetsAt": 1781607727},
        10080: {"usedPercent": 45, "windowDurationMins": 10080, "resetsAt": 1781762114},
    }
    return {
        "rateLimits": {
            "limitId": "codex",
            "limitName": None,
            "planType": "pro",
            "rateLimitReachedType": None,
            "primary": windows[primary_duration],
            "secondary": windows[secondary_duration],
            "credits": {"hasCredits": False, "unlimited": False, "balance": "0"},
            "individualLimit": None,
        },
        "rateLimitsByLimitId": {
            "codex": {
                "limitId": "codex",
                "limitName": None,
                "planType": "pro",
                "rateLimitReachedType": None,
                "primary": windows[primary_duration],
                "secondary": windows[secondary_duration],
                "credits": {"hasCredits": False, "unlimited": False, "balance": "0"},
                "individualLimit": None,
            },
            "codex_bengalfox": {
                "limitId": "codex_bengalfox",
                "limitName": "GPT-5.3-Codex-Spark",
                "primary": {"usedPercent": 0, "windowDurationMins": 300, "resetsAt": 1781617903},
                "secondary": {"usedPercent": 0, "windowDurationMins": 10080, "resetsAt": 1782204703},
            },
        },
    }


def test_codex_rate_limits_route_reads_cli_rate_limit_windows(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sent_messages: list[dict] = []
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)

    async def fake_create_subprocess_exec(*args, **kwargs):
        assert list(args) == [codex_path, "app-server"]
        assert kwargs.get("stdin") == system_routes.asyncio.subprocess.PIPE
        return FakeAppServerProcess(sent_messages, rate_limits_result=_rate_limit_snapshot())

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    client = TestClient(app)

    response = client.get("/api/system/codex/rate-limits")

    assert response.status_code == 200
    data = response.json()
    assert data == {
        "installed": True,
        "status": "ready",
        "five_hour": {"remaining_percent": 68, "used_percent": 32, "resets_at": 1781607727},
        "seven_day": {"remaining_percent": 55, "used_percent": 45, "resets_at": 1781762114},
        "plan_type": "pro",
        "message": "",
        "error": None,
    }
    assert [message.get("method") for message in sent_messages] == [
        "initialize",
        "initialized",
        "account/rateLimits/read",
    ]


def test_codex_rate_limits_route_maps_windows_by_duration(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return FakeAppServerProcess([], rate_limits_result=_rate_limit_snapshot(primary_duration=10080, secondary_duration=300))

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    client = TestClient(app)

    response = client.get("/api/system/codex/rate-limits")

    assert response.status_code == 200
    data = response.json()
    assert data["five_hour"] == {"remaining_percent": 68, "used_percent": 32, "resets_at": 1781607727}
    assert data["seven_day"] == {"remaining_percent": 55, "used_percent": 45, "resets_at": 1781762114}


def test_codex_rate_limits_route_reports_missing_cli(monkeypatch):
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: None)
    client = TestClient(app)

    response = client.get("/api/system/codex/rate-limits")

    assert response.status_code == 200
    assert response.json() == {
        "installed": False,
        "status": "missing",
        "five_hour": {"remaining_percent": None, "used_percent": None, "resets_at": None},
        "seven_day": {"remaining_percent": None, "used_percent": None, "resets_at": None},
        "plan_type": None,
        "message": "",
        "error": "codex executable not found",
    }


def test_codex_rate_limits_route_reports_app_server_error(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return FakeAppServerProcess([], rate_limits_error="rate limits failed")

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    client = TestClient(app)

    response = client.get("/api/system/codex/rate-limits")

    assert response.status_code == 200
    assert response.json() == {
        "installed": True,
        "status": "error",
        "five_hour": {"remaining_percent": None, "used_percent": None, "resets_at": None},
        "seven_day": {"remaining_percent": None, "used_percent": None, "resets_at": None},
        "plan_type": None,
        "message": "",
        "error": "rate limits failed",
    }
