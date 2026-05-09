from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from xsafeclaw import database
from xsafeclaw.config import settings
from xsafeclaw.database import get_db_context, init_db
from xsafeclaw.models import Session
from xsafeclaw.runtime.models import RuntimeInstance, empty_capabilities
from xsafeclaw.runtime.parsing import ParsedSessionInfo
from xsafeclaw.services.event_sync_service import EventSyncService
from xsafeclaw.services.message_sync_service import (
    RuntimeSyncWorker,
    _resolve_session_model_defaults,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


@pytest.fixture
async def db(tmp_path, monkeypatch):
    db_path = tmp_path / "nanobot-sync-fallback.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    monkeypatch.setattr(settings, "database_url", url)
    monkeypatch.setattr(database, "_engine", None)
    monkeypatch.setattr(database, "_session_factory", None)
    await init_db()
    try:
        yield
    finally:
        await database.close_db()


def _build_nanobot_instance() -> RuntimeInstance:
    caps = empty_capabilities()
    caps["monitoring"] = True
    return RuntimeInstance(
        instance_id="nanobot-default",
        platform="nanobot",
        display_name="nanobot",
        capabilities=caps,
        meta={"provider": "deepseek", "model": "deepseek-v4-flash"},
    )


def test_resolve_session_model_defaults_uses_instance_when_placeholder():
    provider, model = _resolve_session_model_defaults(
        "nanobot",
        "nanobot",
        "deepseek",
        "deepseek-v4-flash",
    )
    assert provider == "deepseek"
    assert model == "deepseek-v4-flash"


@pytest.mark.asyncio
async def test_ensure_session_uses_instance_model_when_parsed_session_is_placeholder(db):
    worker = RuntimeSyncWorker(_build_nanobot_instance(), EventSyncService())
    parsed_session = ParsedSessionInfo(
        source_session_id="websocket:chat-1",
        session_key="websocket:chat-1",
        first_seen_at=_now(),
        last_activity_at=_now(),
        current_model_provider="nanobot",
        current_model_name="nanobot",
        jsonl_file_path="/tmp/websocket_chat-1.jsonl",
    )

    async with get_db_context() as session:
        internal_sid = await worker._ensure_session(session, parsed_session)

    async with get_db_context() as session:
        row = (
            await session.execute(
                select(Session).where(Session.session_id == internal_sid)
            )
        ).scalar_one()

    assert row.current_model_provider == "deepseek"
    assert row.current_model_name == "deepseek-v4-flash"
