"""Message API endpoints."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_db
from ...models import Message, ToolCall

router = APIRouter()


class ToolCallSummary(BaseModel):
    """Tool call summary for message response."""
    id: str
    tool_name: str
    status: str
    is_error: bool
    arguments: dict | None = None
    result_text: str | None = None

    class Config:
        from_attributes = True


class MessageResponse(BaseModel):
    """Message response model."""

    id: int
    session_id: str
    message_id: str
    parent_message_id: str | None
    role: str
    timestamp: datetime
    content_text: str | None
    provider: str | None
    model_id: str | None
    model_api: str | None
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None
    cache_read_tokens: int | None
    cache_write_tokens: int | None
    stop_reason: str | None
    error_message: str | None
    created_at: datetime
    tool_calls: list[ToolCallSummary] = []

    @classmethod
    def from_message(cls, message: Message, tool_calls: list[ToolCall] = None):
        """Create response from message and tool calls."""
        data = {
            "id": message.id,
            "session_id": message.session_id,
            "message_id": message.message_id,
            "parent_message_id": message.parent_message_id,
            "role": message.role,
            "timestamp": message.timestamp,
            "content_text": message.content_text,
            "provider": message.provider,
            "model_id": message.model_id,
            "model_api": message.model_api,
            "input_tokens": message.input_tokens,
            "output_tokens": message.output_tokens,
            "total_tokens": message.total_tokens,
            "cache_read_tokens": message.cache_read_tokens,
            "cache_write_tokens": message.cache_write_tokens,
            "stop_reason": message.stop_reason,
            "error_message": message.error_message,
            "created_at": message.created_at,
            "tool_calls": [ToolCallSummary.from_orm(tc) for tc in (tool_calls or [])],
        }
        return cls(**data)


class MessageListResponse(BaseModel):
    """Message list response."""

    messages: list[MessageResponse]
    total: int
    page: int
    page_size: int


@router.get("/", response_model=MessageListResponse)
async def list_messages(
    session_id: str | None = Query(None, description="Filter by session ID"),
    role: str | None = Query(None, description="Filter by role (user, assistant, toolResult, etc.)"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    db: AsyncSession = Depends(get_db),
):
    """List all messages with pagination and filtering."""
    
    # Build query
    base_stmt = select(Message)
    if session_id:
        base_stmt = base_stmt.where(Message.session_id == session_id)
    if role:
        base_stmt = base_stmt.where(Message.role == role)
    
    # Count total
    count_stmt = select(func.count()).select_from(base_stmt.subquery())
    total_result = await db.execute(count_stmt)
    total = total_result.scalar_one()
    
    # Get messages
    offset = (page - 1) * page_size
    stmt = base_stmt.order_by(Message.timestamp.desc()).offset(offset).limit(page_size)
    result = await db.execute(stmt)
    messages = result.scalars().all()
    
    # Build response with tool calls
    message_responses = []
    for msg in messages:
        # Get tool calls for assistant messages
        tool_calls = []
        if msg.role == "assistant":
            tool_calls_stmt = select(ToolCall).where(ToolCall.initiating_message_id == msg.message_id)
            tool_calls_result = await db.execute(tool_calls_stmt)
            tool_calls = tool_calls_result.scalars().all()
        
        msg_response = MessageResponse.from_message(msg, tool_calls)
        message_responses.append(msg_response)
    
    return MessageListResponse(
        messages=message_responses,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{message_id}", response_model=MessageResponse)
async def get_message(
    message_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a specific message by ID."""
    
    stmt = select(Message).where(Message.message_id == message_id)
    result = await db.execute(stmt)
    message = result.scalar_one_or_none()
    
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    
    # Get tool calls for assistant messages
    tool_calls = []
    if message.role == "assistant":
        tool_calls_stmt = select(ToolCall).where(ToolCall.initiating_message_id == message.message_id)
        tool_calls_result = await db.execute(tool_calls_stmt)
        tool_calls = tool_calls_result.scalars().all()
    
    return MessageResponse.from_message(message, tool_calls)


@router.get("/{message_id}/children", response_model=list[MessageResponse])
async def get_message_children(
    message_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get all child messages of a specific message."""
    
    # Verify parent message exists
    parent_stmt = select(Message).where(Message.message_id == message_id)
    parent_result = await db.execute(parent_stmt)
    parent = parent_result.scalar_one_or_none()
    
    if not parent:
        raise HTTPException(status_code=404, detail="Parent message not found")
    
    # Get children
    stmt = (
        select(Message)
        .where(Message.parent_message_id == message_id)
        .order_by(Message.timestamp)
    )
    result = await db.execute(stmt)
    children = result.scalars().all()
    
    return [MessageResponse.from_orm(msg) for msg in children]


@router.delete("/{message_id}")
async def delete_message(
    message_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a message."""
    
    stmt = select(Message).where(Message.message_id == message_id)
    result = await db.execute(stmt)
    message = result.scalar_one_or_none()
    
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    
    await db.delete(message)
    await db.commit()
    
    return {"message": f"Message {message_id} deleted successfully"}


class MessageStatsResponse(BaseModel):
    """Message statistics by role."""

    role: str
    count: int
    total_tokens: int


@router.get("/stats/by-role", response_model=list[MessageStatsResponse])
async def get_message_stats_by_role(
    session_id: str | None = Query(None, description="Filter by session ID"),
    db: AsyncSession = Depends(get_db),
):
    """Get message statistics grouped by role."""
    
    stmt = select(
        Message.role,
        func.count(Message.id).label("count"),
        func.sum(Message.total_tokens).label("total_tokens"),
    ).group_by(Message.role).order_by(func.count(Message.id).desc())
    
    if session_id:
        stmt = stmt.where(Message.session_id == session_id)
    
    result = await db.execute(stmt)
    rows = result.all()
    
    return [
        MessageStatsResponse(
            role=row[0],
            count=row[1] or 0,
            total_tokens=row[2] or 0,
        )
        for row in rows
    ]
