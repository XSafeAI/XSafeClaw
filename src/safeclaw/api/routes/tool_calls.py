"""ToolCall API endpoints."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_db
from ...models import ToolCall

router = APIRouter()


class ToolCallResponse(BaseModel):
    """ToolCall response model."""

    id: str
    message_db_id: int | None
    initiating_message_id: str | None
    result_message_id: str | None
    tool_name: str
    arguments: dict | None
    result_text: str | None
    result_json: dict | None
    status: str
    exit_code: int | None
    is_error: bool
    started_at: datetime | None
    completed_at: datetime | None
    duration_seconds: float | None
    cwd: str | None
    error_message: str | None
    created_at: datetime

    class Config:
        from_attributes = True


class ToolCallListResponse(BaseModel):
    """ToolCall list response."""

    tool_calls: list[ToolCallResponse]
    total: int
    page: int
    page_size: int


class ToolCallStatsResponse(BaseModel):
    """ToolCall statistics by tool name."""

    tool_name: str
    total_calls: int
    successful_calls: int
    failed_calls: int
    avg_duration_seconds: float | None


@router.get("/", response_model=ToolCallListResponse)
async def list_tool_calls(
    tool_name: str | None = Query(None, description="Filter by tool name"),
    status: str | None = Query(None, description="Filter by status"),
    is_error: bool | None = Query(None, description="Filter by error status"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    db: AsyncSession = Depends(get_db),
):
    """List all tool calls with pagination and filtering."""
    
    # Build query
    base_stmt = select(ToolCall)
    if tool_name:
        base_stmt = base_stmt.where(ToolCall.tool_name == tool_name)
    if status:
        base_stmt = base_stmt.where(ToolCall.status == status)
    if is_error is not None:
        base_stmt = base_stmt.where(ToolCall.is_error == is_error)
    
    # Count total
    count_stmt = select(func.count()).select_from(base_stmt.subquery())
    total_result = await db.execute(count_stmt)
    total = total_result.scalar_one()
    
    # Get tool calls
    offset = (page - 1) * page_size
    stmt = base_stmt.order_by(ToolCall.started_at.desc()).offset(offset).limit(page_size)
    result = await db.execute(stmt)
    tool_calls = result.scalars().all()
    
    return ToolCallListResponse(
        tool_calls=[ToolCallResponse.from_orm(tc) for tc in tool_calls],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{tool_call_id}", response_model=ToolCallResponse)
async def get_tool_call(
    tool_call_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a specific tool call by ID."""
    
    stmt = select(ToolCall).where(ToolCall.id == tool_call_id)
    result = await db.execute(stmt)
    tool_call = result.scalar_one_or_none()
    
    if not tool_call:
        raise HTTPException(status_code=404, detail="ToolCall not found")
    
    return ToolCallResponse.from_orm(tool_call)


@router.get("/stats/by-tool", response_model=list[ToolCallStatsResponse])
async def get_tool_call_stats(
    db: AsyncSession = Depends(get_db),
):
    """Get statistics grouped by tool name."""
    
    from sqlalchemy import Integer, case
    
    stmt = select(
        ToolCall.tool_name,
        func.count(ToolCall.id).label("total_calls"),
        func.sum(case((ToolCall.is_error == False, 1), else_=0)).label("successful_calls"),
        func.sum(case((ToolCall.is_error == True, 1), else_=0)).label("failed_calls"),
        func.avg(ToolCall.duration_seconds).label("avg_duration"),
    ).group_by(ToolCall.tool_name).order_by(func.count(ToolCall.id).desc())
    
    result = await db.execute(stmt)
    rows = result.all()
    
    return [
        ToolCallStatsResponse(
            tool_name=row.tool_name,
            total_calls=row.total_calls or 0,
            successful_calls=row.successful_calls or 0,
            failed_calls=row.failed_calls or 0,
            avg_duration_seconds=float(row.avg_duration) if row.avg_duration else None,
        )
        for row in rows
    ]


@router.delete("/{tool_call_id}")
async def delete_tool_call(
    tool_call_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a tool call."""
    
    stmt = select(ToolCall).where(ToolCall.id == tool_call_id)
    result = await db.execute(stmt)
    tool_call = result.scalar_one_or_none()
    
    if not tool_call:
        raise HTTPException(status_code=404, detail="ToolCall not found")
    
    await db.delete(tool_call)
    await db.commit()
    
    return {"message": f"ToolCall {tool_call_id} deleted successfully"}
