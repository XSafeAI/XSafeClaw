from __future__ import annotations

import asyncio
import json

from fastapi.testclient import TestClient

from xsafeclaw.api.main import app
from xsafeclaw.api.routes import system as system_routes
from xsafeclaw.services.codex_safety_prompt import CodexSafetyPromptError


class FakeConversationStdout:
    def __init__(self, queue: asyncio.Queue[bytes]):
        self._queue = queue

    async def readline(self) -> bytes:
        return await self._queue.get()


class FakeConversationStdin:
    def __init__(self, queue: asyncio.Queue[bytes], sent_messages: list[dict]):
        self._queue = queue
        self._sent_messages = sent_messages

    def write(self, payload: bytes) -> None:
        message = json.loads(payload.decode("utf-8"))
        self._sent_messages.append(message)
        method = message.get("method")
        if method == "initialize":
            self._queue.put_nowait(
                json.dumps({"id": message["id"], "result": {"serverInfo": {"name": "codex"}}}).encode("utf-8") + b"\n"
            )
        elif method == "thread/start":
            self._queue.put_nowait(
                json.dumps(
                    {
                        "id": message["id"],
                        "result": {
                            "thread": {
                                "id": "thread-started",
                                "sessionId": "session-started",
                                "name": "Codex",
                                "cwd": message.get("params", {}).get("cwd"),
                            }
                        },
                    }
                ).encode("utf-8")
                + b"\n"
            )
        elif method == "thread/resume":
            self._queue.put_nowait(
                json.dumps(
                    {
                        "id": message["id"],
                        "result": {
                            "thread": {
                                "id": message.get("params", {}).get("threadId"),
                                "sessionId": "session-resumed",
                                "name": "Restored Codex",
                                "cwd": message.get("params", {}).get("cwd"),
                            }
                        },
                    }
                ).encode("utf-8")
                + b"\n"
            )

    async def drain(self) -> None:
        return None


class FakeConversationStderr:
    async def read(self) -> bytes:
        return b""


class FakeConversationProcess:
    def __init__(self, sent_messages: list[dict]):
        self.returncode = None
        self._queue: asyncio.Queue[bytes] = asyncio.Queue()
        self.stdin = FakeConversationStdin(self._queue, sent_messages)
        self.stdout = FakeConversationStdout(self._queue)
        self.stderr = FakeConversationStderr()

    def terminate(self) -> None:
        self.returncode = 0

    def kill(self) -> None:
        self.returncode = -9

    async def wait(self) -> int:
        return self.returncode if self.returncode is not None else 0


class FakeTurnStdin(FakeConversationStdin):
    def __init__(
        self,
        queue: asyncio.Queue[bytes],
        sent_messages: list[dict],
        *,
        hook_command: str | None = None,
    ):
        super().__init__(queue, sent_messages)
        self._hook_command = hook_command or system_routes._codex_guard_hook_command("codex:thread-existing")

    def _remember_hook_command(self, message: dict) -> None:
        config = message.get("params", {}).get("config")
        try:
            self._hook_command = config["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
        except Exception:
            pass

    def _enqueue_hooks_list(self, message: dict) -> None:
        command = getattr(
            self,
            "_hook_command",
            "python -m xsafeclaw.integrations.codex_guard_hook --session-key codex:thread-existing",
        )
        self._queue.put_nowait(
            json.dumps(
                {
                    "id": message["id"],
                    "result": {
                        "data": [
                            {
                                "cwd": "E:/work/project",
                                "warnings": [],
                                "errors": [],
                                "hooks": [
                                    {
                                        "eventName": "preToolUse",
                                        "command": command,
                                        "source": "sessionFlags",
                                        "enabled": True,
                                        "trustStatus": "untrusted",
                                    },
                                    {
                                        "eventName": "permissionRequest",
                                        "command": command,
                                        "source": "sessionFlags",
                                        "enabled": True,
                                        "trustStatus": "untrusted",
                                    },
                                ],
                            }
                        ]
                    },
                }
            ).encode("utf-8")
            + b"\n"
        )

    def write(self, payload: bytes) -> None:
        message = json.loads(payload.decode("utf-8"))
        self._sent_messages.append(message)
        method = message.get("method")
        if method == "initialize":
            self._queue.put_nowait(
                json.dumps({"id": message["id"], "result": {"serverInfo": {"name": "codex"}}}).encode("utf-8") + b"\n"
            )
        elif method == "thread/start":
            self._remember_hook_command(message)
            self._queue.put_nowait(
                json.dumps(
                    {
                        "id": message["id"],
                        "result": {
                            "thread": {
                                "id": "thread-started",
                                "sessionId": "session-started",
                                "name": "Codex",
                                "cwd": message.get("params", {}).get("cwd"),
                            }
                        },
                    }
                ).encode("utf-8")
                + b"\n"
            )
        elif method == "thread/resume":
            self._remember_hook_command(message)
            self._queue.put_nowait(
                json.dumps(
                    {
                        "id": message["id"],
                        "result": {
                            "thread": {
                                "id": message.get("params", {}).get("threadId"),
                                "sessionId": "session-resumed",
                                "name": "Restored Codex",
                                "cwd": message.get("params", {}).get("cwd"),
                            }
                        },
                    }
                ).encode("utf-8")
                + b"\n"
            )
        elif method == "hooks/list":
            self._enqueue_hooks_list(message)
        elif method == "turn/start":
            thread_id = message.get("params", {}).get("threadId") or "thread-existing"
            self._queue.put_nowait(
                json.dumps(
                    {
                        "id": message["id"],
                        "result": {
                            "turn": {
                                "id": "turn-1",
                                "status": "running",
                            }
                        },
                    }
                ).encode("utf-8")
                + b"\n"
            )
            self._queue.put_nowait(
                json.dumps(
                    {
                        "method": "item/agentMessage/delta",
                        "params": {
                            "threadId": thread_id,
                            "turnId": "turn-1",
                            "itemId": "assistant-1",
                            "delta": "Hello from Codex",
                        },
                    }
                ).encode("utf-8")
                + b"\n"
            )
            self._queue.put_nowait(
                json.dumps(
                    {
                        "method": "turn/completed",
                        "params": {
                            "threadId": thread_id,
                            "turn": {
                                "id": "turn-1",
                                "status": "completed",
                            },
                        },
                    }
                ).encode("utf-8")
                + b"\n"
            )
        elif method == "turn/interrupt":
            self._queue.put_nowait(
                json.dumps({"id": message["id"], "result": {}}).encode("utf-8") + b"\n"
            )


class FakeTurnProcess(FakeConversationProcess):
    def __init__(self, sent_messages: list[dict], *, hook_command: str | None = None):
        self.returncode = None
        self._queue: asyncio.Queue[bytes] = asyncio.Queue()
        self.stdin = FakeTurnStdin(self._queue, sent_messages, hook_command=hook_command)
        self.stdout = FakeConversationStdout(self._queue)
        self.stderr = FakeConversationStderr()


class FakeMissingHookTurnStdin(FakeTurnStdin):
    def _enqueue_hooks_list(self, message: dict) -> None:
        self._queue.put_nowait(
            json.dumps({"id": message["id"], "result": {"data": [{"cwd": "E:/work/project", "hooks": []}]}}).encode("utf-8")
            + b"\n"
        )


class FakeMissingHookTurnProcess(FakeConversationProcess):
    def __init__(self, sent_messages: list[dict]):
        self.returncode = None
        self._queue: asyncio.Queue[bytes] = asyncio.Queue()
        self.stdin = FakeMissingHookTurnStdin(self._queue, sent_messages)
        self.stdout = FakeConversationStdout(self._queue)
        self.stderr = FakeConversationStderr()


class FakeApprovalTurnStdin(FakeTurnStdin):
    def write(self, payload: bytes) -> None:
        message = json.loads(payload.decode("utf-8"))
        if message.get("id") == "approval-1" and "result" in message:
            self._sent_messages.append(message)
            self._queue.put_nowait(
                json.dumps(
                    {
                        "method": "turn/completed",
                        "params": {
                            "threadId": "thread-existing",
                            "turn": {"id": "turn-approval", "status": "completed"},
                        },
                    }
                ).encode("utf-8")
                + b"\n"
            )
            return

        self._sent_messages.append(message)
        method = message.get("method")
        if method in {"initialize", "thread/resume", "hooks/list"}:
            # Reuse the standard fake behavior without appending twice.
            self._sent_messages.pop()
            return super().write(payload)
        if method == "turn/start":
            self._queue.put_nowait(
                json.dumps({"id": message["id"], "result": {"turn": {"id": "turn-approval", "status": "running"}}}).encode("utf-8")
                + b"\n"
            )
            self._queue.put_nowait(
                json.dumps(
                    {
                        "id": "approval-1",
                        "method": "item/commandExecution/requestApproval",
                        "params": {
                            "threadId": "thread-existing",
                            "turnId": "turn-approval",
                            "itemId": "command-1",
                            "startedAtMs": 1710000000000,
                            "command": "npm test",
                            "cwd": "E:/work/project",
                            "reason": "Run tests",
                        },
                    }
                ).encode("utf-8")
                + b"\n"
            )


class FakeApprovalTurnProcess(FakeConversationProcess):
    def __init__(self, sent_messages: list[dict]):
        self.returncode = None
        self._queue: asyncio.Queue[bytes] = asyncio.Queue()
        self.stdin = FakeApprovalTurnStdin(self._queue, sent_messages)
        self.stdout = FakeConversationStdout(self._queue)
        self.stderr = FakeConversationStderr()


class FakeQuestionTurnStdin(FakeTurnStdin):
    def write(self, payload: bytes) -> None:
        message = json.loads(payload.decode("utf-8"))
        method = message.get("method")
        if method == "hooks/list":
            self._sent_messages.append(message)
            self._enqueue_hooks_list(message)
            return
        self._sent_messages.append(message)
        if method == "initialize":
            self._queue.put_nowait(
                json.dumps({"id": message["id"], "result": {"serverInfo": {"name": "codex"}}}).encode("utf-8") + b"\n"
            )
        elif method == "thread/resume":
            self._remember_hook_command(message)
            self._queue.put_nowait(
                json.dumps(
                    {
                        "id": message["id"],
                        "result": {
                            "thread": {
                                "id": message.get("params", {}).get("threadId"),
                                "sessionId": "session-resumed",
                                "name": "Restored Codex",
                            }
                        },
                    }
                ).encode("utf-8")
                + b"\n"
            )
        elif method == "turn/start":
            self._queue.put_nowait(
                json.dumps({"id": message["id"], "result": {"turn": {"id": "turn-1", "status": "running"}}}).encode("utf-8")
                + b"\n"
            )
            self._queue.put_nowait(
                json.dumps(
                    {
                        "id": "request-1",
                        "method": "item/tool/requestUserInput",
                        "params": {
                            "threadId": "thread-existing",
                            "turnId": "turn-1",
                            "itemId": "item-question-1",
                            "questions": [
                                {
                                    "id": "question-1",
                                    "header": "Implementation choice",
                                    "question": "Which path should Codex take?",
                                    "isOther": True,
                                    "isSecret": False,
                                    "options": [
                                        {"label": "Minimal", "description": "Keep the change small"},
                                        {"label": "Complete", "description": "Build the full interaction"},
                                    ],
                                }
                            ],
                        },
                    }
                ).encode("utf-8")
                + b"\n"
            )
            self._queue.put_nowait(
                json.dumps(
                    {
                        "method": "serverRequest/resolved",
                        "params": {"threadId": "thread-existing", "requestId": "request-1"},
                    }
                ).encode("utf-8")
                + b"\n"
            )
            self._queue.put_nowait(
                json.dumps(
                    {
                        "method": "turn/completed",
                        "params": {"threadId": "thread-existing", "turn": {"id": "turn-1", "status": "completed"}},
                    }
                ).encode("utf-8")
                + b"\n"
            )


class FakeQuestionTurnProcess(FakeConversationProcess):
    def __init__(self, sent_messages: list[dict]):
        self.returncode = None
        self._queue: asyncio.Queue[bytes] = asyncio.Queue()
        self.stdin = FakeQuestionTurnStdin(self._queue, sent_messages)
        self.stdout = FakeConversationStdout(self._queue)
        self.stderr = FakeConversationStderr()


class FakePlanTurnStdin(FakeTurnStdin):
    def write(self, payload: bytes) -> None:
        message = json.loads(payload.decode("utf-8"))
        method = message.get("method")
        if method == "hooks/list":
            self._sent_messages.append(message)
            self._enqueue_hooks_list(message)
            return
        self._sent_messages.append(message)
        if method == "initialize":
            self._queue.put_nowait(
                json.dumps({"id": message["id"], "result": {"serverInfo": {"name": "codex"}}}).encode("utf-8") + b"\n"
            )
        elif method == "thread/resume":
            self._remember_hook_command(message)
            self._queue.put_nowait(
                json.dumps({"id": message["id"], "result": {"thread": {"id": message.get("params", {}).get("threadId")}}}).encode("utf-8")
                + b"\n"
            )
        elif method == "collaborationMode/list":
            self._queue.put_nowait(
                json.dumps(
                    {
                        "id": message["id"],
                        "result": {
                            "data": [
                                {"name": "Plan", "mode": "plan", "model": None, "reasoning_effort": "medium"},
                                {"name": "Default", "mode": "default", "model": None, "reasoning_effort": None},
                            ]
                        },
                    }
                ).encode("utf-8")
                + b"\n"
            )
        elif method == "turn/start":
            self._queue.put_nowait(
                json.dumps({"id": message["id"], "result": {"turn": {"id": "turn-plan", "status": "running"}}}).encode("utf-8")
                + b"\n"
            )
            self._queue.put_nowait(
                json.dumps(
                    {
                        "method": "turn/plan/updated",
                        "params": {
                            "threadId": "thread-existing",
                            "turnId": "turn-plan",
                            "explanation": "I will inspect first.",
                            "plan": [
                                {"step": "Inspect files", "status": "inProgress"},
                                {"step": "Report plan", "status": "pending"},
                            ],
                        },
                    }
                ).encode("utf-8")
                + b"\n"
            )
            self._queue.put_nowait(
                json.dumps(
                    {
                        "method": "item/plan/delta",
                        "params": {
                            "threadId": "thread-existing",
                            "turnId": "turn-plan",
                            "itemId": "plan-item-1",
                            "delta": "Plan delta text",
                        },
                    }
                ).encode("utf-8")
                + b"\n"
            )
            self._queue.put_nowait(
                json.dumps(
                    {
                        "method": "item/completed",
                        "params": {
                            "threadId": "thread-existing",
                            "turnId": "turn-plan",
                            "item": {"id": "plan-item-1", "type": "plan", "text": "Final plan text"},
                        },
                    }
                ).encode("utf-8")
                + b"\n"
            )
            self._queue.put_nowait(
                json.dumps(
                    {
                        "method": "turn/completed",
                        "params": {"threadId": "thread-existing", "turn": {"id": "turn-plan", "status": "completed"}},
                    }
                ).encode("utf-8")
                + b"\n"
            )


class FakePlanTurnProcess(FakeConversationProcess):
    def __init__(self, sent_messages: list[dict]):
        self.returncode = None
        self._queue: asyncio.Queue[bytes] = asyncio.Queue()
        self.stdin = FakePlanTurnStdin(self._queue, sent_messages)
        self.stdout = FakeConversationStdout(self._queue)
        self.stderr = FakeConversationStderr()


class FakeNoPlanTurnStdin(FakePlanTurnStdin):
    def write(self, payload: bytes) -> None:
        message = json.loads(payload.decode("utf-8"))
        if message.get("method") != "collaborationMode/list":
            return super().write(payload)
        self._sent_messages.append(message)
        self._queue.put_nowait(
            json.dumps({"id": message["id"], "result": {"data": [{"name": "Default", "mode": "default"}]}}).encode("utf-8") + b"\n"
        )


class FakeNoPlanTurnProcess(FakeConversationProcess):
    def __init__(self, sent_messages: list[dict]):
        self.returncode = None
        self._queue: asyncio.Queue[bytes] = asyncio.Queue()
        self.stdin = FakeNoPlanTurnStdin(self._queue, sent_messages)
        self.stdout = FakeConversationStdout(self._queue)
        self.stderr = FakeConversationStderr()


class FakeGoalTurnStdin(FakeTurnStdin):
    def write(self, payload: bytes) -> None:
        message = json.loads(payload.decode("utf-8"))
        method = message.get("method")
        if method == "hooks/list":
            self._sent_messages.append(message)
            self._enqueue_hooks_list(message)
            return
        self._sent_messages.append(message)
        if method == "initialize":
            self._queue.put_nowait(
                json.dumps({"id": message["id"], "result": {"serverInfo": {"name": "codex"}}}).encode("utf-8") + b"\n"
            )
        elif method == "thread/resume":
            self._remember_hook_command(message)
            self._queue.put_nowait(
                json.dumps({"id": message["id"], "result": {"thread": {"id": message.get("params", {}).get("threadId")}}}).encode("utf-8")
                + b"\n"
            )
        elif method == "thread/goal/set":
            self._queue.put_nowait(
                json.dumps(
                    {
                        "id": message["id"],
                        "result": {
                            "goal": {
                                "threadId": "thread-existing",
                                "objective": message.get("params", {}).get("objective"),
                                "status": "active",
                                "tokenBudget": None,
                                "tokensUsed": 0,
                                "timeUsedSeconds": 0,
                                "createdAt": 1710000000,
                                "updatedAt": 1710000000,
                            }
                        },
                    }
                ).encode("utf-8")
                + b"\n"
            )
            self._queue.put_nowait(
                json.dumps(
                    {
                        "method": "thread/goal/updated",
                        "params": {
                            "threadId": "thread-existing",
                            "turnId": None,
                            "goal": {
                                "threadId": "thread-existing",
                                "objective": message.get("params", {}).get("objective"),
                                "status": "active",
                                "tokenBudget": None,
                                "tokensUsed": 0,
                                "timeUsedSeconds": 0,
                                "createdAt": 1710000000,
                                "updatedAt": 1710000000,
                            },
                        },
                    }
                ).encode("utf-8")
                + b"\n"
            )
        elif method == "thread/goal/clear":
            self._queue.put_nowait(json.dumps({"id": message["id"], "result": {"cleared": True}}).encode("utf-8") + b"\n")
        elif method == "turn/start":
            self._queue.put_nowait(
                json.dumps({"id": message["id"], "result": {"turn": {"id": "turn-goal", "status": "running"}}}).encode("utf-8")
                + b"\n"
            )
            self._queue.put_nowait(
                json.dumps(
                    {
                        "method": "thread/goal/cleared",
                        "params": {"threadId": "thread-existing"},
                    }
                ).encode("utf-8")
                + b"\n"
            )
            self._queue.put_nowait(
                json.dumps(
                    {
                        "method": "turn/completed",
                        "params": {"threadId": "thread-existing", "turn": {"id": "turn-goal", "status": "completed"}},
                    }
                ).encode("utf-8")
                + b"\n"
            )


class FakeGoalTurnProcess(FakeConversationProcess):
    def __init__(self, sent_messages: list[dict]):
        self.returncode = None
        self._queue: asyncio.Queue[bytes] = asyncio.Queue()
        self.stdin = FakeGoalTurnStdin(self._queue, sent_messages)
        self.stdout = FakeConversationStdout(self._queue)
        self.stderr = FakeConversationStderr()


class FakeInstructionBundle:
    text = "## SAFETY.md\nSafety text\n\n## PERMISSION.md\nPermission text"
    source_paths = ["SAFETY.md", "PERMISSION.md"]
    sha256 = "instruction-hash"
    byte_length = 59


def _expected_conversation_app_server_command(codex_path: str, session_key: str | None = None) -> list[str]:
    command = [codex_path, "--dangerously-bypass-hook-trust", "app-server"]
    if session_key:
        hook_command = system_routes._codex_guard_hook_command(session_key)
        command.extend(system_routes._codex_guard_hook_cli_args(hook_command))
    return command


def test_codex_hook_validation_allows_untrusted_or_modified_hooks_only_with_bypass():
    command = system_routes._codex_guard_hook_command("codex:thread-existing")
    base_hook = {
        "eventName": "preToolUse",
        "command": command,
        "source": "sessionFlags",
        "enabled": True,
    }

    assert system_routes._codex_hook_is_loaded(
        {**base_hook, "trustStatus": "untrusted"},
        session_key="codex:thread-existing",
        expected_command=command,
        bypass_hook_trust=True,
    )
    assert system_routes._codex_hook_is_loaded(
        {**base_hook, "trustStatus": "modified"},
        session_key="codex:thread-existing",
        expected_command=command,
        bypass_hook_trust=True,
    )
    assert not system_routes._codex_hook_is_loaded(
        {**base_hook, "trustStatus": "untrusted"},
        session_key="codex:thread-existing",
        expected_command=command,
        bypass_hook_trust=False,
    )
    assert not system_routes._codex_hook_is_loaded(
        {**base_hook, "trustStatus": "trusted", "command": f"{command} --extra"},
        session_key="codex:thread-existing",
        expected_command=command,
        bypass_hook_trust=True,
    )
    assert not system_routes._codex_hook_is_loaded(
        {**base_hook, "trustStatus": "trusted", "source": "project"},
        session_key="codex:thread-existing",
        expected_command=command,
        bypass_hook_trust=True,
    )
    assert not system_routes._codex_hook_is_loaded(
        {**base_hook, "trustStatus": "trusted", "enabled": False},
        session_key="codex:thread-existing",
        expected_command=command,
        bypass_hook_trust=True,
    )


def _client_with_fake_conversation(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sent_messages: list[dict] = []
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)
    monkeypatch.setattr(system_routes, "build_codex_developer_instructions", lambda: FakeInstructionBundle())

    async def fake_create_subprocess_exec(*args, **kwargs):
        assert list(args) == _expected_conversation_app_server_command(codex_path)
        assert kwargs.get("stdin") == system_routes.asyncio.subprocess.PIPE
        return FakeConversationProcess(sent_messages)

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    return TestClient(app), sent_messages


def test_codex_conversation_start_injects_developer_instructions(monkeypatch, tmp_path):
    client, sent_messages = _client_with_fake_conversation(monkeypatch, tmp_path)

    response = client.post(
        "/api/system/codex/conversations/start",
        json={"cwd": "E:/work/project", "model": "GPT-5.5", "permission_mode": "workspace_write"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["installed"] is True
    assert data["status"] == "ready"
    assert data["session_key"] == "codex:thread-started"
    assert data["thread_id"] == "thread-started"
    assert data["cwd"] == "E:/work/project"
    assert data["instruction_hash"] == "instruction-hash"
    assert data["instruction_bytes"] == 59

    start_messages = [message for message in sent_messages if message.get("method") == "thread/start"]
    assert len(start_messages) == 1
    params = start_messages[0]["params"]
    assert params["developerInstructions"] == FakeInstructionBundle.text
    assert params["cwd"] == "E:/work/project"
    assert params["model"] == "GPT-5.5"
    assert "baseInstructions" not in params


def test_codex_conversation_resume_injects_developer_instructions(monkeypatch, tmp_path):
    client, sent_messages = _client_with_fake_conversation(monkeypatch, tmp_path)

    response = client.post(
        "/api/system/codex/conversations/resume",
        json={"thread_id": "thread-existing", "cwd": "E:/work/project"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["session_key"] == "codex:thread-existing"
    assert data["thread_id"] == "thread-existing"
    assert data["title"] == "Restored Codex"

    resume_messages = [message for message in sent_messages if message.get("method") == "thread/resume"]
    assert len(resume_messages) == 1
    params = resume_messages[0]["params"]
    assert params["threadId"] == "thread-existing"
    assert params["developerInstructions"] == FakeInstructionBundle.text
    assert "baseInstructions" not in params


def test_codex_conversation_start_fails_closed_when_prompt_cannot_load(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sent_messages: list[dict] = []
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)

    def fail_prompt():
        raise CodexSafetyPromptError("missing PERMISSION.md")

    monkeypatch.setattr(system_routes, "build_codex_developer_instructions", fail_prompt)

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        sent_messages.append({"unexpected": True})
        return FakeConversationProcess(sent_messages)

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    client = TestClient(app)

    response = client.post("/api/system/codex/conversations/start", json={"cwd": "E:/work/project"})

    assert response.status_code == 500
    assert response.json()["detail"] == "missing PERMISSION.md"
    assert sent_messages == []


def test_codex_turn_stream_sends_ui_model_reasoning_speed_and_streams_delta(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sent_messages: list[dict] = []
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)
    monkeypatch.setattr(system_routes, "build_codex_developer_instructions", lambda: FakeInstructionBundle())

    async def fake_create_subprocess_exec(*args, **kwargs):
        assert list(args) == _expected_conversation_app_server_command(codex_path, "codex:thread-existing")
        assert kwargs.get("stdin") == system_routes.asyncio.subprocess.PIPE
        return FakeTurnProcess(
            sent_messages,
            hook_command=system_routes._codex_guard_hook_command("codex:thread-existing"),
        )

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    client = TestClient(app)

    with client.stream(
        "POST",
        "/api/system/codex/conversations/codex%3Athread-existing/turns/stream",
        json={
            "message": "hello Codex",
            "thread_id": "thread-existing",
            "cwd": "E:/work/project",
            "model": "GPT-5.5",
            "reasoning_effort": "xhigh",
            "speed": "fast",
            "permission_mode": "workspace_write",
        },
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert 'data: {"type": "delta", "text": "Hello from Codex"}' in body
    assert "data: [DONE]" in body

    resume_messages = [message for message in sent_messages if message.get("method") == "thread/resume"]
    assert len(resume_messages) == 1
    assert resume_messages[0]["params"]["threadId"] == "thread-existing"
    assert resume_messages[0]["params"]["developerInstructions"] == FakeInstructionBundle.text
    assert "config" not in resume_messages[0]["params"]

    hooks_list_messages = [message for message in sent_messages if message.get("method") == "hooks/list"]
    assert len(hooks_list_messages) == 1

    turn_messages = [message for message in sent_messages if message.get("method") == "turn/start"]
    assert len(turn_messages) == 1
    params = turn_messages[0]["params"]
    assert params["threadId"] == "thread-existing"
    assert params["input"] == [{"type": "text", "text": "hello Codex", "text_elements": []}]
    assert params["cwd"] == "E:/work/project"
    assert params["model"] == "gpt-5.5"
    assert params["effort"] == "xhigh"
    assert params["serviceTier"] == "fast"
    assert params["sandboxPolicy"]["type"] == "workspaceWrite"
    assert params["collaborationMode"] == {
        "mode": "default",
        "settings": {
            "model": "gpt-5.5",
            "reasoning_effort": "xhigh",
            "developer_instructions": None,
        },
    }


def test_codex_turn_stream_starts_thread_for_pending_first_message(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sent_messages: list[dict] = []
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)
    monkeypatch.setattr(system_routes, "build_codex_developer_instructions", lambda: FakeInstructionBundle())

    async def fake_create_subprocess_exec(*args, **kwargs):
        assert list(args) == _expected_conversation_app_server_command(codex_path, "codex:pending:abc")
        assert kwargs.get("stdin") == system_routes.asyncio.subprocess.PIPE
        return FakeTurnProcess(
            sent_messages,
            hook_command=system_routes._codex_guard_hook_command("codex:pending:abc"),
        )

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    client = TestClient(app)

    with client.stream(
        "POST",
        "/api/system/codex/conversations/codex%3Apending%3Aabc/turns/stream",
        json={
            "message": "create a real Codex thread",
            "thread_id": None,
            "cwd": "C:/Users/heng/Desktop/test",
            "model": "GPT-5.5",
            "reasoning_effort": "xhigh",
            "speed": "fast",
            "permission_mode": "workspace_write",
        },
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    first_event = body.split("\n\n", 1)[0]
    assert '"type": "codex_session_started"' in first_event
    assert '"thread_id": "thread-started"' in first_event
    assert '"session_key": "codex:thread-started"' in first_event
    assert '"cwd": "C:/Users/heng/Desktop/test"' in first_event
    assert 'data: {"type": "delta", "text": "Hello from Codex"}' in body
    assert "data: [DONE]" in body

    methods = [message.get("method") for message in sent_messages]
    assert "thread/start" in methods
    assert "thread/resume" not in methods
    assert methods.index("initialize") < methods.index("thread/start") < methods.index("turn/start")

    start_messages = [message for message in sent_messages if message.get("method") == "thread/start"]
    assert len(start_messages) == 1
    start_params = start_messages[0]["params"]
    assert start_params["developerInstructions"] == FakeInstructionBundle.text
    assert start_params["cwd"] == "C:/Users/heng/Desktop/test"
    assert start_params["model"] == "gpt-5.5"
    assert "config" not in start_params

    turn_messages = [message for message in sent_messages if message.get("method") == "turn/start"]
    assert len(turn_messages) == 1
    turn_params = turn_messages[0]["params"]
    assert turn_params["threadId"] == "thread-started"
    assert turn_params["input"] == [{"type": "text", "text": "create a real Codex thread", "text_elements": []}]
    assert turn_params["cwd"] == "C:/Users/heng/Desktop/test"
    assert turn_params["model"] == "gpt-5.5"
    assert turn_params["effort"] == "xhigh"
    assert turn_params["serviceTier"] == "fast"
    assert turn_params["sandboxPolicy"]["type"] == "workspaceWrite"


def test_codex_turn_stream_fails_closed_when_session_hooks_are_not_loaded(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sent_messages: list[dict] = []
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)
    monkeypatch.setattr(system_routes, "build_codex_developer_instructions", lambda: FakeInstructionBundle())

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return FakeMissingHookTurnProcess(sent_messages)

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    client = TestClient(app)

    with client.stream(
        "POST",
        "/api/system/codex/conversations/codex%3Athread-existing/turns/stream",
        json={"message": "hello Codex", "thread_id": "thread-existing"},
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert "Codex session hooks are unavailable" in body
    assert not any(message.get("method") == "turn/start" for message in sent_messages)


def test_codex_native_command_approval_waits_for_guard_and_accepts(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sent_messages: list[dict] = []
    guard_calls: list[dict] = []
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)
    monkeypatch.setattr(system_routes, "build_codex_developer_instructions", lambda: FakeInstructionBundle())

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return FakeApprovalTurnProcess(sent_messages)

    async def fake_check_runtime_tool_call(**kwargs):
        guard_calls.append(kwargs)
        return {"action": "allow"}

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    monkeypatch.setattr(system_routes.guard_service, "check_runtime_tool_call", fake_check_runtime_tool_call)
    client = TestClient(app)

    with client.stream(
        "POST",
        "/api/system/codex/conversations/codex%3Athread-existing/turns/stream",
        json={"message": "run tests", "thread_id": "thread-existing"},
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert "Codex tool approved" in body
    assert guard_calls
    assert guard_calls[0]["platform"] == "codex"
    assert guard_calls[0]["force_approval"] is True
    assert guard_calls[0]["tool_name"] == "Shell"
    assert guard_calls[0]["params"]["command"] == "npm test"
    approval_responses = [message for message in sent_messages if message.get("id") == "approval-1" and "result" in message]
    assert approval_responses == [{"id": "approval-1", "result": {"decision": "accept"}}]


def test_codex_native_command_approval_denies_when_guard_blocks(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sent_messages: list[dict] = []
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)
    monkeypatch.setattr(system_routes, "build_codex_developer_instructions", lambda: FakeInstructionBundle())

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return FakeApprovalTurnProcess(sent_messages)

    async def fake_check_runtime_tool_call(**_kwargs):
        return {"action": "block", "reason": "Denied by reviewer"}

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    monkeypatch.setattr(system_routes.guard_service, "check_runtime_tool_call", fake_check_runtime_tool_call)
    client = TestClient(app)

    with client.stream(
        "POST",
        "/api/system/codex/conversations/codex%3Athread-existing/turns/stream",
        json={"message": "run tests", "thread_id": "thread-existing"},
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert "Codex tool blocked" in body
    approval_responses = [message for message in sent_messages if message.get("id") == "approval-1" and "result" in message]
    assert approval_responses == [{"id": "approval-1", "result": {"decision": "decline"}}]


def test_codex_turn_stream_maps_request_user_input_and_resolved_notification(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sent_messages: list[dict] = []
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)
    monkeypatch.setattr(system_routes, "build_codex_developer_instructions", lambda: FakeInstructionBundle())

    async def fake_create_subprocess_exec(*args, **kwargs):
        assert list(args) == _expected_conversation_app_server_command(codex_path, "codex:thread-existing")
        assert kwargs.get("stdin") == system_routes.asyncio.subprocess.PIPE
        return FakeQuestionTurnProcess(sent_messages)

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    client = TestClient(app)

    with client.stream(
        "POST",
        "/api/system/codex/conversations/codex%3Athread-existing/turns/stream",
        json={"message": "ask me", "thread_id": "thread-existing"},
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert '"type": "codex_user_input_request"' in body
    assert '"request_id": "request-1"' in body
    assert '"thread_id": "thread-existing"' in body
    assert '"turn_id": "turn-1"' in body
    assert '"item_id": "item-question-1"' in body
    assert '"id": "question-1"' in body
    assert '"is_other": true' in body
    assert '"is_secret": false' in body
    assert '"label": "Minimal"' in body
    assert '"type": "codex_request_resolved"' in body
    assert "data: [DONE]" in body


def test_codex_plan_mode_uses_native_collaboration_mode_and_maps_plan_events(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sent_messages: list[dict] = []
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)
    monkeypatch.setattr(system_routes, "build_codex_developer_instructions", lambda: FakeInstructionBundle())

    async def fake_create_subprocess_exec(*args, **kwargs):
        assert list(args) == _expected_conversation_app_server_command(codex_path, "codex:thread-existing")
        assert kwargs.get("stdin") == system_routes.asyncio.subprocess.PIPE
        return FakePlanTurnProcess(sent_messages)

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    client = TestClient(app)

    with client.stream(
        "POST",
        "/api/system/codex/conversations/codex%3Athread-existing/turns/stream",
        json={
            "message": "make a plan",
            "thread_id": "thread-existing",
            "model": "GPT-5.5",
            "reasoning_effort": "xhigh",
            "speed": "standard",
            "plan_mode": True,
        },
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert '"type": "codex_plan_update"' in body
    assert '"explanation": "I will inspect first."' in body
    assert '"step": "Inspect files"' in body
    assert '"delta": "Plan delta text"' in body
    assert '"text": "Final plan text"' in body

    methods = [message.get("method") for message in sent_messages if message.get("method")]
    assert methods.index("collaborationMode/list") < methods.index("turn/start")
    turn_params = next(message["params"] for message in sent_messages if message.get("method") == "turn/start")
    assert turn_params["collaborationMode"] == {
        "mode": "plan",
        "settings": {
            "model": "gpt-5.5",
            "reasoning_effort": "medium",
            "developer_instructions": None,
        },
    }
    assert "effort" not in turn_params


def test_codex_plan_mode_returns_error_when_plan_collaboration_mode_is_missing(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sent_messages: list[dict] = []
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)
    monkeypatch.setattr(system_routes, "build_codex_developer_instructions", lambda: FakeInstructionBundle())

    async def fake_create_subprocess_exec(*args, **kwargs):
        assert list(args) == _expected_conversation_app_server_command(codex_path, "codex:thread-existing")
        assert kwargs.get("stdin") == system_routes.asyncio.subprocess.PIPE
        return FakeNoPlanTurnProcess(sent_messages)

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    client = TestClient(app)

    with client.stream(
        "POST",
        "/api/system/codex/conversations/codex%3Athread-existing/turns/stream",
        json={"message": "make a plan", "thread_id": "thread-existing", "plan_mode": True},
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert '"type": "error"' in body
    assert "当前 Codex CLI 不支持计划模式" in body
    assert not any(message.get("method") == "turn/start" for message in sent_messages)


def test_codex_goal_mode_sets_goal_before_starting_turn_and_maps_goal_events(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sent_messages: list[dict] = []
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)
    monkeypatch.setattr(system_routes, "build_codex_developer_instructions", lambda: FakeInstructionBundle())

    async def fake_create_subprocess_exec(*args, **kwargs):
        assert list(args) == _expected_conversation_app_server_command(codex_path, "codex:thread-existing")
        assert kwargs.get("stdin") == system_routes.asyncio.subprocess.PIPE
        return FakeGoalTurnProcess(sent_messages)

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    client = TestClient(app)

    with client.stream(
        "POST",
        "/api/system/codex/conversations/codex%3Athread-existing/turns/stream",
        json={
            "message": "finish migration",
            "thread_id": "thread-existing",
            "goal_mode": True,
            "goal_objective": "finish migration",
        },
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert '"type": "codex_goal_update"' in body
    assert '"objective": "finish migration"' in body
    assert '"status": "active"' in body
    assert '"type": "codex_goal_cleared"' in body

    methods = [message.get("method") for message in sent_messages if message.get("method")]
    assert methods.index("thread/goal/set") < methods.index("turn/start")
    goal_params = next(message["params"] for message in sent_messages if message.get("method") == "thread/goal/set")
    assert goal_params == {
        "threadId": "thread-existing",
        "objective": "finish migration",
        "status": "active",
        "tokenBudget": None,
    }


def test_codex_plan_and_goal_modes_are_mutually_exclusive(monkeypatch, tmp_path):
    codex_path = str(tmp_path / "codex.cmd")
    sent_messages: list[dict] = []
    monkeypatch.setattr(system_routes, "_find_codex", lambda **_: codex_path)

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        sent_messages.append({"unexpected": True})
        return FakeTurnProcess(sent_messages)

    monkeypatch.setattr(system_routes.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    client = TestClient(app)

    response = client.post(
        "/api/system/codex/conversations/codex%3Athread-existing/turns/stream",
        json={
            "message": "do both",
            "thread_id": "thread-existing",
            "plan_mode": True,
            "goal_mode": True,
            "goal_objective": "do both",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Codex plan mode and goal mode cannot both be enabled"
    assert sent_messages == []


def test_codex_request_respond_writes_jsonrpc_result_to_active_app_server():
    sent_messages: list[dict] = []
    proc = FakeTurnProcess(sent_messages)
    system_routes._codex_active_turns["codex:thread-existing"] = {
        "proc": proc,
        "thread_id": "thread-existing",
        "turn_id": "turn-1",
        "pending_requests": {"request-1": {"method": "item/tool/requestUserInput"}},
    }
    client = TestClient(app)

    try:
        response = client.post(
            "/api/system/codex/conversations/codex%3Athread-existing/requests/request-1/respond",
            json={"answers": {"question-1": {"answers": ["Minimal"]}}},
        )
    finally:
        system_routes._codex_active_turns.pop("codex:thread-existing", None)

    assert response.status_code == 200
    assert response.json() == {"status": "sent", "request_id": "request-1"}
    assert sent_messages[-1] == {
        "id": "request-1",
        "result": {"answers": {"question-1": {"answers": ["Minimal"]}}},
    }


def test_codex_request_respond_returns_stable_errors():
    client = TestClient(app)

    no_turn = client.post(
        "/api/system/codex/conversations/codex%3Amissing/requests/request-1/respond",
        json={"answers": {"question-1": {"answers": ["Minimal"]}}},
    )
    assert no_turn.status_code == 409
    assert no_turn.json()["detail"] == "Codex turn is not active"

    system_routes._codex_active_turns["codex:thread-existing"] = {
        "proc": FakeTurnProcess([]),
        "thread_id": "thread-existing",
        "turn_id": "turn-1",
        "pending_requests": {},
    }
    try:
        unknown = client.post(
            "/api/system/codex/conversations/codex%3Athread-existing/requests/request-unknown/respond",
            json={"answers": {"question-1": {"answers": ["Minimal"]}}},
        )
    finally:
        system_routes._codex_active_turns.pop("codex:thread-existing", None)
    assert unknown.status_code == 404
    assert unknown.json()["detail"] == "Codex request is not pending"


def test_codex_conversation_interrupt_sends_active_turn_interrupt():
    sent_messages: list[dict] = []
    proc = FakeTurnProcess(sent_messages)
    system_routes._codex_active_turns["codex:thread-existing"] = {
        "proc": proc,
        "thread_id": "thread-existing",
        "turn_id": "turn-1",
    }
    client = TestClient(app)

    try:
        response = client.post("/api/system/codex/conversations/codex%3Athread-existing/interrupt", json={})
    finally:
        system_routes._codex_active_turns.pop("codex:thread-existing", None)

    assert response.status_code == 200
    assert response.json()["interrupted"] is True
    interrupt_messages = [message for message in sent_messages if message.get("method") == "turn/interrupt"]
    assert len(interrupt_messages) == 1
    assert interrupt_messages[0]["params"] == {"threadId": "thread-existing", "turnId": "turn-1"}
