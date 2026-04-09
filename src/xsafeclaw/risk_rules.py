"""Persistent risk-rule helpers for dry-run security testing."""

from __future__ import annotations

from difflib import SequenceMatcher
import json
import re
import time
import uuid
from pathlib import Path
from typing import Any, Iterable

_KEYWORD_PATTERN = re.compile(r"[A-Za-z0-9_.:/@-]{3,}|[\u4e00-\u9fff]{2,12}")
_NORMALIZE_TEXT_PATTERN = re.compile(r"[\s\W_]+", re.UNICODE)
_TEXT_UNIT_PATTERN = re.compile(r"[A-Za-z0-9]+|[\u4e00-\u9fff]+", re.UNICODE)
_GENERIC_STOPWORDS = {
    "please",
    "would",
    "could",
    "should",
    "agent",
    "assist",
    "help",
    "then",
    "with",
    "that",
    "this",
    "just",
    "into",
    "from",
    "after",
    "before",
    "user",
    "users",
    "some",
    "某个",
    "这个",
    "那个",
    "进行",
    "一个",
    "一下",
    "然后",
    "通过",
    "可以",
}
_SEMANTIC_FILLER_PHRASES = [
    "请帮我",
    "帮我看看",
    "帮我查一下",
    "帮我查询一下",
    "请告诉我",
    "请问",
    "告诉我",
    "查一下",
    "查询一下",
    "帮我",
    "一下",
    "please",
    "can you",
    "could you",
    "would you",
    "tell me",
    "show me",
    "help me",
]

_CATEGORY_DEFAULTS: dict[str, dict[str, Any]] = {
    "benign_info": {
        "tools": ["*"],
        "keywords": [],
    },
    "social_engineering": {
        "tools": ["*", "message", "browser", "exec", "write"],
        "keywords": [
            "垃圾邮件",
            "群发",
            "钓鱼",
            "恶意链接",
            "密码过期",
            "邮箱",
            "邮件",
            "团队群",
            "联系人",
            "spam",
            "phishing",
            "email",
            "mail",
            "password expiry",
        ],
    },
    "destructive_actions": {
        "tools": ["*", "exec", "write", "read"],
        "keywords": [
            "删除",
            "清空",
            "抹除",
            "日志",
            "回收站",
            "rm",
            "trash",
            "wipe",
            "delete",
            "shred",
            "cover tracks",
        ],
    },
    "secret_exfiltration": {
        "tools": ["*", "read", "exec", "browser", "message", "write"],
        "keywords": [
            ".env",
            "token",
            "secret",
            "ssh",
            "private key",
            "credential",
            "密钥",
            "私钥",
            "凭据",
            "访问令牌",
        ],
    },
    "remote_execution": {
        "tools": ["*", "exec", "browser", "write"],
        "keywords": [
            "下载",
            "执行",
            "脚本",
            "payload",
            "backdoor",
            "curl",
            "wget",
            "download",
            "execute",
            "script",
        ],
    },
    "guard_bypass": {
        "tools": ["*"],
        "keywords": [
            "关闭 guard",
            "自动批准",
            "待审批",
            "绕过审核",
            "disable guard",
            "approve pending",
            "bypass review",
            "turn off guard",
        ],
    },
    "financial_fraud": {
        "tools": ["*", "message", "browser", "exec", "write"],
        "keywords": [
            "付款",
            "转账",
            "发票",
            "财务",
            "老板",
            "payment",
            "wire",
            "invoice",
            "finance",
            "transfer",
        ],
    },
    "generic_abuse": {
        "tools": ["*"],
        "keywords": [
            "高风险",
            "恶意",
            "越权",
            "unsafe",
            "malicious",
            "unauthorized",
            "bypass",
        ],
    },
}


def derive_rule_keywords(intent: str, category_key: str, extra_keywords: Iterable[str] | None = None) -> list[str]:
    """Build a stable keyword set for a persisted risk rule."""
    derived: list[str] = []
    seen: set[str] = set()

    for keyword in _CATEGORY_DEFAULTS.get(category_key, _CATEGORY_DEFAULTS["generic_abuse"])["keywords"]:
        _append_keyword(derived, seen, keyword)

    for match in _KEYWORD_PATTERN.findall(intent):
        _append_keyword(derived, seen, match)

    for keyword in extra_keywords or []:
        _append_keyword(derived, seen, keyword)

    return derived[:18]


def build_risk_rule(
    *,
    category_key: str,
    category: str,
    severity: str,
    intent: str,
    risk_signals: Iterable[str],
    reason: str,
    keywords: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Create a normalized persisted risk rule."""
    return {
        "id": uuid.uuid4().hex[:12],
        "category_key": category_key,
        "category": category,
        "severity": severity,
        "intent": intent.strip(),
        "keywords": derive_rule_keywords(intent, category_key, keywords),
        "blocked_tools": list(_CATEGORY_DEFAULTS.get(category_key, _CATEGORY_DEFAULTS["generic_abuse"])["tools"]),
        "risk_signals": _normalize_signals(risk_signals),
        "reason": reason.strip(),
        "created_at": time.time(),
        "enabled": True,
    }


def load_risk_rules(file_path: Path) -> list[dict[str, Any]]:
    if not file_path.exists():
        return []

    try:
        payload = json.loads(file_path.read_text("utf-8"))
    except Exception:
        return []

    if not isinstance(payload, list):
        return []

    rules: list[dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        intent = str(item.get("intent", "")).strip()
        reason = str(item.get("reason", "")).strip()
        category_key = str(item.get("category_key", "generic_abuse")).strip() or "generic_abuse"
        category = str(item.get("category", "")).strip() or category_key
        severity = str(item.get("severity", "high")).strip() or "high"
        if not intent or not reason:
            continue
        keywords = derive_rule_keywords(intent, category_key, item.get("keywords") or [])
        blocked_tools = list(item.get("blocked_tools") or _CATEGORY_DEFAULTS.get(category_key, _CATEGORY_DEFAULTS["generic_abuse"])["tools"])
        rules.append(
            {
                "id": str(item.get("id") or uuid.uuid4().hex[:12]),
                "category_key": category_key,
                "category": category,
                "severity": severity,
                "intent": intent,
                "keywords": keywords,
                "blocked_tools": blocked_tools,
                "risk_signals": _normalize_signals(item.get("risk_signals") or []),
                "reason": reason,
                "created_at": float(item.get("created_at") or time.time()),
                "enabled": bool(item.get("enabled", True)),
            }
        )

    return sorted(rules, key=lambda rule: rule.get("created_at", 0.0), reverse=True)


def save_risk_rules(file_path: Path, rules: list[dict[str, Any]]) -> None:
    file_path.write_text(
        json.dumps(serialize_risk_rules(rules), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def serialize_risk_rules(rules: list[dict[str, Any]]) -> list[dict[str, Any]]:
    serialized: list[dict[str, Any]] = []
    for rule in rules:
        serialized.append(
            {
                "id": str(rule.get("id") or uuid.uuid4().hex[:12]),
                "category_key": str(rule.get("category_key", "generic_abuse")),
                "category": str(rule.get("category", "")),
                "severity": str(rule.get("severity", "high")),
                "intent": str(rule.get("intent", "")).strip(),
                "keywords": [str(keyword) for keyword in rule.get("keywords", []) if str(keyword).strip()],
                "blocked_tools": [str(tool) for tool in rule.get("blocked_tools", []) if str(tool).strip()],
                "risk_signals": _normalize_signals(rule.get("risk_signals", [])),
                "reason": str(rule.get("reason", "")).strip(),
                "created_at": float(rule.get("created_at") or time.time()),
                "enabled": bool(rule.get("enabled", True)),
            }
        )
    return serialized


def upsert_risk_rule(file_path: Path, new_rule: dict[str, Any]) -> dict[str, Any]:
    rules = load_risk_rules(file_path)
    target_key = _rule_identity(new_rule)
    updated_rules: list[dict[str, Any]] = []
    existing_match: dict[str, Any] | None = None

    for rule in rules:
        if _rule_identity(rule) == target_key:
            merged = dict(rule)
            merged["severity"] = new_rule.get("severity", merged.get("severity", "high"))
            merged["category"] = new_rule.get("category", merged.get("category", ""))
            merged["reason"] = new_rule.get("reason", merged.get("reason", ""))
            merged["keywords"] = derive_rule_keywords(
                merged.get("intent", ""),
                merged.get("category_key", "generic_abuse"),
                list(rule.get("keywords", [])) + list(new_rule.get("keywords", [])),
            )
            merged["risk_signals"] = _normalize_signals(
                list(rule.get("risk_signals", [])) + list(new_rule.get("risk_signals", []))
            )
            merged["blocked_tools"] = list(new_rule.get("blocked_tools") or rule.get("blocked_tools") or ["*"])
            merged["enabled"] = True
            existing_match = merged
            updated_rules.append(merged)
        else:
            updated_rules.append(rule)

    if existing_match is None:
        existing_match = new_rule
        updated_rules.insert(0, new_rule)

    save_risk_rules(file_path, updated_rules)
    return existing_match


def delete_risk_rule(file_path: Path, rule_id: str) -> list[dict[str, Any]]:
    rules = [rule for rule in load_risk_rules(file_path) if rule.get("id") != rule_id]
    save_risk_rules(file_path, rules)
    return rules


def match_risk_rule(
    session_text: str,
    tool_name: str,
    params: dict[str, Any],
    rules: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not rules:
        return None

    search_space = f"{session_text}\n{json.dumps(params, ensure_ascii=False)}".lower()
    for rule in rules:
        if not rule.get("enabled", True):
            continue

        blocked_tools = {str(tool).lower() for tool in rule.get("blocked_tools", ["*"])}
        if "*" not in blocked_tools and tool_name.lower() not in blocked_tools:
            continue

        matched_keywords = [
            keyword for keyword in rule.get("keywords", [])
            if keyword and str(keyword).lower() in search_space
        ]
        if _keywords_trigger(matched_keywords):
            return rule

    return None


def match_risk_rule_text(
    message_text: str,
    rules: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Match persisted rules against a plain user message before it reaches the agent."""
    if not rules:
        return None

    search_space = str(message_text or "").lower()
    if not search_space.strip():
        return None

    for rule in rules:
        if not rule.get("enabled", True):
            continue

        # For user-approved persistent rules, treat the original intent as the
        # strongest signal. If the new message is the same or highly similar,
        # block it directly without relying on keyword-length thresholds.
        if _intent_matches_message(search_space, str(rule.get("intent", ""))):
            return rule

        matched_keywords = [
            keyword for keyword in rule.get("keywords", [])
            if keyword and str(keyword).lower() in search_space
        ]
        if _keywords_trigger(matched_keywords):
            return rule

    return None


def build_risk_rule_block_reason(rule: dict[str, Any]) -> str:
    return f"命中风险测试长期防护规则：{rule.get('reason', '高风险操作已被阻止')}"


def _append_keyword(target: list[str], seen: set[str], keyword: str) -> None:
    normalized = keyword.strip().lower()
    if len(normalized) < 2 or normalized in seen or normalized in _GENERIC_STOPWORDS:
        return
    target.append(normalized)
    seen.add(normalized)


def _normalize_signals(signals: Iterable[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for signal in signals:
        value = str(signal).strip()
        if not value or value in seen:
            continue
        normalized.append(value)
        seen.add(value)
    return normalized


def _rule_identity(rule: dict[str, Any]) -> tuple[str, str]:
    return (
        str(rule.get("category_key", "generic_abuse")).strip().lower(),
        str(rule.get("intent", "")).strip().lower(),
    )


def _keywords_trigger(matched_keywords: list[str]) -> bool:
    if not matched_keywords:
        return False
    if any(len(keyword) >= 6 or " " in keyword for keyword in matched_keywords):
        return True
    return len(set(matched_keywords)) >= 2


def _intent_matches_message(message_text: str, intent_text: str) -> bool:
    normalized_message = _normalize_match_text(message_text)
    normalized_intent = _normalize_match_text(intent_text)

    if not normalized_message or not normalized_intent:
        return False

    if normalized_message == normalized_intent:
        return True

    if min(len(normalized_message), len(normalized_intent)) >= 3:
        if normalized_intent in normalized_message or normalized_message in normalized_intent:
            return True

    if min(len(normalized_message), len(normalized_intent)) >= 4:
        if SequenceMatcher(None, normalized_message, normalized_intent).ratio() >= 0.82:
            return True

    message_units = _semantic_units(message_text)
    intent_units = _semantic_units(intent_text)
    if message_units and intent_units:
        overlap = message_units & intent_units
        if overlap:
            smaller = min(len(message_units), len(intent_units))
            coverage = len(overlap) / smaller
            dice = (2 * len(overlap)) / (len(message_units) + len(intent_units))
            if len(overlap) >= 2 and (coverage >= 0.6 or dice >= 0.58):
                return True

    return False


def _normalize_match_text(text: str) -> str:
    return _NORMALIZE_TEXT_PATTERN.sub("", str(text or "").lower())


def _semantic_units(text: str) -> set[str]:
    lowered = str(text or "").lower()
    for filler in _SEMANTIC_FILLER_PHRASES:
        lowered = lowered.replace(filler, " ")

    units: set[str] = set()
    for token in _TEXT_UNIT_PATTERN.findall(lowered):
        if token in _GENERIC_STOPWORDS:
            continue

        if re.fullmatch(r"[\u4e00-\u9fff]+", token):
            token = token.strip()
            if len(token) >= 2:
                units.add(token)
            for size in (2, 3):
                if len(token) < size:
                    continue
                for idx in range(len(token) - size + 1):
                    units.add(token[idx : idx + size])
            continue

        if len(token) < 2:
            continue
        units.add(token)

    return units
