"""API routes for built-in risk-test preview."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ...services.risk_test_service import generate_preview, list_examples, list_styles

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
