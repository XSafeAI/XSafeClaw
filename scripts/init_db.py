#!/usr/bin/env python3
"""Initialize the database schema."""

import asyncio
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from safeclaw.config import settings
from safeclaw.database import init_db

# Import all models to ensure they're registered with Base.metadata
from safeclaw.models import Event, Message, Session, ToolCall  # noqa: F401


async def main() -> None:
    """Initialize database tables."""
    print(f"🗄️  Initializing database: {settings.database_url}")
    
    try:
        await init_db()
        print("✅ Database initialized successfully!")
        print(f"📍 Database location: {settings.database_url}")
    except Exception as e:
        print(f"❌ Failed to initialize database: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
