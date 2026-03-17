#!/usr/bin/env python3
"""Sync events from existing messages."""

import asyncio
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from xsafeclaw.services import EventSyncService


async def main():
    """Sync all events."""
    print("📊 Syncing events from messages...")

    service = EventSyncService()
    results = await service.sync_all_sessions()

    total_events = sum(results.values())
    print(f"\n✅ Sync completed!")
    print(f"   Sessions processed: {len(results)}")
    print(f"   Total events synced: {total_events}")


if __name__ == "__main__":
    asyncio.run(main())
