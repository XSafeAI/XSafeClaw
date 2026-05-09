from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from xsafeclaw import database
from xsafeclaw.api.routes import chat as chat_routes
from xsafeclaw.config import settings
from xsafeclaw.database import get_db_context, init_db
from xsafeclaw.models import Message, Session
from xsafeclaw.runtime.hermes import parse_hermes_session_file
from xsafeclaw.runtime.parsing import ParsedMessage
from xsafeclaw.services.message_sync_service import RuntimeSyncWorker


def _now() -> datetime:
    return datetime.now(timezone.utc)


@pytest.fixture
async def db(tmp_path, monkeypatch):
    db_path = tmp_path / "hermes-model-backfill.db"
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
async def test_hermes_parser_uses_config_yaml_as_default_model(tmp_path, monkeypatch):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "model:\n"
        "  default: deepseek-v4-pro\n"
        "  provider: openrouter\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(settings, "hermes_config_path", config_path)

    session_file = tmp_path / "chat-1.jsonl"
    session_file.write_text(
        json.dumps({"message": {"role": "assistant", "content": "hello"}}) + "\n",
        encoding="utf-8",
    )

    batch = await parse_hermes_session_file(session_file)
    assistant = next(msg for msg in batch.messages if msg.role == "assistant")
    assert batch.session.current_model_provider == "openrouter"
    assert batch.session.current_model_name == "openrouter/deepseek-v4-pro"
    assert assistant.provider == "openrouter"
    assert assistant.model_id == "openrouter/deepseek-v4-pro"


@pytest.mark.asyncio
async def test_persist_hermes_turn_recovers_model_from_session_row(db):
    session_key = "hermes::hermes-default::chat-123"
    now = _now()
    async with get_db_context() as session:
        session.add(
            Session(
                session_id=session_key,
                platform="hermes",
                instance_id="hermes-default",
                source_session_id="chat-123",
                session_key=session_key,
                channel="webchat",
                first_seen_at=now,
                last_activity_at=now,
                current_model_provider="openrouter",
                current_model_name="deepseek-v4-pro",
            )
        )

    chat_routes._hermes_session_model_info.clear()
    await chat_routes._persist_hermes_chat_turn(
        session_key=session_key,
        session_id=None,
        user_text="hi",
        assistant_text="hello",
        usage={"input_tokens": 11, "output_tokens": 7, "total_tokens": 18},
    )

    async with get_db_context() as session:
        rows = (
            await session.execute(
                select(Message).where(Message.session_id == session_key, Message.role == "assistant")
            )
        ).scalars().all()

    assert len(rows) == 1
    assert rows[0].provider == "openrouter"
    assert rows[0].model_id == "openrouter/deepseek-v4-pro"


def test_patch_existing_message_replaces_placeholder_model_fields():
    existing = Message(
        session_id="s1",
        message_id="m1",
        platform="nanobot",
        instance_id="nanobot-default",
        source_session_id="src-1",
        role="assistant",
        timestamp=_now(),
        provider="nanobot",
        model_id="nanobot",
    )
    parsed = ParsedMessage(
        source_message_id="src-msg",
        source_parent_message_id=None,
        role="assistant",
        timestamp=_now(),
        content_text="hello",
        provider="nanobot",
        model_id="nanobot",
    )
    RuntimeSyncWorker._patch_existing_message(
        existing,
        parsed,
        session_model_provider="openrouter",
        session_model_name="anthropic/claude-opus-4.7",
    )
    assert existing.provider == "openrouter"
    assert existing.model_id == "anthropic/claude-opus-4.7"

    existing_real = Message(
        session_id="s2",
        message_id="m2",
        platform="openclaw",
        instance_id="openclaw-default",
        source_session_id="src-2",
        role="assistant",
        timestamp=_now(),
        provider="deepseek",
        model_id="deepseek-chat",
    )
    RuntimeSyncWorker._patch_existing_message(
        existing_real,
        parsed,
        session_model_provider="openrouter",
        session_model_name="anthropic/claude-opus-4.7",
    )
    assert existing_real.provider == "deepseek"
    assert existing_real.model_id == "deepseek-chat"
