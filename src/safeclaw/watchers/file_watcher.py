"""File watcher for monitoring OpenClaw session JSONL files."""

import asyncio
from collections.abc import Callable
from pathlib import Path
from typing import Any

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer


class SessionFileEventHandler(FileSystemEventHandler):
    """Handler for session file system events."""

    def __init__(self, callback: Callable[[str, str], Any]):
        """
        Initialize handler.

        Args:
            callback: Async callback function(event_type, file_path)
                     event_type: "created", "modified", "deleted"
        """
        super().__init__()
        self.callback = callback
        self.loop = asyncio.get_event_loop()

    def _is_jsonl_file(self, file_path: str) -> bool:
        """Check if file is a JSONL session file."""
        return file_path.endswith(".jsonl")

    def on_created(self, event: FileSystemEvent) -> None:
        """Handle file creation."""
        if not event.is_directory and self._is_jsonl_file(event.src_path):
            asyncio.run_coroutine_threadsafe(
                self.callback("created", event.src_path), self.loop
            )

    def on_modified(self, event: FileSystemEvent) -> None:
        """Handle file modification."""
        if not event.is_directory and self._is_jsonl_file(event.src_path):
            asyncio.run_coroutine_threadsafe(
                self.callback("modified", event.src_path), self.loop
            )

    def on_deleted(self, event: FileSystemEvent) -> None:
        """Handle file deletion."""
        if not event.is_directory and self._is_jsonl_file(event.src_path):
            asyncio.run_coroutine_threadsafe(
                self.callback("deleted", event.src_path), self.loop
            )


class SessionFileWatcher:
    """Watcher for OpenClaw session JSONL files."""

    def __init__(
        self,
        watch_directory: Path | str,
        on_file_event: Callable[[str, str], Any],
    ):
        """
        Initialize file watcher.

        Args:
            watch_directory: Directory to watch for session files
            on_file_event: Async callback(event_type, file_path)
        """
        # Convert to Path and expand ~ if present
        path = Path(watch_directory)
        self.watch_directory = path.expanduser()
        
        self.on_file_event = on_file_event
        self.observer: Observer | None = None
        self.event_handler: SessionFileEventHandler | None = None
        self._running = False

    async def start(self) -> None:
        """Start watching directory."""
        if self._running:
            return

        # Ensure directory exists, create if not
        if not self.watch_directory.exists():
            self.watch_directory.mkdir(parents=True, exist_ok=True)
            print(f"📁 Created watch directory: {self.watch_directory}")

        # Create event handler
        self.event_handler = SessionFileEventHandler(self.on_file_event)

        # Create and start observer
        self.observer = Observer()
        self.observer.schedule(
            self.event_handler, str(self.watch_directory), recursive=False
        )
        self.observer.start()
        self._running = True

        print(f"📁 Started watching: {self.watch_directory}")

    async def stop(self) -> None:
        """Stop watching directory."""
        if not self._running or not self.observer:
            return

        self.observer.stop()
        self.observer.join(timeout=5)
        self._running = False
        print("🛑 Stopped file watcher")

    def is_running(self) -> bool:
        """Check if watcher is running."""
        return self._running

    async def scan_existing_files(self) -> list[Path]:
        """
        Scan for existing JSONL files in watch directory.

        Returns:
            List of JSONL file paths
        """
        if not self.watch_directory.exists():
            return []

        return sorted(self.watch_directory.glob("*.jsonl"))

    async def __aenter__(self) -> "SessionFileWatcher":
        """Context manager entry."""
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Context manager exit."""
        await self.stop()
