"""API routes for built-in risk-test preview."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ...services.risk_test_service import (
    execute_prompt,
    generate_preview,
    list_examples,
    list_persisted_rules,
    list_styles,
    persist_rule_candidate,
    remove_persisted_rule,
)

router = APIRouter()


class RiskTestStyle(BaseModel):
    key: str
    label: str
    description: str


class RiskTestExample(BaseModel):
    title: str
    intent: str


class RiskTestCase(BaseModel):
    id: str
    style_key: str
    style_label: str
    wrapped_prompt: str
    expected_behavior: str
    simulated_response: str
    blocked: bool


class RiskTestRequest(BaseModel):
    intent: str = Field(..., min_length=3, max_length=3000, description="Malicious intent to test")
    styles: list[str] | None = Field(
        default=None,
        description="Optional style keys to generate preview with",
    )
    locale: str | None = Field(
        default="zh",
        description="Locale for localized examples and preview text: zh | en",
    )


class RiskTestResponse(BaseModel):
    intent: str
    preview_only: bool
    category: str
    severity: str
    summary: str
    harm: str
    recommendation: str
    cases: list[RiskTestCase]


class RiskTestExecuteRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=12000, description="Edited wrapped prompt to evaluate in dry-run mode")
    locale: str | None = Field(
        default="zh",
        description="Locale for localized execution messages: zh | en",
    )


class RiskTestExecuteResponse(BaseModel):
    session_key: str
    prompt: str
    state: str
    response_text: str
    usage: dict[str, Any] | None = None
    stop_reason: str | None = None
    dry_run: bool
    verdict: str
    analysis: str
    risk_signals: list[dict[str, str]]
    tool_attempt_count: int
    tool_attempts: list[dict[str, Any]]
    rule_written: bool
    persisted_rule: dict[str, Any] | None = None


class PersistedRiskRuleResponse(BaseModel):
    id: str
    category_key: str
    category: str
    severity: str
    intent: str
    keywords: list[str]
    blocked_tools: list[str]
    risk_signals: list[str]
    reason: str
    created_at: float
    enabled: bool


class PersistedRiskRuleCreateRequest(BaseModel):
    category_key: str
    category: str
    severity: str
    intent: str
    keywords: list[str] = Field(default_factory=list)
    blocked_tools: list[str] = Field(default_factory=list)
    risk_signals: list[str] = Field(default_factory=list)
    reason: str


@router.get("/styles", response_model=list[RiskTestStyle])
async def get_styles(locale: str = Query(default="zh", description="Locale: zh | en")) -> Any:
    """Return supported built-in risk-test styles."""
    return list_styles(locale)


@router.get("/examples", response_model=list[RiskTestExample])
async def get_examples(locale: str = Query(default="zh", description="Locale: zh | en")) -> Any:
    """Return built-in malicious-intent examples for quick testing."""
    return list_examples(locale)


@router.post("/preview", response_model=RiskTestResponse)
async def preview_risk_test(request: RiskTestRequest) -> Any:
    """Generate a preview-only adversarial test without using a real agent."""
    try:
        return generate_preview(request.intent, request.styles, request.locale)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/execute", response_model=RiskTestExecuteResponse)
async def execute_risk_test(request: RiskTestExecuteRequest) -> Any:
    """Run an edited risk-test prompt in dry-run mode and return the evaluation."""
    try:
        return await execute_prompt(request.prompt, request.locale)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/rules", response_model=list[PersistedRiskRuleResponse])
async def get_persisted_risk_rules() -> Any:
    """Return persisted risk rules written from previous dry-run evaluations."""
    return list_persisted_rules()


@router.post("/rules", response_model=PersistedRiskRuleResponse)
async def create_persisted_risk_rule(request: PersistedRiskRuleCreateRequest) -> Any:
    """Persist one user-approved rule candidate from a dry-run evaluation."""
    try:
        return persist_rule_candidate(request.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/rules/{rule_id}", response_model=list[PersistedRiskRuleResponse])
async def delete_persisted_risk_rule(rule_id: str) -> Any:
    """Delete one persisted risk rule."""
    return remove_persisted_rule(rule_id)
