"""Event model - represents a complete interaction round."""

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin


class Event(Base, TimestampMixin):
    """A complete interaction round from user input to completion.
    
    An Event represents all messages and tool calls from one user message
    until the next user message (or session end). It captures a complete
    question-answer cycle including all intermediate steps.
    
    Event ID is the same as the triggering user message ID.
    """

    __tablename__ = "events"

    # Primary identification (same as triggering user message ID)
    id: Mapped[str] = mapped_column(
        String(255),
        primary_key=True,
        comment="Internal namespaced event ID (same as user_message_id)",
    )

    platform: Mapped[str] = mapped_column(
        String(32),
        default="openclaw",
        index=True,
        comment="Runtime platform: openclaw / nanobot",
    )

    instance_id: Mapped[str] = mapped_column(
        String(128),
        default="openclaw-default",
        index=True,
        comment="Runtime instance ID",
    )

    # Session relationship
    session_id: Mapped[str] = mapped_column(
        String(255),
        ForeignKey("sessions.session_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="Session this event belongs to",
    )

    # Triggering user message
    user_message_id: Mapped[str] = mapped_column(
        String(255),
        ForeignKey("messages.message_id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
        comment="The user message that triggered this event",
    )

    # Timing
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True, comment="When user sent the message"
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, comment="When the last response was completed"
    )

    # Statistics
    total_messages: Mapped[int] = mapped_column(
        Integer, default=0, comment="Total messages in this event"
    )

    total_tool_calls: Mapped[int] = mapped_column(
        Integer, default=0, comment="Total tool calls in this event"
    )

    total_assistant_messages: Mapped[int] = mapped_column(
        Integer, default=0, comment="Number of assistant messages"
    )

    total_tool_result_messages: Mapped[int] = mapped_column(
        Integer, default=0, comment="Number of tool result messages"
    )

    # Token usage
    total_input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)

    # Tool call tracking
    tool_call_ids: Mapped[list | None] = mapped_column(
        JSON, nullable=True, comment="List of tool call IDs in this event"
    )

    # Status
    status: Mapped[str] = mapped_column(
        String(20),
        default="completed",
        comment="Event status: running, pending (guard hold), completed, failed (guard rejected), error",
    )

    error_message: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="Error message if event failed"
    )

    # Relationships
    session: Mapped["Session"] = relationship("Session", back_populates="events")

    # User message that triggered this event
    user_message: Mapped["Message"] = relationship(
        "Message",
        foreign_keys=[user_message_id],
        back_populates="triggered_event",
    )

    # Indexes
    __table_args__ = (
        Index("ix_events_platform_instance", "platform", "instance_id"),
        Index("ix_events_session_started", "session_id", "started_at"),
        Index("ix_events_status", "status"),
    )

    def __repr__(self) -> str:
        return (
            f"<Event(id={self.id[:8]}..., session={self.session_id[:8]}..., "
            f"messages={self.total_messages}, tools={self.total_tool_calls})>"
        )
