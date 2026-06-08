"""Runtime budget settings for RuntimeGuard."""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, utc_now


class RuntimeBudgetSetting(Base):
    """Per-runtime-platform budget configuration."""

    __tablename__ = "runtime_budget_settings"

    platform: Mapped[str] = mapped_column(
        String(32),
        primary_key=True,
        comment="Runtime platform: openclaw / hermes / nanobot",
    )
    max_cost: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
        comment="Maximum USD spend for the active period",
    )
    period_value: Mapped[int] = mapped_column(
        Integer,
        default=24,
        nullable=False,
        comment="Budget period length",
    )
    period_unit: Mapped[str] = mapped_column(
        String(8),
        default="hour",
        nullable=False,
        comment="Budget period unit: hour / day",
    )
    period_start_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        comment="Server UTC start timestamp for the active budget period",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "platform IN ('openclaw', 'hermes', 'nanobot')",
            name="runtime_budget_platform",
        ),
        CheckConstraint(
            "period_unit IN ('hour', 'day')",
            name="runtime_budget_period_unit",
        ),
        CheckConstraint("period_value > 0", name="runtime_budget_period_value_positive"),
    )
