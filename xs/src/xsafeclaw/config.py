"""Configuration management using pydantic-settings."""

import shutil
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _detect_platform() -> str:
    """Auto-detect the agent platform installed on this system.

    Returns ``"hermes"`` if the Hermes home directory or binary is found,
    ``"openclaw"`` if the OpenClaw home directory or binary is found, or
    ``"openclaw"`` as fallback.
    """
    hermes_home = Path.home() / ".hermes"
    openclaw_home = Path.home() / ".openclaw"

    hermes_exists = hermes_home.is_dir()
    openclaw_exists = openclaw_home.is_dir()

    if hermes_exists and not openclaw_exists:
        return "hermes"
    if openclaw_exists and not hermes_exists:
        return "openclaw"

    if shutil.which("hermes") and not shutil.which("openclaw"):
        return "hermes"
    if shutil.which("openclaw") and not shutil.which("hermes"):
        return "openclaw"

    if hermes_exists:
        return "hermes"
    return "openclaw"


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Platform selection ────────────────────────────────────────────────
    platform: Literal["auto", "openclaw", "hermes"] = Field(
        default="auto",
        description="Agent platform: 'auto' detects installed platform, "
                    "or force 'openclaw' / 'hermes'",
    )

    # Data directory
    data_dir: Path = Field(
        default=Path.home() / ".xsafeclaw",
        description="XSafeClaw data directory",
    )

    # Database
    database_url: str = Field(
        default="",
        description="Database connection URL (auto-set from data_dir if empty)",
    )

    @field_validator('data_dir', mode='before')
    @classmethod
    def expand_data_dir(cls, v):
        if isinstance(v, str):
            return Path(v).expanduser()
        return v

    def model_post_init(self, __context):
        if not self.database_url:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            db_path = self.data_dir / "data.db"
            self.database_url = f"sqlite+aiosqlite:///{db_path}"

    # ── OpenClaw paths ────────────────────────────────────────────────────
    openclaw_sessions_dir: Path = Field(
        default=Path.home() / ".openclaw" / "agents" / "main" / "sessions",
        description="Directory containing OpenClaw session JSONL files",
        alias="OPENCLAW_SESSIONS_DIR",
    )

    # ── Hermes paths ──────────────────────────────────────────────────────
    hermes_home: Path = Field(
        default=Path.home() / ".hermes",
        description="Hermes home directory",
    )
    hermes_sessions_dir: Path = Field(
        default=Path.home() / ".hermes" / "sessions",
        description="Directory containing Hermes session JSONL files",
    )
    hermes_config_path: Path = Field(
        default=Path.home() / ".hermes" / "config.yaml",
        description="Path to Hermes config.yaml",
    )
    hermes_api_port: int = Field(
        default=8642,
        description="Hermes API server port",
    )
    hermes_api_key: str = Field(
        default="",
        description="Hermes API server key (must match API_SERVER_KEY in Hermes .env)",
    )

    @field_validator(
        'openclaw_sessions_dir', 'hermes_home',
        'hermes_sessions_dir', 'hermes_config_path',
        mode='before',
    )
    @classmethod
    def expand_path(cls, v):
        """Expand ~ in path strings."""
        if isinstance(v, str):
            return Path(v).expanduser()
        return v

    # ── Resolved platform ─────────────────────────────────────────────────

    @property
    def resolved_platform(self) -> str:
        """Return the concrete platform name (never ``'auto'``)."""
        if self.platform != "auto":
            return self.platform
        return _detect_platform()

    @property
    def is_hermes(self) -> bool:
        return self.resolved_platform == "hermes"

    @property
    def is_openclaw(self) -> bool:
        return self.resolved_platform == "openclaw"

    @property
    def active_sessions_dir(self) -> Path:
        """Return the session JSONL directory for the active platform."""
        if self.is_hermes:
            return self.hermes_sessions_dir
        return self.openclaw_sessions_dir

    # ── Backwards-compatible aliases ──────────────────────────────────────
    
    @property
    def OPENCLAW_SESSIONS_DIR(self) -> Path:
        """Alias for openclaw_sessions_dir (backwards compatibility)."""
        return self.openclaw_sessions_dir
    
    @property
    def FULL_SCAN_INTERVAL_HOURS(self) -> int:
        """Alias for full_scan_interval_hours."""
        return self.full_scan_interval_hours

    # API
    api_host: str = Field(default="0.0.0.0", description="API bind host")
    api_port: int = Field(default=6874, description="API port")
    api_reload: bool = Field(default=False, description="Enable auto-reload")

    # Logging
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = Field(
        default="INFO", description="Logging level"
    )

    # File Watcher
    enable_file_watcher: bool = Field(
        default=True, description="Enable automatic file watching"
    )
    watch_interval_seconds: int = Field(
        default=1, description="File watcher polling interval"
    )

    # Sync Service
    full_scan_interval_hours: int = Field(
        default=1, description="Full scan interval (hours)"
    )
    batch_size: int = Field(default=100, description="Batch processing size")

    # CORS
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://localhost:5173"],
        description="Allowed CORS origins",
    )

    # Guard Model (AgentDoG)
    guard_base_url: str = Field(
        default="http://localhost:8822/v1",
        description="AgentDoG Base model API endpoint",
    )
    guard_base_model: str = Field(
        default="AgentDoG-Qwen3-4B",
        description="AgentDoG Base model name",
    )
    guard_fg_url: str = Field(
        default="http://localhost:8823/v1",
        description="AgentDoG Fine-Grained model API endpoint",
    )
    guard_fg_model: str = Field(
        default="AgentDoG-FG-Qwen3-4B",
        description="AgentDoG Fine-Grained model name",
    )
    guard_api_key: str = Field(
        default="EMPTY",
        description="API key for guard model endpoints",
    )
    guard_timeout: int = Field(
        default=120,
        description="Guard model request timeout in seconds",
    )

    @property
    def is_sqlite(self) -> bool:
        """Check if using SQLite database."""
        return "sqlite" in self.database_url.lower()

    @property
    def is_postgres(self) -> bool:
        """Check if using PostgreSQL database."""
        return "postgresql" in self.database_url.lower()


# Global settings instance
settings = Settings()


def get_settings() -> Settings:
    """Get application settings (for dependency injection)."""
    return settings
