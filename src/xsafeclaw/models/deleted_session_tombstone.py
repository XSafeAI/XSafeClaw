"""Tombstones for user-deleted runtime sessions."""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, utc_now


class DeletedSessionTombstone(Base):
    """A durable marker preventing JSONL-backed sessions from being re-imported."""

    __tablename__ = "deleted_session_tombstones"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    platform: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        comment="Runtime platform: openclaw / hermes / nanobot",
    )
    instance_id: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        comment="Runtime instance ID",
    )
    source_session_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Original session ID/key from the runtime",
    )
    session_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Internal namespaced session ID at deletion time",
    )
    session_key: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Runtime session key or chat key at deletion time",
    )
    jsonl_file_path: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Runtime JSONL path at deletion time",
    )
    deleted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "platform",
            "instance_id",
            "source_session_id",
            name="uq_deleted_session_tombstones_identity",
        ),
        CheckConstraint(
            "platform IN ('openclaw', 'hermes', 'nanobot')",
            name="deleted_session_tombstone_platform",
        ),
        Index(
            "ix_deleted_session_tombstones_identity",
            "platform",
            "instance_id",
            "source_session_id",
        ),
    )
