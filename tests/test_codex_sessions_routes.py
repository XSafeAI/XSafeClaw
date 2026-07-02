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
        thread_list_error: str | None = None,
        thread_read_error: str | None = None,
        thread_read_result: dict | None = None,
        thread_lists_by_source: dict[str, list[dict]] | None = None,
    ):
        self._queue = queue
        self._sent_messages = sent_messages
        self._thread_list_error = thread_list_error
        self._thread_read_error = thread_read_error
        self._thread_read_result = thread_read_result
        self._thread_lists_by_source = thread_lists_by_source or {}

    def write(self, payload: bytes) -> None:
        message = json.loads(payload.decode("utf-8"))
        self._sent_messages.append(message)
        method = message.get("method")
        if method == "initialize":
            self._queue.put_nowait(json.dumps({"id": message["id"], "result": {"serverInfo": {"name": "codex"}}}).encode("utf-8") + b"\n")
        elif method == "thread/list":
            if self._thread_list_error:
                self._queue.put_nowait(
                    json.dumps({"id": message["id"], "error": {"code": -32000, "message": self._thread_list_error}}).encode("utf-8")
                    + b"\n"
                )
                return
            source_kinds = (((message.get("params") or {}).get("sourceKinds")) or [])
            source_kind = source_kinds[0] if source_kinds else "cli"
            threads = self._thread_lists_by_source.get(source_kind)
            if threads is None:
                threads = [
                    {
                        "id": "thread-123456789",
                        "sessionId": "session-abc",
                        "name": "Investigate Codex history",
                        "preview": "Opened a repo and checked tests",
                        "cwd": "E:/work/project",
                        "createdAt": 1781524800,
                        "updatedAt": 1781528400,
                        "status": {"type": "idle"},
                        "source": {"kind": "cli"},
                        "path": "C:/Users/heng/.codex/sessions/2026/06/15/thread.jsonl",
                        "cliVersion": "0.139.0",
                        "turns": [{"role": "user", "text": "must not leak"}],
                    }
                ] if source_kind == "cli" else []
            self._queue.put_nowait(
                json.dumps({
                    "id": message["id"],
                    "result": {
                        "threads": threads,
                        "nextCursor": "cursor-2" if source_kind == "cli" else None,
                    },
                }).encode("utf-8")
                + b"\n"
            )
        elif method == "thread/read":
            if self._thread_read_error:
                self._queue.put_nowait(
                    json.dumps({"id": message["id"], "error": {"code": -32000, "message": self._thread_read_error}}).encode("utf-8")
                    + b"\n"
                )
                return
            self._queue.put_nowait(
                json.dumps(
                    {
                        "id": message["id"],
                        "result": self._thread_read_result
                        or {
                            "thread": {
                                "id": "thread-123456789",
                                "sessionId": "session-abc",
                                "preview": "Opened a repo and checked tests",
                                "cwd": "E:/work/project",
                                "createdAt": 1781524800,
                                "updatedAt": 1781528400,
                                "status": {"type": "idle"},
                                "source": {"kind": "cli"},
                                "path": "C:/Users/heng/.codex/sessions/2026/06/15/thread.jsonl",
                                "cliVersion": "0.139.0",
                                "turns": [
                                    {
                                        "id": "turn-1",
                                        "status": {"type": "completed"},
                                        "startedAt": 1781524800,
                                        "completedAt": 1781524810,
                                        "durationMs": 10000,
                                        "items": [
                                            {
                                                "type": "userMessage",
                                                "id": "user-1",
                                                "clientId": "client-user-1",
                                                "content": [
                                                    {"type": "text", "text": "检查当前登录情况", "text_elements": []},
                                                    {"type": "localImage", "path": "C:/tmp/login.png"},
                                                ],
                                            },
                                            {
                                                "type": "reasoning",
                                                "id": "reasoning-1",
                                                "summary": ["我会读取登录状态并解释结果。"],
                                                "content": ["raw reasoning content must not be returned"],
                                            },
                                            {
                                                "type": "commandExecution",
                                                "id": "command-1",
                                                "command": "codex login status",
                                                "cwd": "E:/work/project",
                                                "processId": None,
                                                "source": {"type": "agent"},
                                                "status": "completed",
                                                "commandActions": [{"type": "unknown", "command": "codex login status"}],
                                                "aggregatedOutput": "Logged in using ChatGPT",
                                                "exitCode": 0,
                                                "durationMs": 321,
                                            },
                                            {
                                                "type": "fileChange",
                                                "id": "file-change-1",
                                                "changes": [
                                                    {
                                                        "path": "frontend/src/pages/RuntimeGuardConsole.tsx",
                                                        "kind": "update",
                                                        "diff": "@@ -1 +1 @@\n-old\n+new",
                                                    }
                                                ],
                                                "status": "completed",
                                            },
                                            {
                                                "type": "agentMessage",
                                                "id": "assistant-1",
                                                "text": "当前已经通过 ChatGPT 登录。",
                                                "phase": None,
                                                "memoryCitation": None,
                                            },
                                        ],
                                    }
                                ],
                            }
                        },
                    }
                ).encode("utf-8")
                + b"\n"
            )
        elif method == "thread/archive":
            self._queue.put_nowait(
                json.dumps({"id": message["id"], "result": {"archived": True}}).encode("utf-8")
                + b"\n"
            )

    async def drain(self) -> None:
        return None


class FakeAppServerStderr:
    async def read(self) -> bytes:
        return b"state db codex_home mismatch warning\n"


class FakeAppServerProcess:
    def __init__(
        self,
        sent_messages: list[dict],
        *,
        thread_list_error: str | None = None,
        thread_read_error: str | None = None,
        thread_read_result: dict | None = None,
        thread_lists_by_source: dict[str, list[dict]] | None = None,
    ):
        self.returncode = None
        self._queue: asyncio.Queue[bytes] = asyncio.Queue()
        self.stdin = FakeAppServerStdin(
            self._queue,
            sent_messages,
            thread_list_error=thread_list_error,
            thread_read_error=thread_read_error,
            thread_read_result=thread_read_result,
            thread_lists_by_source=thread_lists_by_source,
        )
        self.stdout = FakeAppServerStdout(self._queue)
        self.stderr = FakeAppServerStderr()
        self.terminated = False
        self.killed = False

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = 0

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9

    async def wait(self) -> int:
        return self.returncode if self.returncode is not None else 0


def test_codex_sessions_route_lists_cli_thread_summaries(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sent_messages: list[dict] = []
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)

    async def fake_create_subprocess_exec(*args, **kwargs):
        assert list(args) == [codex_path, "app-server"]
        assert kwargs.get("stdin") == system_routes.asyncio.subprocess.PIPE
        return FakeAppServerProcess(sent_messages)

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    client = TestClient(app)

    response = client.get("/api/system/codex/sessions?limit=50&cursor=abc")

    assert response.status_code == 200
    data = response.json()
    assert data["installed"] is True
    assert data["status"] == "ready"
    assert data["next_cursor"] == "cursor-2"
    assert data["error"] is None
    assert data["sessions"] == [
        {
            "id": "thread-123456789",
            "session_id": "session-abc",
            "title": "Investigate Codex history",
            "preview": "Opened a repo and checked tests",
            "cwd": "E:/work/project",
            "created_at": "2026-06-15T12:00:00Z",
            "updated_at": "2026-06-15T13:00:00Z",
            "status": "idle",
            "source": "cli",
            "originator": None,
            "history_kind": "cli",
            "deletable": True,
            "path": "C:/Users/heng/.codex/sessions/2026/06/15/thread.jsonl",
            "cli_version": "0.139.0",
        }
    ]
    assert "turns" not in data["sessions"][0]

    thread_list_messages = [message for message in sent_messages if message.get("method") == "thread/list"]
    assert [message["params"]["sourceKinds"] for message in thread_list_messages] == [["cli"], ["vscode"]]
    assert thread_list_messages[0]["params"] == {
        "sourceKinds": ["cli"],
        "archived": False,
        "limit": 50,
        "cursor": "abc",
        "sortKey": "updated_at",
        "sortDirection": "desc",
    }


def test_codex_sessions_route_includes_only_xsafeclaw_vscode_history(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sessions_root = tmp_path / ".codex" / "sessions"
    xsafeclaw_rollout = sessions_root / "2026" / "06" / "15" / "rollout-thread-xsafeclaw-123.jsonl"
    other_rollout = sessions_root / "2026" / "06" / "15" / "rollout-thread-vscode-other-123.jsonl"
    xsafeclaw_rollout.parent.mkdir(parents=True)
    xsafeclaw_rollout.write_text(
        json.dumps({"type": "session_meta", "payload": {"originator": "XSafeClaw", "source": "vscode"}}) + "\n",
        encoding="utf-8",
    )
    other_rollout.write_text(
        json.dumps({"type": "session_meta", "payload": {"originator": "Codex App", "source": "vscode"}}) + "\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)
    monkeypatch.setattr(system_routes, "_codex_session_history_roots", lambda: [sessions_root])
    sent_messages: list[dict] = []

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return FakeAppServerProcess(
            sent_messages,
            thread_lists_by_source={
                "cli": [],
                "vscode": [
                    {
                        "id": "thread-xsafeclaw-123",
                        "sessionId": "session-xsafeclaw",
                        "name": "",
                        "preview": "Create matrix transpose helper",
                        "cwd": "C:/Users/heng/Desktop/test",
                        "createdAt": 1781524800,
                        "updatedAt": 1781528400,
                        "status": {"type": "idle"},
                        "source": {"kind": "vscode"},
                        "path": str(xsafeclaw_rollout),
                    },
                    {
                        "id": "thread-vscode-other-123",
                        "sessionId": "session-other",
                        "preview": "Do not show this IDE thread",
                        "createdAt": 1781524800,
                        "updatedAt": 1781528500,
                        "status": {"type": "idle"},
                        "source": {"kind": "vscode"},
                        "path": str(other_rollout),
                    },
                ],
            },
        )

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    response = TestClient(app).get("/api/system/codex/sessions")

    assert response.status_code == 200
    data = response.json()
    assert [session["id"] for session in data["sessions"]] == ["thread-xsafeclaw-123"]
    assert data["sessions"][0]["source"] == "vscode"
    assert data["sessions"][0]["originator"] == "XSafeClaw"
    assert data["sessions"][0]["history_kind"] == "xsafeclaw"
    assert data["sessions"][0]["deletable"] is True


def test_codex_sessions_route_reports_missing_cli(monkeypatch):
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: None)
    client = TestClient(app)

    response = client.get("/api/system/codex/sessions")

    assert response.status_code == 200
    assert response.json() == {
        "installed": False,
        "status": "missing",
        "sessions": [],
        "next_cursor": None,
        "message": "",
        "error": "codex executable not found",
    }


def test_codex_sessions_route_reports_app_server_error(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return FakeAppServerProcess([], thread_list_error="thread list failed")

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    client = TestClient(app)

    response = client.get("/api/system/codex/sessions")

    assert response.status_code == 200
    data = response.json()
    assert data["installed"] is True
    assert data["status"] == "error"
    assert data["sessions"] == []
    assert data["error"] == "thread list failed"


def test_codex_session_messages_route_reads_thread_turns(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sent_messages: list[dict] = []
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)

    async def fake_create_subprocess_exec(*args, **kwargs):
        assert list(args) == [codex_path, "app-server"]
        assert kwargs.get("stdin") == system_routes.asyncio.subprocess.PIPE
        return FakeAppServerProcess(sent_messages)

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    client = TestClient(app)

    response = client.get("/api/system/codex/sessions/thread-123456789/messages")

    assert response.status_code == 200
    data = response.json()
    assert data["installed"] is True
    assert data["status"] == "ready"
    assert data["thread_id"] == "thread-123456789"
    assert data["error"] is None
    assert data["messages"] == [
        {
            "id": "user-1",
            "role": "user",
            "content": "检查当前登录情况\n[local image: C:/tmp/login.png]",
            "timestamp": "2026-06-15T12:00:00Z",
        },
        {
            "id": "reasoning-1",
            "role": "trace",
            "content": "我会读取登录状态并解释结果。",
            "timestamp": "2026-06-15T12:00:00Z",
            "trace_type": "reasoning_summary",
            "trace_phase": "completed",
            "trace_summary": "Reasoning",
        },
        {
            "id": "command-1",
            "role": "tool_call",
            "content": "",
            "timestamp": "2026-06-15T12:00:00Z",
            "tool_id": "command-1",
            "tool_name": "Shell",
            "args": {
                "command": "codex login status",
                "cwd": "E:/work/project",
                "command_actions": [{"type": "unknown", "command": "codex login status"}],
            },
            "result": {
                "output": "Logged in using ChatGPT",
                "exit_code": 0,
                "duration_ms": 321,
            },
            "is_error": False,
            "result_pending": False,
            "tool_category": "shell",
            "tool_action": "execute",
            "timeline_kind": "shell_command",
        },
        {
            "id": "file-change-1",
            "role": "tool_call",
            "content": "",
            "timestamp": "2026-06-15T12:00:00Z",
            "tool_id": "file-change-1",
            "tool_name": "File Change",
            "args": {
                "changes": [
                    {
                        "path": "frontend/src/pages/RuntimeGuardConsole.tsx",
                        "kind": "update",
                        "diff": "@@ -1 +1 @@\n-old\n+new",
                    }
                ]
            },
            "result": {
                "changes": [
                    {
                        "path": "frontend/src/pages/RuntimeGuardConsole.tsx",
                        "kind": "update",
                        "diff": "@@ -1 +1 @@\n-old\n+new",
                    }
                ],
                "status": "completed",
            },
            "is_error": False,
            "result_pending": False,
            "tool_category": "file_system",
            "tool_action": "modify",
            "timeline_kind": "file_change",
        },
        {
            "id": "assistant-1",
            "role": "assistant",
            "content": "当前已经通过 ChatGPT 登录。",
            "timestamp": "2026-06-15T12:00:00Z",
        },
    ]
    assert "raw reasoning content must not be returned" not in json.dumps(data, ensure_ascii=False)

    thread_read_messages = [message for message in sent_messages if message.get("method") == "thread/read"]
    assert thread_read_messages == [
        {
            "id": 2,
            "method": "thread/read",
            "params": {
                "threadId": "thread-123456789",
                "includeTurns": True,
            },
        }
    ]


def test_codex_session_messages_route_reports_missing_cli(monkeypatch):
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: None)
    client = TestClient(app)

    response = client.get("/api/system/codex/sessions/thread-123/messages")

    assert response.status_code == 200
    assert response.json() == {
        "installed": False,
        "status": "missing",
        "thread_id": "thread-123",
        "messages": [],
        "message": "",
        "error": "codex executable not found",
    }


def test_codex_session_messages_route_reports_app_server_error(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return FakeAppServerProcess([], thread_read_error="thread read failed")

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    client = TestClient(app)

    response = client.get("/api/system/codex/sessions/thread-123/messages")

    assert response.status_code == 200
    data = response.json()
    assert data["installed"] is True
    assert data["status"] == "error"
    assert data["thread_id"] == "thread-123"
    assert data["messages"] == []
    assert data["error"] == "thread read failed"


def test_codex_session_delete_archives_cli_thread_and_removes_rollout(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sessions_root = tmp_path / ".codex" / "sessions"
    rollout_path = sessions_root / "2026" / "06" / "15" / "rollout-thread-delete-123.jsonl"
    rollout_path.parent.mkdir(parents=True)
    rollout_path.write_text("{}\n", encoding="utf-8")
    sent_messages: list[dict] = []
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)
    monkeypatch.setattr(system_routes, "_codex_session_history_roots", lambda: [sessions_root, tmp_path / ".codex" / "archived_sessions"])
    monkeypatch.setattr(system_routes, "_read_codex_deleted_thread_ids", lambda: set())
    deleted_tombstones: list[dict] = []
    monkeypatch.setattr(system_routes, "_write_codex_deleted_thread_tombstone", lambda payload: deleted_tombstones.append(payload))

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return FakeAppServerProcess(
            sent_messages,
            thread_read_result={
                "thread": {
                    "id": "thread-delete-123",
                    "sessionId": "session-delete",
                    "source": {"kind": "cli"},
                    "path": str(rollout_path),
                    "status": {"type": "idle"},
                }
            },
        )

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    response = TestClient(app).delete("/api/system/codex/sessions/thread-delete-123")

    assert response.status_code == 200
    data = response.json()
    assert data["thread_id"] == "thread-delete-123"
    assert data["archived"] is True
    assert data["deleted_file"] is True
    assert not rollout_path.exists()
    assert [message["method"] for message in sent_messages if "method" in message] == [
        "initialize",
        "initialized",
        "thread/read",
        "thread/archive",
    ]
    assert deleted_tombstones == [
        {
            "thread_id": "thread-delete-123",
            "source": "cli",
            "originator": None,
            "history_kind": "cli",
            "path": str(rollout_path),
        }
    ]


def test_codex_session_delete_allows_xsafeclaw_vscode_thread(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sessions_root = tmp_path / ".codex" / "sessions"
    rollout_path = sessions_root / "rollout-thread-vscode-123.jsonl"
    rollout_path.parent.mkdir(parents=True)
    rollout_path.write_text(
        json.dumps({"type": "session_meta", "payload": {"originator": "XSafeClaw", "source": "vscode"}}) + "\n",
        encoding="utf-8",
    )
    sent_messages: list[dict] = []
    tombstones: list[dict] = []
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)
    monkeypatch.setattr(system_routes, "_codex_session_history_roots", lambda: [sessions_root])
    monkeypatch.setattr(system_routes, "_write_codex_deleted_thread_tombstone", lambda payload: tombstones.append(payload))

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return FakeAppServerProcess(
            sent_messages,
            thread_read_result={
                "thread": {
                    "id": "thread-vscode-123",
                    "source": {"kind": "vscode"},
                    "path": str(rollout_path),
                }
            },
        )

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    response = TestClient(app).delete("/api/system/codex/sessions/thread-vscode-123")

    assert response.status_code == 200
    data = response.json()
    assert data["source"] == "vscode"
    assert data["originator"] == "XSafeClaw"
    assert data["history_kind"] == "xsafeclaw"
    assert data["deleted_file"] is True
    assert not rollout_path.exists()
    assert tombstones[0]["history_kind"] == "xsafeclaw"


def test_codex_session_delete_rejects_non_xsafeclaw_vscode_thread(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    rollout_path = tmp_path / ".codex" / "sessions" / "rollout-thread-vscode-123.jsonl"
    rollout_path.parent.mkdir(parents=True)
    rollout_path.write_text(
        json.dumps({"type": "session_meta", "payload": {"originator": "Codex App", "source": "vscode"}}) + "\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)
    monkeypatch.setattr(system_routes, "_codex_session_history_roots", lambda: [rollout_path.parent])

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return FakeAppServerProcess(
            [],
            thread_read_result={
                "thread": {
                    "id": "thread-vscode-123",
                    "source": {"kind": "vscode"},
                    "path": str(rollout_path),
                }
            },
        )

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    response = TestClient(app).delete("/api/system/codex/sessions/thread-vscode-123")

    assert response.status_code == 400
    assert "XSafeClaw" in response.json()["detail"]
    assert rollout_path.exists()
