from __future__ import annotations

from datetime import datetime, timezone

import pytest

from xsafeclaw import database
from xsafeclaw.api.routes import chat as chat_routes
from xsafeclaw.config import settings
from xsafeclaw.database import get_db_context, init_db
from xsafeclaw.models import Session
from xsafeclaw.runtime import RuntimeInstance, empty_capabilities, namespace_session_id


def _now() -> datetime:
    return datetime.now(timezone.utc)


@pytest.fixture
async def db(tmp_path, monkeypatch):
    db_path = tmp_path / "chat-session-sync.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setattr(settings, "database_url", url)
    monkeypatch.setattr(database, "_engine", None)
    monkeypatch.setattr(database, "_session_factory", None)
    await init_db()
    try:
        yield
    finally:
        await database.close_db()


@pytest.mark.asyncio
async def test_chat_session_index_includes_agent_valley_sessions(db):
    now = _now()
    session_key = "nanobot::nanobot-default::websocket:3f89"
    async with get_db_context() as session:
        session.add(
            Session(
                session_id=session_key,
                platform="nanobot",
                instance_id="nanobot-default",
                source_session_id="websocket:3f89",
                session_key=session_key,
                channel="webchat",
                first_seen_at=now,
                last_activity_at=now,
                current_model_provider="deepseek",
                current_model_name="deepseek-v4-flash",
            )
        )

    async with get_db_context() as session:
        payload = await chat_routes.list_chat_sessions(limit=20, db=session)

    assert payload["sessions"][0]["key"] == session_key
    assert payload["sessions"][0]["platform"] == "nanobot"
    assert payload["sessions"][0]["instance_id"] == "nanobot-default"
    assert payload["sessions"][0]["model"] == "deepseek-v4-flash"
    assert payload["sessions"][0]["auto_title_pending"] is False


@pytest.mark.asyncio
async def test_chat_session_index_encodes_legacy_source_session_keys(db):
    now = _now()
    async with get_db_context() as session:
        session.add(
            Session(
                session_id="nanobot::nanobot-default::websocket:legacy",
                platform="nanobot",
                instance_id="nanobot-default",
                source_session_id="websocket:legacy",
                session_key=None,
                channel="webchat",
                first_seen_at=now,
                last_activity_at=now,
            )
        )

    async with get_db_context() as session:
        payload = await chat_routes.list_chat_sessions(limit=20, db=session)

    assert payload["sessions"][0]["key"] == "nanobot::nanobot-default::websocket:legacy"


@pytest.mark.asyncio
async def test_chat_session_index_maps_openclaw_session_id_to_chat_key(db, tmp_path, monkeypatch):
    sessions_dir = tmp_path / "openclaw-sessions"
    sessions_dir.mkdir()
    (sessions_dir / "sessions.json").write_text(
        '{"agent:main:chat-agent-valley": {"sessionId": "runtime-session-id"}}',
        encoding="utf-8",
    )

    instance = RuntimeInstance(
        instance_id="openclaw-default",
        platform="openclaw",
        display_name="OpenClaw",
        sessions_path=str(sessions_dir),
        enabled=True,
        is_default=True,
        capabilities={**empty_capabilities(), "chat": True},
    )

    async def _fake_instances():
        return [instance]

    monkeypatch.setattr(chat_routes, "list_instances", _fake_instances)
    now = _now()
    async with get_db_context() as session:
        session.add(
            Session(
                session_id=namespace_session_id("openclaw", "openclaw-default", "runtime-session-id"),
                platform="openclaw",
                instance_id="openclaw-default",
                source_session_id="runtime-session-id",
                session_key="openclaw::openclaw-default::runtime-session-id",
                channel="webchat",
                first_seen_at=now,
                last_activity_at=now,
            )
        )

    async with get_db_context() as session:
        payload = await chat_routes.list_chat_sessions(limit=20, db=session)

    assert payload["sessions"][0]["key"] == "openclaw::openclaw-default::chat-agent-valley"
