"""Database connection and session management."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .config import settings
from .models import Base

# Global engine instance
_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    """Get or create the async database engine."""
    global _engine
    
    if _engine is None:
        if settings.is_sqlite:
            # SQLite does not support connection pooling parameters
            _engine = create_async_engine(
                settings.database_url,
                echo=settings.log_level == "DEBUG",
                future=True,
                connect_args={"check_same_thread": False},
            )
        else:
            _engine = create_async_engine(
                settings.database_url,
                echo=settings.log_level == "DEBUG",
                future=True,
                pool_pre_ping=True,
                pool_size=5,
                max_overflow=10,
            )
    
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Get or create the session factory."""
    global _session_factory
    
    if _session_factory is None:
        engine = get_engine()
        _session_factory = async_sessionmaker(
            engine,
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
            autocommit=False,
        )
    
    return _session_factory


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency for database sessions.
    
    Usage:
        @app.get("/items")
        async def get_items(db: AsyncSession = Depends(get_db)):
            ...
    """
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


@asynccontextmanager
async def get_db_context() -> AsyncGenerator[AsyncSession, None]:
    """
    Context manager for database sessions (non-FastAPI usage).
    
    Usage:
        async with get_db_context() as db:
            result = await db.execute(...)
    """
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db() -> None:
    """Initialize database tables."""
    engine = get_engine()
    async with engine.begin() as conn:
        # Create all tables
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_run_schema_migrations)


async def close_db() -> None:
    """Close database connections."""
    global _engine, _session_factory
    
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None


def _run_schema_migrations(conn) -> None:
    """Apply lightweight additive schema migrations for local SQLite/Postgres setups."""
    inspector = inspect(conn)

    def has_column(table_name: str, column_name: str) -> bool:
        return any(
            column["name"] == column_name
            for column in inspector.get_columns(table_name)
        )

    def add_column_if_missing(table_name: str, column_name: str, ddl: str) -> None:
        if not inspector.has_table(table_name) or has_column(table_name, column_name):
            return
        conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {ddl}"))

    add_column_if_missing(
        "sessions",
        "platform",
        "platform VARCHAR(32) NOT NULL DEFAULT 'openclaw'",
    )
    add_column_if_missing(
        "sessions",
        "instance_id",
        "instance_id VARCHAR(128) NOT NULL DEFAULT 'openclaw-default'",
    )
    add_column_if_missing(
        "sessions",
        "source_session_id",
        "source_session_id VARCHAR(255)",
    )

    add_column_if_missing(
        "messages",
        "platform",
        "platform VARCHAR(32) NOT NULL DEFAULT 'openclaw'",
    )
    add_column_if_missing(
        "messages",
        "instance_id",
        "instance_id VARCHAR(128) NOT NULL DEFAULT 'openclaw-default'",
    )
    add_column_if_missing(
        "messages",
        "source_session_id",
        "source_session_id VARCHAR(255)",
    )
    add_column_if_missing(
        "messages",
        "source_message_id",
        "source_message_id VARCHAR(255)",
    )

    add_column_if_missing(
        "tool_calls",
        "platform",
        "platform VARCHAR(32) NOT NULL DEFAULT 'openclaw'",
    )
    add_column_if_missing(
        "tool_calls",
        "instance_id",
        "instance_id VARCHAR(128) NOT NULL DEFAULT 'openclaw-default'",
    )
    add_column_if_missing(
        "tool_calls",
        "source_session_id",
        "source_session_id VARCHAR(255)",
    )
    add_column_if_missing(
        "tool_calls",
        "source_tool_call_id",
        "source_tool_call_id VARCHAR(255)",
    )

    add_column_if_missing(
        "events",
        "platform",
        "platform VARCHAR(32) NOT NULL DEFAULT 'openclaw'",
    )
    add_column_if_missing(
        "events",
        "instance_id",
        "instance_id VARCHAR(128) NOT NULL DEFAULT 'openclaw-default'",
    )

    conn.execute(
        text(
            "UPDATE sessions "
            "SET source_session_id = COALESCE(source_session_id, session_id) "
            "WHERE source_session_id IS NULL"
        )
    )
    conn.execute(
        text(
            "UPDATE messages "
            "SET source_session_id = COALESCE(source_session_id, session_id), "
            "source_message_id = COALESCE(source_message_id, message_id) "
            "WHERE source_session_id IS NULL OR source_message_id IS NULL"
        )
    )
    conn.execute(
        text(
            "UPDATE tool_calls "
            "SET source_tool_call_id = COALESCE(source_tool_call_id, id) "
            "WHERE source_tool_call_id IS NULL"
        )
    )

    conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_sessions_platform_instance "
            "ON sessions (platform, instance_id)"
        )
    )
    conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_messages_platform_instance "
            "ON messages (platform, instance_id)"
        )
    )
    conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_tool_calls_platform_instance "
            "ON tool_calls (platform, instance_id)"
        )
    )
    conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_events_platform_instance "
            "ON events (platform, instance_id)"
        )
    )
