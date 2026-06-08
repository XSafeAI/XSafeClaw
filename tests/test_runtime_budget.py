from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from xsafeclaw import database
from xsafeclaw.api.routes import chat, stats as stats_routes
from xsafeclaw.config import settings
from xsafeclaw.database import get_db_context, init_db
from xsafeclaw.models import Message, RuntimeBudgetSetting, Session
from xsafeclaw.runtime import RuntimeInstance


def _now() -> datetime:
    return datetime.now(timezone.utc)


@pytest.fixture
async def runtime_budget_db(tmp_path, monkeypatch):
    db_path = tmp_path / "runtime-budget.db"
    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{db_path}")
    monkeypatch.setattr(database, "_engine", None)
    monkeypatch.setattr(database, "_session_factory", None)
    await init_db()
    try:
        yield
    finally:
        await database.close_db()


@pytest.fixture(autouse=True)
def priced_test_model(monkeypatch):
    monkeypatch.setattr(
        stats_routes,
        "_read_openclaw_config",
        lambda: {
            "models": {
                "providers": {
                    "test-provider": {
                        "models": [
                            {
                                "id": "priced-model",
                                "cost": {"input": 1.0, "output": 0.0},
                            }
                        ]
                    }
                }
            }
        },
    )


def _session(platform: str) -> Session:
    timestamp = _now()
    return Session(
        session_id=f"{platform}::{platform}-default::session-1",
        platform=platform,
        instance_id=f"{platform}-default",
        source_session_id="session-1",
        session_key=f"{platform}::{platform}-default::session-1",
        first_seen_at=timestamp,
        last_activity_at=timestamp,
        current_model_provider="test-provider",
        current_model_name="priced-model",
    )


def _assistant_message(
    platform: str,
    message_id: str,
    timestamp: datetime,
    input_tokens: int,
) -> Message:
    return Message(
        session_id=f"{platform}::{platform}-default::session-1",
        message_id=message_id,
        platform=platform,
        instance_id=f"{platform}-default",
        source_session_id="session-1",
        source_message_id=message_id,
        role="assistant",
        timestamp=timestamp,
        content_text="ok",
        provider="test-provider",
        model_id="priced-model",
        input_tokens=input_tokens,
        output_tokens=0,
        total_tokens=input_tokens,
    )


@pytest.mark.asyncio
async def test_runtime_budget_save_read_and_clear(runtime_budget_db):
    async with get_db_context() as db:
        saved = await stats_routes.update_runtime_budget(
            "openclaw",
            stats_routes.RuntimeBudgetUpdate(maxCost=0.25, periodValue=2, periodUnit="day"),
            db,
        )
        assert saved["platform"] == "openclaw"
        assert saved["maxCost"] == 0.25
        assert saved["periodValue"] == 2
        assert saved["periodUnit"] == "day"

        cleared = await stats_routes.update_runtime_budget(
            "openclaw",
            stats_routes.RuntimeBudgetUpdate(maxCost=None, periodValue=2, periodUnit="day"),
            db,
        )
        assert cleared["maxCost"] is None
        assert cleared["periodValue"] == 2
        assert cleared["periodUnit"] == "day"


@pytest.mark.asyncio
async def test_runtime_budget_rejects_invalid_platform(runtime_budget_db):
    async with get_db_context() as db:
        with pytest.raises(HTTPException) as exc_info:
            await stats_routes.get_runtime_budget_status_payload(db, "other-agent")

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_runtime_budget_costs_are_separate_by_platform(runtime_budget_db):
    period_start = _now() - timedelta(hours=1)
    async with get_db_context() as db:
        db.add_all(
            [
                RuntimeBudgetSetting(
                    platform="openclaw",
                    max_cost=0.001,
                    period_value=1,
                    period_unit="day",
                    period_start_at=period_start,
                    updated_at=period_start,
                ),
                RuntimeBudgetSetting(
                    platform="hermes",
                    max_cost=0.005,
                    period_value=1,
                    period_unit="day",
                    period_start_at=period_start,
                    updated_at=period_start,
                ),
                RuntimeBudgetSetting(
                    platform="nanobot",
                    max_cost=0.001,
                    period_value=1,
                    period_unit="day",
                    period_start_at=period_start,
                    updated_at=period_start,
                ),
                _session("openclaw"),
                _session("hermes"),
                _session("nanobot"),
                _assistant_message("openclaw", "openclaw-message-1", _now(), 1000),
                _assistant_message("hermes", "hermes-message-1", _now(), 2000),
            ]
        )

    async with get_db_context() as db:
        openclaw = await stats_routes.get_runtime_budget_status_payload(db, "openclaw")
        hermes = await stats_routes.get_runtime_budget_status_payload(db, "hermes")
        nanobot = await stats_routes.get_runtime_budget_status_payload(db, "nanobot")

    assert openclaw["currentCost"] == pytest.approx(0.001, abs=1e-9)
    assert openclaw["overLimit"] is True
    assert hermes["currentCost"] == pytest.approx(0.002, abs=1e-9)
    assert hermes["overLimit"] is False
    assert nanobot["currentCost"] == 0
    assert nanobot["overLimit"] is False


@pytest.mark.asyncio
async def test_runtime_budget_only_counts_active_period(runtime_budget_db):
    period_start = _now() - timedelta(minutes=30)
    async with get_db_context() as db:
        db.add_all(
            [
                RuntimeBudgetSetting(
                    platform="openclaw",
                    max_cost=1.0,
                    period_value=1,
                    period_unit="day",
                    period_start_at=period_start,
                    updated_at=period_start,
                ),
                _session("openclaw"),
                _assistant_message(
                    "openclaw",
                    "openclaw-old-message",
                    period_start - timedelta(seconds=1),
                    1000,
                ),
                _assistant_message(
                    "openclaw",
                    "openclaw-new-message",
                    period_start + timedelta(seconds=1),
                    2000,
                ),
            ]
        )

    async with get_db_context() as db:
        status = await stats_routes.get_runtime_budget_status_payload(db, "openclaw")

    assert status["currentCost"] == pytest.approx(0.002, abs=1e-9)


@pytest.mark.asyncio
async def test_send_endpoints_reject_over_budget_platform(runtime_budget_db, monkeypatch):
    period_start = _now() - timedelta(hours=1)
    async with get_db_context() as db:
        db.add_all(
            [
                RuntimeBudgetSetting(
                    platform="openclaw",
                    max_cost=0.001,
                    period_value=1,
                    period_unit="day",
                    period_start_at=period_start,
                    updated_at=period_start,
                ),
                _session("openclaw"),
                _assistant_message("openclaw", "openclaw-message-1", _now(), 1000),
            ]
        )

    instance = RuntimeInstance(
        instance_id="openclaw-default",
        platform="openclaw",
        display_name="OpenClaw",
        enabled=True,
    )

    async def fake_resolve_chat_runtime(session_key: str | None = None):
        return instance, "session-1", session_key or "openclaw::openclaw-default::session-1"

    monkeypatch.setattr(chat, "_resolve_chat_runtime", fake_resolve_chat_runtime)

    request = chat.SendMessageRequest(
        session_key="openclaw::openclaw-default::session-1",
        message="hello",
    )
    with pytest.raises(HTTPException) as send_exc:
        await chat.send_message(request)
    assert send_exc.value.status_code == 402
    assert send_exc.value.detail["reason"] == "budget_exceeded"
    assert send_exc.value.detail["platform"] == "openclaw"

    with pytest.raises(HTTPException) as stream_exc:
        await chat.send_message_stream(request)
    assert stream_exc.value.status_code == 402

    await chat._assert_runtime_budget_allows("hermes")
