"""Runtime instance models and capability helpers."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

RuntimePlatform = Literal["openclaw", "nanobot", "hermes"]

CAPABILITY_KEYS = (
    "monitoring",
    "history",
    "chat",
    "model_list",
    "health_check",
    "guard_observe",
    "guard_blocking",
    "onboard",
    "multi_instance",
)


def empty_capabilities() -> dict[str, bool]:
    """Return a complete capability map with every flag defaulting to false."""
    return {key: False for key in CAPABILITY_KEYS}


class RuntimeInstance(BaseModel):
    """Persisted runtime instance definition."""

    instance_id: str
    platform: RuntimePlatform
    display_name: str
    config_path: str | None = None
    workspace_path: str | None = None
    sessions_path: str | None = None
    serve_base_url: str | None = None
    gateway_base_url: str | None = None
    discovery_mode: Literal["auto", "manual"] = "manual"
    enabled: bool = True
    is_default: bool = False
    capabilities: dict[str, bool] = Field(default_factory=empty_capabilities)
    attach_state: str = "discovered"
    health_status: Literal["unknown", "healthy", "unreachable"] = "unknown"
    meta: dict[str, Any] = Field(default_factory=dict)

    @field_validator(
        "config_path",
        "workspace_path",
        "sessions_path",
        mode="before",
    )
    @classmethod
    def _expand_path(cls, value: str | None) -> str | None:
        if not value:
            return value
        return str(Path(value).expanduser())

    @field_validator("capabilities", mode="before")
    @classmethod
    def _normalize_capabilities(cls, value: dict[str, bool] | None) -> dict[str, bool]:
        merged = empty_capabilities()
        if isinstance(value, dict):
            for key in CAPABILITY_KEYS:
                if key in value:
                    merged[key] = bool(value[key])
        return merged

    @property
    def config_path_obj(self) -> Path | None:
        return Path(self.config_path).expanduser() if self.config_path else None

    @property
    def workspace_path_obj(self) -> Path | None:
        return Path(self.workspace_path).expanduser() if self.workspace_path else None

    @property
    def sessions_path_obj(self) -> Path | None:
        return Path(self.sessions_path).expanduser() if self.sessions_path else None

    def with_updates(self, **updates: Any) -> "RuntimeInstance":
        """Return a copy with updates applied."""
        return self.model_copy(update=updates)
