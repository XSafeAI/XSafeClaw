"""API routes for Red Team automation."""

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

# --------------- Data file path ---------------
_DATA_FILE = Path(__file__).resolve().parents[2] / "data" / "redteam" / "decomposed_epoch1.jsonl"


def _load_records() -> list[dict]:
    """Load records from the JSONL file (no cache, always reads latest)."""
    if not _DATA_FILE.exists():
        raise HTTPException(status_code=500, detail=f"Data file not found: {_DATA_FILE}")

    records = []
    for line in _DATA_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
            records.append(rec)
        except json.JSONDecodeError:
            continue

    return records


# --------------- Pydantic Schemas ---------------

class InstructionItem(BaseModel):
    record_id: str
    instruction: str
    category: str


class TurnItem(BaseModel):
    thought: str
    output: str


class DecomposedResult(BaseModel):
    record_id: str
    instruction: str
    name: str
    description: str
    risk_type: str
    turns: list[TurnItem]


class GenerateRequest(BaseModel):
    record_id: str = Field(..., description="The record_id to generate attack from")


# --------------- Endpoints ---------------

@router.get("/instructions", response_model=list[InstructionItem])
async def list_instructions():
    """List all available red team instructions for selection."""
    records = _load_records()
    return [
        InstructionItem(record_id=r["record_id"], instruction=r["instruction"], category=r.get("category", ""))
        for r in records
    ]


@router.post("/generate", response_model=DecomposedResult)
async def generate_attack(request: GenerateRequest):
    """
    Generate decomposed multi-turn attack from an instruction.

    Currently reads from the JSONL file and simulates 2-4s generation delay.
    """
    records = _load_records()
    rec = next((r for r in records if r["record_id"] == request.record_id), None)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"Record {request.record_id} not found")

    # Simulate generation delay
    await asyncio.sleep(3)

    # Parse the decomposed query
    decomposed_raw = rec.get("deomposed_query", "")
    try:
        decomposed = json.loads(decomposed_raw) if isinstance(decomposed_raw, str) else decomposed_raw
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse decomposed_query")

    turns = [
        TurnItem(thought=t.get("thought", ""), output=t.get("output", ""))
        for t in decomposed.get("turns", [])
    ]

    return DecomposedResult(
        record_id=rec["record_id"],
        instruction=rec["instruction"],
        name=decomposed.get("name", ""),
        description=decomposed.get("description", ""),
        risk_type=decomposed.get("risk_type", ""),
        turns=turns,
    )
