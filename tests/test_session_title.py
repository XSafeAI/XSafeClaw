from fastapi.testclient import TestClient
import pytest

from xsafeclaw.api.main import app
from xsafeclaw.api.routes import chat as chat_routes
from xsafeclaw.services import guard_service
from xsafeclaw.services.guard_service import (
    clean_runtime_session_title,
    extract_runtime_title_candidate_for_attempt,
    runtime_title_system_prompt_for_attempt,
    summarize_runtime_request_title,
)


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
    async def fake_model_prompt(
        prompt: str,
        *,
        platform: str,
        instance_id: str,
        max_tokens: int,
        system_prompt: str | None = None,
        temperature: float = 0.2,
    ) -> str:
        assert temperature == 0.0
        assert "Return strict JSON only" not in prompt
        assert system_prompt is not None
        assert "silent UI session title generator" in system_prompt
        assert "Return strict JSON only" in system_prompt
        assert "Valid JSON response" in system_prompt
        assert "10 Chinese characters or fewer" in system_prompt
        assert "帮我查一下今天的天气" in system_prompt
        assert "天气查询" in system_prompt
        assert "高考数学难度对比" in system_prompt
        assert "Math exam comparison" in system_prompt
        return '{"title":"上海天气查询"}'

    monkeypatch.setattr(guard_service, "call_runtime_model_prompt", fake_model_prompt)

    title = await summarize_runtime_request_title(
        "帮我查一下上海今天的天气怎么样？",
        platform="openclaw",
        instance_id="openclaw-main",
    )

    assert title == "上海天气查询"


def test_runtime_title_attempt_prompts_are_distinct():
    prompts = [runtime_title_system_prompt_for_attempt(index) for index in range(3)]

    assert len(set(prompts)) == 3
    assert "Return strict JSON only" in prompts[0]
    assert "title: ..." in prompts[1]
    assert "bare one-line title is acceptable" in prompts[2]


def test_runtime_title_candidate_parsing_gets_more_flexible_by_attempt():
    assert extract_runtime_title_candidate_for_attempt('{"title":"天气查询"}', 0) == "天气查询"
    assert extract_runtime_title_candidate_for_attempt('{"title":"天气查询","extra":true}', 0) == ""
    assert extract_runtime_title_candidate_for_attempt('```json\n{"title":"天气查询"}\n```', 1) == "天气查询"
    assert extract_runtime_title_candidate_for_attempt("title: 天气查询", 1) == "天气查询"
    assert extract_runtime_title_candidate_for_attempt("标题：高考数学难度对比", 1) == "高考数学难度对比"
    assert extract_runtime_title_candidate_for_attempt("天气查询", 2) == "天气查询"
    assert extract_runtime_title_candidate_for_attempt('"天气查询"', 2) == "天气查询"


@pytest.mark.asyncio
async def test_summarize_runtime_request_title_falls_back_when_model_explains(monkeypatch):
    async def fake_model_prompt(
        prompt: str,
        *,
        platform: str,
        instance_id: str,
        max_tokens: int,
        system_prompt: str | None = None,
        temperature: float = 0.2,
    ) -> str:
        assert temperature == 0.0
        assert system_prompt is not None
        return "我们需根据用户请求生成UI标题。用户请求是中文：“帮我查一下上海今天的天气怎么样？” 规则要求使用同一种语言。"

    monkeypatch.setattr(guard_service, "call_runtime_model_prompt", fake_model_prompt)

    title = await summarize_runtime_request_title(
        "帮我查一下上海今天的天气怎么样？",
        platform="openclaw",
        instance_id="openclaw-main",
    )

    assert title == "上海天气查询"


@pytest.mark.asyncio
async def test_summarize_runtime_request_title_falls_back_when_generated_title_is_too_long(monkeypatch):
    async def fake_model_prompt(
        prompt: str,
        *,
        platform: str,
        instance_id: str,
        max_tokens: int,
        system_prompt: str | None = None,
        temperature: float = 0.2,
    ) -> str:
        assert temperature == 0.0
        assert system_prompt is not None
        return '{"title":"帮我查询上海今天详细天气预报情况"}'

    monkeypatch.setattr(guard_service, "call_runtime_model_prompt", fake_model_prompt)

    title = await summarize_runtime_request_title(
        "帮我查天气",
        platform="openclaw",
        instance_id="openclaw-main",
    )

    assert title == "天气查询"


@pytest.mark.asyncio
async def test_summarize_runtime_request_title_retries_until_valid_title(monkeypatch):
    calls: list[str] = []
    system_prompts: list[str] = []

    async def fake_model_prompt(
        prompt: str,
        *,
        platform: str,
        instance_id: str,
        max_tokens: int,
        system_prompt: str | None = None,
        temperature: float = 0.2,
    ) -> str:
        _ = platform, instance_id
        assert temperature == 0.0
        calls.append(prompt)
        assert system_prompt is not None
        system_prompts.append(system_prompt)
        assert max_tokens == 48
        if len(calls) == 1:
            return "我们需根据用户请求生成UI标题。"
        return "标题：高考数学难度对比"

    monkeypatch.setattr(guard_service, "call_runtime_model_prompt", fake_model_prompt)

    title = await summarize_runtime_request_title(
        "今年高考数学难度大吗？相比去年，是难了还是简单了？",
        platform="openclaw",
        instance_id="openclaw-main",
    )

    assert title == "高考数学难度对比"
    assert len(calls) == 2
    assert len(set(system_prompts)) == 2
    assert "could not be parsed" in calls[1]


@pytest.mark.asyncio
async def test_summarize_runtime_request_title_accepts_bare_title_on_third_attempt(monkeypatch):
    calls = 0
    system_prompts: list[str] = []

    async def fake_model_prompt(
        prompt: str,
        *,
        platform: str,
        instance_id: str,
        max_tokens: int,
        system_prompt: str | None = None,
        temperature: float = 0.2,
    ) -> str:
        nonlocal calls
        _ = prompt, platform, instance_id, max_tokens
        assert temperature == 0.0
        assert system_prompt is not None
        system_prompts.append(system_prompt)
        calls += 1
        if calls == 1:
            return "我们需根据用户请求生成UI标题。"
        if calls == 2:
            return "标题：今年高考数学难度相比去年是难了还是简单了"
        return "高考数学难度对比"

    monkeypatch.setattr(guard_service, "call_runtime_model_prompt", fake_model_prompt)

    title = await summarize_runtime_request_title(
        "今年高考数学难度大吗？相比去年，是难了还是简单了？",
        platform="openclaw",
        instance_id="openclaw-main",
    )

    assert title == "高考数学难度对比"
    assert calls == 3
    assert len(set(system_prompts)) == 3


@pytest.mark.asyncio
async def test_summarize_runtime_request_title_retries_after_model_error(monkeypatch):
    calls = 0

    async def fake_model_prompt(
        prompt: str,
        *,
        platform: str,
        instance_id: str,
        max_tokens: int,
        system_prompt: str | None = None,
        temperature: float = 0.2,
    ) -> str:
        nonlocal calls
        _ = prompt, platform, instance_id, max_tokens, system_prompt
        assert temperature == 0.0
        calls += 1
        if calls == 1:
            raise RuntimeError("temporary title model failure")
        return '{"title":"高考难度对比"}'

    monkeypatch.setattr(guard_service, "call_runtime_model_prompt", fake_model_prompt)

    title = await summarize_runtime_request_title(
        "今年高考数学难度大吗？相比去年，是难了还是简单了？",
        platform="openclaw",
        instance_id="openclaw-main",
    )

    assert title == "高考难度对比"
    assert calls == 2


@pytest.mark.asyncio
async def test_summarize_runtime_request_title_falls_back_after_three_invalid_attempts(monkeypatch):
    calls = 0

    async def fake_model_prompt(
        prompt: str,
        *,
        platform: str,
        instance_id: str,
        max_tokens: int,
        system_prompt: str | None = None,
        temperature: float = 0.2,
    ) -> str:
        nonlocal calls
        _ = prompt, platform, instance_id, max_tokens, system_prompt
        assert temperature == 0.0
        calls += 1
        return '{"title":"今年高考数学难度相比去年是难了还是简单了"}'

    monkeypatch.setattr(guard_service, "call_runtime_model_prompt", fake_model_prompt)

    title = await summarize_runtime_request_title(
        "今年高考数学难度大吗？相比去年，是难了还是简单了？",
        platform="openclaw",
        instance_id="openclaw-main",
    )

    assert title == "高考数学难度对比"
    assert calls == 3


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
