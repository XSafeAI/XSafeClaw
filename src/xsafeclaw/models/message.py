"""Message model representing individual messages across runtimes."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin

if TYPE_CHECKING:
    from .session import Session
    from .tool_call import ToolCall


class Message(Base, TimestampMixin):
    """A single message in a monitored runtime conversation."""

    __tablename__ = "messages"

    # Primary key
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # Foreign keys
    session_id: Mapped[str] = mapped_column(
        ForeignKey("sessions.session_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Message identification (from JSONL)
    message_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        unique=True,
        index=True,
        comment="Internal namespaced message ID",
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

    source_session_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        index=True,
        comment="Original runtime session ID/key",
    )

    source_message_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        index=True,
        comment="Original runtime message ID",
    )
    
    parent_message_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True, comment="Internal parent message ID (forms a chain)"
    )

    # Message metadata
    role: Mapped[str] = mapped_column(
        String(32), nullable=False, index=True, comment="Message role: user, assistant, toolResult, system, etc."
    )
    
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True, comment="Message timestamp from JSONL"
    )

    # Content
    content_text: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="Text content of the message"
    )
    
    content_json: Mapped[dict | list | None] = mapped_column(
        JSON, nullable=True, comment="Full content structure (for complex content)"
    )

    # Model information (for assistant messages)
    provider: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True, comment="Model provider: qwen-portal, anthropic, etc."
    )
    
    model_id: Mapped[str | None] = mapped_column(
        String(128), nullable=True, comment="Model ID: coder-model, claude-opus-4-5, etc."
    )
    
    model_api: Mapped[str | None] = mapped_column(
        String(64), nullable=True, comment="API type: openai-completions, etc."
    )

    # Token usage (for assistant messages)
    input_tokens: Mapped[int | None] = mapped_column(
        Integer, nullable=True, comment="Input tokens"
    )
    
    output_tokens: Mapped[int | None] = mapped_column(
        Integer, nullable=True, comment="Output tokens"
    )
    
    cache_read_tokens: Mapped[int | None] = mapped_column(
        Integer, nullable=True, comment="Cache read tokens"
    )
    
    cache_write_tokens: Mapped[int | None] = mapped_column(
        Integer, nullable=True, comment="Cache write tokens"
    )
    
    total_tokens: Mapped[int | None] = mapped_column(
        Integer, nullable=True, comment="Total tokens"
    )

    # Stop reason (for assistant messages)
    stop_reason: Mapped[str | None] = mapped_column(
        String(32), nullable=True, comment="Stop reason: stop, toolUse, length, etc."
    )

    # Error information
    error_message: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="Error message if message failed"
    )

    # Raw data (for debugging/auditing)
    raw_entry: Mapped[dict | None] = mapped_column(
        JSON, nullable=True, comment="Full raw JSONL entry data"
    )

    # Relationships
    session: Mapped["Session"] = relationship("Session", back_populates="messages")
    tool_calls: Mapped[list["ToolCall"]] = relationship(
        "ToolCall", 
        back_populates="message", 
        foreign_keys="[ToolCall.message_db_id]",
        cascade="all, delete-orphan"
    )

    # Event relationship (only for user messages that trigger an event)
    triggered_event: Mapped["Event | None"] = relationship(
        "Event",
        back_populates="user_message",
        foreign_keys="[Event.user_message_id]",
        uselist=False,
    )

    # Indexes
    __table_args__ = (
        Index("ix_messages_platform_instance", "platform", "instance_id"),
        Index("ix_messages_platform_instance_source", "platform", "instance_id", "source_message_id"),
        Index("ix_messages_session_timestamp", "session_id", "timestamp"),
        Index("ix_messages_session_role", "session_id", "role"),
        Index("ix_messages_parent", "parent_message_id"),
    )

    def __repr__(self) -> str:
        return (
            f"<Message(id={self.id}, message_id={self.message_id[:8]}..., "
            f"role={self.role}, session={self.session_id[:8]}...)>"
        )
