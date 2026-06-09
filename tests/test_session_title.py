from fastapi.testclient import TestClient
import pytest

from xsafeclaw.api.main import app
from xsafeclaw.api.routes import chat as chat_routes
from xsafeclaw.services import guard_service
from xsafeclaw.services.guard_service import clean_runtime_session_title, summarize_runtime_request_title


def test_clean_runtime_session_title_strips_prefix_quotes_and_limits_length():
    raw = '"Title: Fix login bug and add rate limit."\nextra detail'

    assert clean_runtime_session_title(raw) == "Fix login bug and add rate limit"
    assert clean_runtime_session_title("", fallback="Review protected file access") == "Review protected file access"
    assert clean_runtime_session_title("x" * 80) == ("x" * 48) + "..."


def test_clean_runtime_session_title_rejects_model_explanations():
    raw = "我们需根据用户请求生成UI标题。用户请求是中文：“帮我查一下上海今天的天气怎么样？” 规则要求使用同一种语言。"

    assert clean_runtime_session_title(raw, fallback="帮我查一下上海今天的天气怎么样？") == "帮我查一下上海今天的天气怎么样？"


@pytest.mark.asyncio
async def test_summarize_runtime_request_title_accepts_json_title(monkeypatch):
    async def fake_model_prompt(prompt: str, *, platform: str, instance_id: str, max_tokens: int) -> str:
        assert 'Return strict JSON only' in prompt
        return '{"title":"查询上海今日天气"}'

    monkeypatch.setattr(guard_service, "call_runtime_model_prompt", fake_model_prompt)

    title = await summarize_runtime_request_title(
        "帮我查一下上海今天的天气怎么样？",
        platform="openclaw",
        instance_id="openclaw-main",
    )

    assert title == "查询上海今日天气"


@pytest.mark.asyncio
async def test_summarize_runtime_request_title_falls_back_when_model_explains(monkeypatch):
    async def fake_model_prompt(prompt: str, *, platform: str, instance_id: str, max_tokens: int) -> str:
        return "我们需根据用户请求生成UI标题。用户请求是中文：“帮我查一下上海今天的天气怎么样？” 规则要求使用同一种语言。"

    monkeypatch.setattr(guard_service, "call_runtime_model_prompt", fake_model_prompt)

    title = await summarize_runtime_request_title(
        "帮我查一下上海今天的天气怎么样？",
        platform="openclaw",
        instance_id="openclaw-main",
    )

    assert title == "帮我查一下上海今天的天气怎么样？"


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
