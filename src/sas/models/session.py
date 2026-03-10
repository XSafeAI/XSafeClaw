"""Session model representing OpenClaw agent sessions."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin

if TYPE_CHECKING:
    from .message import Message


class Session(Base, TimestampMixin):
    """OpenClaw session metadata.
    
    Represents a continuous conversation session between user and agent.
    Maps to a single .jsonl file in OpenClaw's sessions directory.
    """

    __tablename__ = "sessions"

    # Primary identification
    session_id: Mapped[str] = mapped_column(
        String(36), primary_key=True, comment="UUID from JSONL"
    )
    
    session_key: Mapped[str | None] = mapped_column(
        String(255),
        unique=True,
        nullable=True,
        index=True,
        comment="Session key like 'agent:main:webchat:123'",
    )

    # Agent context
    agent_id: Mapped[str] = mapped_column(
        String(64), default="main", index=True, comment="Agent identifier"
    )
    
    channel: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True, comment="Channel: webchat/telegram/slack"
    )
    
    chat_type: Mapped[str | None] = mapped_column(
        String(32), nullable=True, comment="Chat type: direct/group"
    )

    # Session metadata from JSONL
    version: Mapped[int | None] = mapped_column(
        nullable=True, comment="Session version from JSONL"
    )
    
    cwd: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="Working directory"
    )
    
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, comment="First entry timestamp"
    )
    
    last_activity_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True, comment="Last message timestamp"
    )

    # Current model info
    current_model_provider: Mapped[str | None] = mapped_column(
        String(64), nullable=True, comment="Current model provider"
    )
    
    current_model_name: Mapped[str | None] = mapped_column(
        String(128), nullable=True, comment="Current model name"
    )

    # File tracking
    jsonl_file_path: Mapped[str | None] = mapped_column(
        Text, nullable=True, comment="Path to the .jsonl file"
    )
    
    last_read_position: Mapped[int] = mapped_column(
        default=0, comment="Last read byte position for incremental parsing"
    )

    # Soft delete
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, comment="Soft delete timestamp"
    )

    # Relationships
    messages: Mapped[list["Message"]] = relationship(
        "Message", back_populates="session", cascade="all, delete-orphan"
    )

    # Indexes
    __table_args__ = (
        Index("ix_sessions_agent_channel", "agent_id", "channel"),
        Index("ix_sessions_activity", "last_activity_at", "deleted_at"),
    )

    def __repr__(self) -> str:
        return (
            f"<Session(id={self.session_id[:8]}..., "
            f"key={self.session_key}, "
            f"agent={self.agent_id}, "
            f"channel={self.channel})>"
        )
