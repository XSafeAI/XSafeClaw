"""Tests for API endpoints."""

from fastapi.testclient import TestClient

from xsafeclaw.api.main import app
from xsafeclaw.api.routes import chat
from xsafeclaw.risk_rules import build_risk_rule, save_risk_rules


def test_chat_message_is_blocked_by_persisted_risk_rule(tmp_path, monkeypatch):
    rules_file = tmp_path / "risk_rules.json"
    save_risk_rules(
        rules_file,
        [
            build_risk_rule(
                category_key="benign_info",
                category="低风险（信息查询类）",
                severity="low",
                intent="今天几号？",
                risk_signals=[],
                reason="来自风险测试的长期规则：低风险（信息查询类）",
            )
        ],
    )
    monkeypatch.setattr(chat, "_RISK_RULES_FILE", rules_file)

    client = TestClient(app)
    response = client.post(
        "/api/chat/send-message",
        json={"session_key": "chat-test-1", "message": "今天几号"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["state"] == "final"
    assert payload["stop_reason"] == "blocked_by_persistent_rule"
    assert "该指令已写入长期防护规则" in payload["response_text"]
