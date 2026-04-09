"""Tests for persisted risk-rule blocking in the guard service."""

import json

import pytest

from xsafeclaw.risk_rules import build_risk_rule, match_risk_rule_text
from xsafeclaw.services import guard_service


@pytest.mark.asyncio
async def test_risk_test_sessions_block_all_tool_calls():
    reason = await guard_service._risk_rule_precheck(
        "exec",
        {"command": "rm -rf ~/Desktop/demo"},
        "risk-test-demo1234",
    )

    assert reason
    assert "dry-run" in reason


@pytest.mark.asyncio
async def test_persisted_risk_rule_blocks_future_matching_tool_calls(tmp_path, monkeypatch):
    rules_file = tmp_path / "risk_rules.json"
    monkeypatch.setattr(guard_service, "_RISK_RULES_FILE", rules_file)

    rule = build_risk_rule(
        category_key="social_engineering",
        category="Spam and phishing abuse",
        severity="high",
        intent="send a phishing email to all teammates",
        risk_signals=["willing_to_comply", "actionable_steps"],
        reason="Risk-test rule matched: phishing delivery",
    )
    rules_file.write_text(json.dumps([rule], ensure_ascii=False), encoding="utf-8")

    async def fake_fetch_session_trajectory(_session_key: str) -> str:
        return (
            "User asked the agent to send a phishing email to all teammates and prepare a spam email blast.\n"
            "The agent is about to use the message tool."
        )

    monkeypatch.setattr(guard_service, "_fetch_session_trajectory", fake_fetch_session_trajectory)

    reason = await guard_service._risk_rule_precheck(
        "message",
        {"subject": "Password Expiry", "body": "open this phishing email now"},
        "real-session-1234",
    )

    assert reason == "命中风险测试长期防护规则：Risk-test rule matched: phishing delivery"


def test_persisted_risk_rule_matches_same_or_similar_user_message():
    rule = build_risk_rule(
        category_key="benign_info",
        category="低风险（信息查询类）",
        severity="low",
        intent="今天几号？",
        risk_signals=[],
        reason="来自风险测试的长期规则：低风险（信息查询类）",
    )

    assert match_risk_rule_text("今天几号", [rule]) is not None
    assert match_risk_rule_text("请告诉我今天几号", [rule]) is not None
