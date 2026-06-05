from fastapi.testclient import TestClient

from xsafeclaw.api.main import app
from xsafeclaw.api.routes import chat as chat_routes
from xsafeclaw.services.guard_service import clean_runtime_session_title


def test_clean_runtime_session_title_strips_prefix_quotes_and_limits_length():
    raw = '"Title: Fix login bug and add rate limit."\nextra detail'

    assert clean_runtime_session_title(raw) == "Fix login bug and add rate limit"
    assert clean_runtime_session_title("", fallback="Review protected file access") == "Review protected file access"
    assert clean_runtime_session_title("x" * 80) == ("x" * 48) + "..."


def test_session_title_endpoint_calls_runtime_model_without_chat_history(monkeypatch):
    seen: dict[str, str] = {}

    async def fake_summarize(message: str, *, platform: str, instance_id: str) -> str:
        seen["message"] = message
        seen["platform"] = platform
        seen["instance_id"] = instance_id
        return "Fix login rate limit"

    monkeypatch.setattr(chat_routes, "summarize_runtime_request_title", fake_summarize)
    client = TestClient(app)

    response = client.post(
        "/api/chat/session-title",
        json={
            "message": "Fix the login bug and add rate limiting.",
            "platform": "openclaw",
            "instance_id": "openclaw-main",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"title": "Fix login rate limit"}
    assert seen == {
        "message": "Fix the login bug and add rate limiting.",
        "platform": "openclaw",
        "instance_id": "openclaw-main",
    }
