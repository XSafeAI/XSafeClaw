"""ToolCall model representing individual tool executions."""

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin

if TYPE_CHECKING:
    from .message import Message


class ToolCall(Base, TimestampMixin):
    """A single tool execution within an agent conversation.
    
    Tools include: exec, read, write, edit, browser, canvas, etc.
    """

    __tablename__ = "tool_calls"

    # Primary identification
    id: Mapped[str] = mapped_column(
        String(64), primary_key=True, comment="Tool call ID from JSONL (e.g., call_xxx)"
    )

    # Foreign key - associate with the assistant message that initiated the tool call
    message_db_id: Mapped[int | None] = mapped_column(
        "message_id",  # Column name in database
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
        comment="Associated assistant message database ID that initiated the tool call"
    )
    
    # JSONL message ID for easy reference
    initiating_message_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True, index=True, comment="JSONL message ID of the assistant message that initiated this tool call"
    )
    
    result_message_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True, index=True, comment="JSONL message ID of the toolResult message"
    )

    # Tool information
    tool_name: Mapped[str] = mapped_column(
        String(64), nullable=False, index=True, comment="Tool name: exec/read/write/edit/etc"
    )
    
    arguments: Mapped[dict[str, Any] | None] = mapped_column(
        JSON, nullable=True, comment="Tool call arguments as JSON"
    )

    # Execution result
    result_text: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="Tool execution result text"
    )
    
    result_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSON, nullable=True, comment="Tool execution result as JSON (for structured data)"
    )

    # Execution status
    status: Mapped[str] = mapped_column(
        String(32), default="pending", comment="Status: pending/running/completed/failed"
    )
    
    exit_code: Mapped[int | None] = mapped_column(
        Integer, nullable=True, comment="Exit code (for exec tools)"
    )
    
    is_error: Mapped[bool] = mapped_column(
        Boolean, default=False, comment="Whether execution resulted in error"
    )

    # Timing
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True, comment="When tool was called"
    )
    
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, comment="When execution completed"
    )
    
    duration_seconds: Mapped[float | None] = mapped_column(
        Float, nullable=True, comment="Execution duration in seconds"
    )

    # Additional metadata
    cwd: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="Working directory (for exec tools)"
    )
    
    error_message: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="Error message if execution failed"
    )

    # Relationships
    message: Mapped["Message | None"] = relationship("Message", back_populates="tool_calls")

    # Indexes
    __table_args__ = (
        Index("ix_tool_calls_message_started", "message_id", "started_at"),
        Index("ix_tool_calls_name_status", "tool_name", "status"),
        Index("ix_tool_calls_error", "is_error", "tool_name"),
    )

    def __repr__(self) -> str:
        return (
            f"<ToolCall(id={self.id[:12]}..., "
            f"tool={self.tool_name}, "
            f"status={self.status}, "
            f"error={self.is_error})>"
        )
