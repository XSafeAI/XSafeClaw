from __future__ import annotations

from datetime import datetime, timezone

import pytest

from xsafeclaw import database
from xsafeclaw.api.routes import stats as stats_routes
from xsafeclaw.config import settings
from xsafeclaw.database import get_db_context, init_db
from xsafeclaw.models import Message, Session


def _now() -> datetime:
    return datetime.now(timezone.utc)


@pytest.fixture
async def db(tmp_path, monkeypatch):
    db_path = tmp_path / "stats-dashboard-fallback.db"
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
async def test_dashboard_resolves_cost_from_session_model_when_message_has_placeholder(db, monkeypatch):
    monkeypatch.setattr(
        stats_routes,
        "_read_openclaw_config",
        lambda: {
            "models": {
                "providers": {
                    "openrouter": {
                        "models": [
                            {
                                "id": "anthropic/claude-opus-4.7",
                                "cost": {"input": 1.0, "output": 3.0},
                            }
                        ]
                    }
                }
            }
        },
    )

    async def _fake_instances():
        return []

    monkeypatch.setattr(stats_routes, "list_instances", _fake_instances)

    async with get_db_context() as session:
        session.add(
            Session(
                session_id="hermes::hermes-default::chat-1",
                platform="hermes",
                instance_id="hermes-default",
                source_session_id="chat-1",
                session_key="hermes::hermes-default::chat-1",
                first_seen_at=_now(),
                last_activity_at=_now(),
                current_model_provider="openrouter",
                current_model_name="anthropic/claude-opus-4.7",
            )
        )
        session.add(
            Message(
                session_id="hermes::hermes-default::chat-1",
                message_id="m-assistant-1",
                platform="hermes",
                instance_id="hermes-default",
                source_session_id="chat-1",
                role="assistant",
                timestamp=_now(),
                content_text="ok",
                provider="hermes",
                model_id="hermes-agent",
                total_tokens=1000,
                input_tokens=None,
                output_tokens=None,
            )
        )

    async with get_db_context() as db_session:
        data = await stats_routes.get_dashboard(
            platform="hermes",
            instance_id="hermes-default",
            db=db_session,
        )

    assert data["cost"] == pytest.approx(0.002, abs=1e-9)
    assert data["costUnknownTokens"] == 0
    assert data["costBreakdown"][0]["priced"] is True
    assert data["costBreakdown"][0]["costMethod"] == "estimated_from_total"
    assert data["costBreakdown"][0]["resolvedProvider"] == "openrouter"
    assert data["costBreakdown"][0]["resolvedModelId"] == "anthropic/claude-opus-4.7"
