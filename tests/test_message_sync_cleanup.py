"""Tests for ``MessageSyncService._cleanup_stale_sessions`` semantics.

These tests pin the new behaviour introduced when XSafeClaw stopped tearing
down Hermes direct-persist sessions on restart:

* Sessions whose ``jsonl_file_path`` is set were created by JSONL ingestion
  and may legitimately be removed when the runtime file disappears upstream.
* Sessions whose ``jsonl_file_path`` is NULL were written directly to SQLite
  by ``api/routes/chat.py`` (the Hermes direct-persist path) and MUST survive
  restart-time stale cleanup, since the runtime never produced a JSONL.

The other two runtimes are exercised to make sure the narrowed condition
does not change their behaviour: any OpenClaw / Nanobot row carries a
``jsonl_file_path`` from ``MessageSyncService._sync_file``, so missing files
still trigger cleanup the way they always did.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from xsafeclaw import database
from xsafeclaw.api.routes.sessions import delete_session, get_session, list_sessions
from xsafeclaw.config import settings
from xsafeclaw.database import get_db_context, init_db
from xsafeclaw.models import DeletedSessionTombstone, Message, Session
from xsafeclaw.runtime import namespace_session_id
from xsafeclaw.runtime.models import RuntimeInstance, empty_capabilities
from xsafeclaw.runtime.parsing import ParsedMessage, ParsedSessionBatch, ParsedSessionInfo
from xsafeclaw.services.event_sync_service import EventSyncService
from xsafeclaw.services.message_sync_service import RuntimeSyncWorker


# ── Helpers ──────────────────────────────────────────────────────────────────


def _build_instance(platform: str, *, instance_id: str | None = None) -> RuntimeInstance:
    """Return a minimal RuntimeInstance used to drive a worker in tests."""
    caps = empty_capabilities()
    caps["monitoring"] = True
    return RuntimeInstance(
        instance_id=instance_id or f"{platform}-default",
        platform=platform,  # type: ignore[arg-type]
        display_name=platform.capitalize(),
        capabilities=caps,
    )


def _build_worker(instance: RuntimeInstance) -> RuntimeSyncWorker:
    return RuntimeSyncWorker(instance, EventSyncService())


def _now() -> datetime:
    return datetime.now(timezone.utc)


@pytest.fixture
async def db(tmp_path, monkeypatch):
    """Spin up a fresh SQLite database per test and reset the global engine."""
    db_path = tmp_path / "cleanup-test.db"
    url = f"sqlite+aiosqlite:///{db_path}"

    monkeypatch.setattr(settings, "database_url", url)
    monkeypatch.setattr(database, "_engine", None)
    monkeypatch.setattr(database, "_session_factory", None)

    await init_db()
    try:
        yield
    finally:
        await database.close_db()


# ── Hermes direct-persist preservation ───────────────────────────────────────


@pytest.mark.asyncio
async def test_hermes_direct_persist_session_survives_cleanup(db):
    """A Hermes Session row with NULL jsonl_file_path must not be purged.

    Reproduces the regression that caused Hermes chat history to disappear
    after XSafeClaw restarts: ``_cleanup_stale_sessions`` previously removed
    any Session whose ``source_session_id`` was missing from the on-disk
    JSONL set, even though Hermes direct-persist sessions are intentionally
    file-less.
    """
    instance = _build_instance("hermes")
    direct_session_id = "hermes-direct"

    async with get_db_context() as session:
        session.add(
            Session(
                session_id=direct_session_id,
                platform="hermes",
                instance_id=instance.instance_id,
                source_session_id="hermes-direct-source",
                session_key="hermes::hermes-default::chat-direct",
                channel="webchat",
                first_seen_at=_now(),
                last_activity_at=_now(),
                jsonl_file_path=None,
            )
        )
        session.add(
            Message(
                session_id=direct_session_id,
                message_id="msg-direct-user",
                platform="hermes",
                instance_id=instance.instance_id,
                source_session_id="hermes-direct-source",
                role="user",
                timestamp=_now(),
                content_text="hello",
            )
        )

    worker = _build_worker(instance)
    # Empty existing_source_ids simulates a runtime that produced no JSONL,
    # which is the steady state for Hermes direct-persist sessions.
    await worker._cleanup_stale_sessions(set())

    async with get_db_context() as session:
        rows = (await session.execute(select(Session))).scalars().all()
        msg_rows = (await session.execute(select(Message))).scalars().all()

    assert [row.session_id for row in rows] == [direct_session_id]
    assert [row.message_id for row in msg_rows] == ["msg-direct-user"]


# ── JSONL-backed stale cleanup still works ──────────────────────────────────


@pytest.mark.asyncio
async def test_hermes_jsonl_backed_session_is_still_cleaned_up(db):
    """If a Hermes session row points at a JSONL but the file is gone, drop it."""
    instance = _build_instance("hermes")
    jsonl_session_id = "hermes-jsonl"

    async with get_db_context() as session:
        session.add(
            Session(
                session_id=jsonl_session_id,
                platform="hermes",
                instance_id=instance.instance_id,
                source_session_id="hermes-jsonl-source",
                session_key="hermes::hermes-default::chat-jsonl",
                channel="webchat",
                first_seen_at=_now(),
                last_activity_at=_now(),
                jsonl_file_path="/tmp/hermes/sessions/hermes-jsonl.jsonl",
            )
        )

    worker = _build_worker(instance)
    await worker._cleanup_stale_sessions(set())

    async with get_db_context() as session:
        rows = (await session.execute(select(Session))).scalars().all()

    assert rows == []


# ── Other runtimes are unaffected ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_openclaw_jsonl_backed_session_is_cleaned_up(db):
    """OpenClaw rows always carry jsonl_file_path; cleanup must still purge them."""
    instance = _build_instance("openclaw")
    openclaw_session_id = "openclaw-stale"

    async with get_db_context() as session:
        session.add(
            Session(
                session_id=openclaw_session_id,
                platform="openclaw",
                instance_id=instance.instance_id,
                source_session_id="openclaw-stale-source",
                session_key="openclaw::openclaw-default::chat-stale",
                channel="webchat",
                first_seen_at=_now(),
                last_activity_at=_now(),
                jsonl_file_path="/tmp/openclaw/sessions/openclaw-stale.jsonl",
            )
        )

    worker = _build_worker(instance)
    await worker._cleanup_stale_sessions(set())

    async with get_db_context() as session:
        rows = (await session.execute(select(Session))).scalars().all()

    assert rows == []


@pytest.mark.asyncio
async def test_openclaw_session_with_matching_source_id_is_kept(db):
    """If the JSONL is still present, the row stays."""
    instance = _build_instance("openclaw")
    openclaw_session_id = "openclaw-live"
    source_id = "openclaw-live-source"

    async with get_db_context() as session:
        session.add(
            Session(
                session_id=openclaw_session_id,
                platform="openclaw",
                instance_id=instance.instance_id,
                source_session_id=source_id,
                session_key="openclaw::openclaw-default::chat-live",
                channel="webchat",
                first_seen_at=_now(),
                last_activity_at=_now(),
                jsonl_file_path="/tmp/openclaw/sessions/openclaw-live.jsonl",
            )
        )

    worker = _build_worker(instance)
    await worker._cleanup_stale_sessions({source_id})

    async with get_db_context() as session:
        rows = (await session.execute(select(Session))).scalars().all()

    assert [row.session_id for row in rows] == [openclaw_session_id]


@pytest.mark.asyncio
async def test_other_instance_rows_are_left_alone(db):
    """Cleanup is scoped to ``instance.platform`` + ``instance.instance_id``."""
    hermes_instance = _build_instance("hermes")

    async with get_db_context() as session:
        session.add(
            Session(
                session_id="other-runtime",
                platform="openclaw",
                instance_id="openclaw-default",
                source_session_id="other-source",
                session_key="openclaw::openclaw-default::other",
                channel="webchat",
                first_seen_at=_now(),
                last_activity_at=_now(),
                jsonl_file_path="/tmp/openclaw/sessions/other-source.jsonl",
            )
        )

    worker = _build_worker(hermes_instance)
    # Even with empty existing_source_ids the cross-runtime row must survive
    # because the worker is a Hermes worker, not an OpenClaw worker.
    await worker._cleanup_stale_sessions(set())

    async with get_db_context() as session:
        rows = (await session.execute(select(Session))).scalars().all()

    assert [row.session_id for row in rows] == ["other-runtime"]


# ─── User-deleted tombstones ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_session_creates_tombstone_and_removes_db_rows(db):
    """Deleting a JSONL-backed session records a durable tombstone."""
    instance = _build_instance("openclaw")
    source_id = "openclaw-deleted-source"
    session_id = namespace_session_id("openclaw", instance.instance_id, source_id)

    async with get_db_context() as db_session:
        db_session.add(
            Session(
                session_id=session_id,
                platform="openclaw",
                instance_id=instance.instance_id,
                source_session_id=source_id,
                session_key="openclaw::openclaw-default::chat-deleted",
                channel="webchat",
                first_seen_at=_now(),
                last_activity_at=_now(),
                jsonl_file_path="/tmp/openclaw/sessions/openclaw-deleted-source.jsonl",
            )
        )
        db_session.add(
            Message(
                session_id=session_id,
                message_id="msg-deleted-user",
                platform="openclaw",
                instance_id=instance.instance_id,
                source_session_id=source_id,
                role="user",
                timestamp=_now(),
                content_text="delete me",
            )
        )
        await db_session.flush()

        response = await delete_session(session_id, db_session)

    assert response["message"] == f"Session {session_id} deleted successfully"

    async with get_db_context() as db_session:
        sessions = (await db_session.execute(select(Session))).scalars().all()
        messages = (await db_session.execute(select(Message))).scalars().all()
        tombstones = (await db_session.execute(select(DeletedSessionTombstone))).scalars().all()

    assert sessions == []
    assert messages == []
    assert len(tombstones) == 1
    assert tombstones[0].platform == "openclaw"
    assert tombstones[0].instance_id == instance.instance_id
    assert tombstones[0].source_session_id == source_id
    assert tombstones[0].session_id == session_id


@pytest.mark.asyncio
async def test_tombstoned_session_row_is_hidden_from_session_api(db):
    """A tombstone wins even if a racing sync leaves a Session row behind."""
    instance = _build_instance("openclaw")
    source_id = "openclaw-hidden-source"
    session_id = namespace_session_id("openclaw", instance.instance_id, source_id)

    async with get_db_context() as db_session:
        db_session.add(
            Session(
                session_id=session_id,
                platform="openclaw",
                instance_id=instance.instance_id,
                source_session_id=source_id,
                session_key="openclaw::openclaw-default::chat-hidden",
                channel="webchat",
                first_seen_at=_now(),
                last_activity_at=_now(),
                jsonl_file_path="/tmp/openclaw/sessions/openclaw-hidden-source.jsonl",
            )
        )
        db_session.add(
            DeletedSessionTombstone(
                platform="openclaw",
                instance_id=instance.instance_id,
                source_session_id=source_id,
                session_id=session_id,
            )
        )
        await db_session.flush()

        list_response = await list_sessions(
            page=1,
            page_size=20,
            platform=None,
            instance_id=None,
            db=db_session,
        )
        with pytest.raises(HTTPException) as exc_info:
            await get_session(session_id, db_session)

    assert list_response.total == 0
    assert list_response.sessions == []
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_tombstoned_jsonl_session_is_not_reimported(db, tmp_path):
    """A deleted JSONL-backed session stays deleted while the source file remains."""
    instance = _build_instance("openclaw")
    worker = _build_worker(instance)
    source_id = "openclaw-reimport-source"
    session_id = namespace_session_id("openclaw", instance.instance_id, source_id)
    jsonl_path = tmp_path / f"{source_id}.jsonl"
    jsonl_path.write_text("", encoding="utf-8")
    parsed_batch = ParsedSessionBatch(
        session=ParsedSessionInfo(
            source_session_id=source_id,
            session_key=source_id,
            first_seen_at=_now(),
            last_activity_at=_now(),
            jsonl_file_path=str(jsonl_path),
        ),
        messages=[
            ParsedMessage(
                source_message_id="msg-1",
                source_parent_message_id=None,
                role="user",
                timestamp=_now(),
                content_text="this should not come back",
            )
        ],
        total_lines=1,
    )

    async def fake_parse_file(file_path, start_line):
        assert file_path == jsonl_path
        assert start_line == 0
        return parsed_batch

    worker._parse_file = fake_parse_file  # type: ignore[method-assign]

    async with get_db_context() as db_session:
        db_session.add(
            DeletedSessionTombstone(
                platform="openclaw",
                instance_id=instance.instance_id,
                source_session_id=source_id,
                session_id=session_id,
                jsonl_file_path=str(jsonl_path),
            )
        )

    await worker._sync_file(jsonl_path, full_sync=True)

    async with get_db_context() as db_session:
        sessions = (await db_session.execute(select(Session))).scalars().all()
        messages = (await db_session.execute(select(Message))).scalars().all()

    assert sessions == []
    assert messages == []
    assert worker._sync_positions[str(jsonl_path)] == 1
