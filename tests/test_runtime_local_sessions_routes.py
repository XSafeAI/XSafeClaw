from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from xsafeclaw.api.main import app
from xsafeclaw.api.routes import system as system_routes


def _write_local_session(sessions_dir: Path, *, key: str, session_id: str) -> Path:
    sessions_dir.mkdir(parents=True, exist_ok=True)
    (sessions_dir / "sessions.json").write_text(
        json.dumps({key: {"sessionId": session_id}}, ensure_ascii=False),
        encoding="utf-8",
    )
    jsonl_path = sessions_dir / f"{session_id}.jsonl"
    jsonl_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "timestamp": "2026-06-15T12:00:00Z",
                        "cwd": "E:/work/demo",
                        "role": "user",
                        "content": "Build a local history feature",
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "timestamp": "2026-06-15T12:05:00Z",
                        "role": "assistant",
                        "content": "Done",
                    },
                    ensure_ascii=False,
                ),
            ],
        )
        + "\n",
        encoding="utf-8",
    )
    return jsonl_path


def test_runtime_sessions_reads_openclaw_local_sessions(monkeypatch, tmp_path):
    sessions_dir = tmp_path / "openclaw" / "sessions"
    _write_local_session(sessions_dir, key="workspace-a", session_id="sess-openclaw-1")
    monkeypatch.setattr(system_routes.settings, "openclaw_sessions_dir", sessions_dir)

    response = TestClient(app).get("/api/system/runtime-sessions?platform=openclaw&limit=20")

    assert response.status_code == 200
    data = response.json()
    assert data["platform"] == "openclaw"
    assert data["sessions"] == [
        {
            "platform": "openclaw",
            "instance_id": "openclaw-default",
            "source_session_id": "sess-openclaw-1",
            "session_key": "workspace-a",
            "title": "Build a local history feature",
            "cwd": "E:/work/demo",
            "created_at": "2026-06-15T12:00:00Z",
            "updated_at": "2026-06-15T12:05:00Z",
            "path_available": True,
        }
    ]


def test_runtime_sessions_missing_local_history_returns_empty(monkeypatch, tmp_path):
    monkeypatch.setattr(system_routes.settings, "hermes_sessions_dir", tmp_path / "missing-hermes")

    response = TestClient(app).get("/api/system/runtime-sessions?platform=hermes")

    assert response.status_code == 200
    assert response.json() == {
        "platform": "hermes",
        "instance_id": "hermes-default",
        "sessions": [],
        "total": 0,
    }


def test_runtime_session_delete_removes_jsonl_and_updates_index(monkeypatch, tmp_path):
    sessions_dir = tmp_path / "hermes" / "sessions"
    jsonl_path = _write_local_session(sessions_dir, key="workspace-b", session_id="sess-hermes-1")
    monkeypatch.setattr(system_routes.settings, "hermes_sessions_dir", sessions_dir)

    response = TestClient(app).delete(
        "/api/system/runtime-sessions/hermes/sess-hermes-1?instance_id=hermes-default"
    )

    assert response.status_code == 200
    data = response.json()
    assert data["platform"] == "hermes"
    assert data["source_session_id"] == "sess-hermes-1"
    assert data["deleted_file"] is True
    assert data["updated_index"] is True
    assert not jsonl_path.exists()
    assert json.loads((sessions_dir / "sessions.json").read_text(encoding="utf-8")) == {}


def test_runtime_session_delete_rejects_index_file_name_mismatch(monkeypatch, tmp_path):
    sessions_dir = tmp_path / "openclaw" / "sessions"
    sessions_dir.mkdir(parents=True)
    (sessions_dir / "sessions.json").write_text(
        json.dumps({"workspace": {"sessionId": "bad\\outside"}}),
        encoding="utf-8",
    )
    monkeypatch.setattr(system_routes.settings, "openclaw_sessions_dir", sessions_dir)

    response = TestClient(app).delete(
        "/api/system/runtime-sessions/openclaw/bad%5Coutside?instance_id=openclaw-default"
    )

    assert response.status_code == 400
    assert (sessions_dir / "sessions.json").exists()
