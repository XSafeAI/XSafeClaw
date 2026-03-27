"""Service for synchronizing OpenClaw messages to database (new Message-based schema)."""

import asyncio
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db_context
from ..models import Event, Message, Session, ToolCall
from ..parsers import JSONLEntry, JSONLParser
from ..watchers import SessionFileWatcher
from .event_sync_service import EventSyncService


class MessageSyncService:
    """Service for syncing OpenClaw session files to database using Message model."""

    def __init__(self):
        """Initialize sync service."""
        self.sessions_dir = Path(settings.OPENCLAW_SESSIONS_DIR)
        self.watcher: SessionFileWatcher | None = None
        self._running = False
        self._sync_task: asyncio.Task | None = None
        self._event_sync_service = EventSyncService()
        
        # Track file sync positions: {file_path: last_synced_line}
        self._sync_positions: dict[str, int] = {}
        
        # Track sessions that need event sync: set of session_ids
        self._pending_event_sync: set[str] = set()
        self._event_sync_task: asyncio.Task | None = None

    async def start(self) -> None:
        """Start the sync service."""
        if self._running:
            return

        print("🚀 Starting Message Sync Service...")

        # Initial scan of existing files
        await self._initial_scan()

        # Sync events for all sessions after initial message sync
        print("🔄 Syncing events for all sessions...")
        try:
            event_results = await self._event_sync_service.sync_all_sessions()
            total_events = sum(event_results.values())
            print(f"✅ Event sync completed: {total_events} events across {len(event_results)} sessions")
        except Exception as e:
            print(f"❌ Error during initial event sync: {e}")

        # Start file watcher
        self.watcher = SessionFileWatcher(
            watch_directory=self.sessions_dir,
            on_file_event=self._on_file_event,
        )
        await self.watcher.start()

        # Re-scan after watcher starts to catch files created during the startup gap
        # (between _initial_scan() and watcher.start() there is a brief window where
        # new files can appear without triggering a "created" event).
        print("🔄 Post-watcher gap scan...")
        await self._initial_scan()

        # Start periodic full scan task
        self._sync_task = asyncio.create_task(self._periodic_full_scan())
        
        # Start debounced event sync task
        self._event_sync_task = asyncio.create_task(self._debounced_event_sync_loop())
        
        self._running = True
        print("✅ Message Sync Service started")

    async def stop(self) -> None:
        """Stop the sync service."""
        if not self._running:
            return

        print("🛑 Stopping Message Sync Service...")

        # Stop watcher
        if self.watcher:
            await self.watcher.stop()

        # Cancel periodic task
        if self._sync_task:
            self._sync_task.cancel()
            try:
                await self._sync_task
            except asyncio.CancelledError:
                pass

        # Cancel event sync task
        if self._event_sync_task:
            self._event_sync_task.cancel()
            try:
                await self._event_sync_task
            except asyncio.CancelledError:
                pass

        self._running = False
        print("✅ Message Sync Service stopped")

    async def _initial_scan(self) -> None:
        """Scan and sync all existing JSONL files.
        
        Also cleans up database sessions whose JSONL files no longer exist.
        """
        print("📊 Performing initial scan...")
        
        if not self.sessions_dir.exists():
            print(f"⚠️  Sessions directory not found: {self.sessions_dir}")
            return

        jsonl_files = list(self.sessions_dir.glob("*.jsonl"))
        existing_session_ids = {f.stem for f in jsonl_files}
        print(f"Found {len(jsonl_files)} session files on disk")

        # 1. Clean up stale sessions (exist in DB but not on disk)
        await self._cleanup_stale_sessions(existing_session_ids)

        # 2. Sync existing files
        for file_path in jsonl_files:
            try:
                await self._sync_file(file_path, full_sync=True)
            except Exception as e:
                print(f"❌ Error syncing {file_path.name}: {e}")

        print("✅ Initial scan completed")

    async def _periodic_full_scan(self) -> None:
        """Periodically scan all files for changes."""
        interval = settings.FULL_SCAN_INTERVAL_HOURS * 3600
        
        while self._running:
            try:
                await asyncio.sleep(interval)
                print("🔄 Running periodic full scan...")
                await self._initial_scan()
                # After full scan, sync events for all sessions
                print("🔄 Syncing events after periodic scan...")
                try:
                    await self._event_sync_service.sync_all_sessions()
                except Exception as e:
                    print(f"❌ Error syncing events after periodic scan: {e}")
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"❌ Error in periodic scan: {e}")

    async def _debounced_event_sync_loop(self) -> None:
        """Debounced event sync loop.
        
        Waits for pending session IDs to accumulate, then syncs events in batch.
        This avoids excessive event syncs when many file changes happen rapidly.
        """
        while self._running:
            try:
                await asyncio.sleep(3)  # Wait 3 seconds to batch changes
                
                if not self._pending_event_sync:
                    continue
                
                # Grab pending session IDs and clear the set
                session_ids = self._pending_event_sync.copy()
                self._pending_event_sync.clear()
                
                for session_id in session_ids:
                    try:
                        count = await self._event_sync_service.sync_session_events(session_id)
                        if count > 0:
                            print(f"🔄 Auto-synced {count} events for session {session_id[:8]}...")
                    except Exception as e:
                        print(f"❌ Error auto-syncing events for {session_id[:8]}...: {e}")
                        
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"❌ Error in event sync loop: {e}")

    async def _on_file_event(self, event_type: str, file_path: str) -> None:
        """Handle file system events."""
        path = Path(file_path)
        
        if event_type == "created":
            print(f"📄 New session file: {path.name}")
            await self._sync_file(path, full_sync=True)
            # Schedule event sync for this session
            self._pending_event_sync.add(path.stem)
        
        elif event_type == "modified":
            print(f"✏️  Session file updated: {path.name}")
            await self._sync_file(path, full_sync=False)
            # Schedule event sync for this session
            self._pending_event_sync.add(path.stem)
        
        elif event_type == "deleted":
            print(f"🗑️  Session file deleted: {path.name}")
            session_id = path.stem
            await self._delete_session_data(session_id)
            # Clean up sync position tracking and pending event sync
            file_path_str = str(path)
            self._sync_positions.pop(file_path_str, None)
            self._pending_event_sync.discard(session_id)

    async def _cleanup_stale_sessions(self, existing_session_ids: set[str]) -> None:
        """Remove sessions from DB that no longer have corresponding JSONL files.
        
        Args:
            existing_session_ids: Set of session IDs that currently exist on disk.
        """
        try:
            async with get_db_context() as db:
                # Get all session IDs from database
                result = await db.execute(select(Session.session_id))
                db_session_ids = set(result.scalars().all())
                
                # Find sessions that are in DB but not on disk
                stale_session_ids = db_session_ids - existing_session_ids
                
                if not stale_session_ids:
                    return
                
                print(f"🧹 Found {len(stale_session_ids)} stale session(s) to clean up")
                
                for session_id in stale_session_ids:
                    try:
                        # Delete events for this session
                        await db.execute(
                            delete(Event).where(Event.session_id == session_id)
                        )
                        
                        # Get message IDs to delete associated tool calls
                        msg_result = await db.execute(
                            select(Message.id).where(Message.session_id == session_id)
                        )
                        message_db_ids = msg_result.scalars().all()
                        
                        if message_db_ids:
                            # Delete tool calls associated with these messages
                            await db.execute(
                                delete(ToolCall).where(ToolCall.message_db_id.in_(message_db_ids))
                            )
                        
                        # Delete messages for this session
                        await db.execute(
                            delete(Message).where(Message.session_id == session_id)
                        )
                        
                        # Delete the session itself
                        await db.execute(
                            delete(Session).where(Session.session_id == session_id)
                        )
                        
                        print(f"  🗑️  Deleted stale session {session_id[:8]}... and all associated data")
                    except Exception as e:
                        print(f"  ❌ Error deleting stale session {session_id[:8]}...: {e}")
                
                await db.commit()
                print(f"✅ Stale session cleanup completed ({len(stale_session_ids)} removed)")
                
        except Exception as e:
            print(f"❌ Error during stale session cleanup: {e}")

    async def _delete_session_data(self, session_id: str) -> None:
        """Delete all data for a session from database.
        
        Called when a session JSONL file is deleted (real-time watcher event).
        Uses cascade delete via Session model relationships where possible,
        and explicit deletes as fallback.
        
        Args:
            session_id: The session ID to delete.
        """
        try:
            async with get_db_context() as db:
                # Check if session exists
                result = await db.execute(
                    select(Session).where(Session.session_id == session_id)
                )
                session = result.scalar_one_or_none()
                
                if not session:
                    print(f"  ⚠️  Session {session_id[:8]}... not found in database, nothing to delete")
                    return
                
                # Delete events for this session
                event_result = await db.execute(
                    delete(Event).where(Event.session_id == session_id)
                )
                events_deleted = event_result.rowcount
                
                # Get message IDs to delete associated tool calls
                msg_result = await db.execute(
                    select(Message.id).where(Message.session_id == session_id)
                )
                message_db_ids = msg_result.scalars().all()
                
                tool_calls_deleted = 0
                if message_db_ids:
                    tc_result = await db.execute(
                        delete(ToolCall).where(ToolCall.message_db_id.in_(message_db_ids))
                    )
                    tool_calls_deleted = tc_result.rowcount
                
                # Delete messages
                msg_del_result = await db.execute(
                    delete(Message).where(Message.session_id == session_id)
                )
                messages_deleted = msg_del_result.rowcount
                
                # Delete the session
                await db.execute(
                    delete(Session).where(Session.session_id == session_id)
                )
                
                await db.commit()
                
                print(
                    f"  ✅ Deleted session {session_id[:8]}... "
                    f"({messages_deleted} messages, {tool_calls_deleted} tool calls, "
                    f"{events_deleted} events)"
                )
                
        except Exception as e:
            print(f"  ❌ Error deleting session {session_id[:8]}...: {e}")

    async def _sync_file(self, file_path: Path, full_sync: bool = False) -> None:
        """Sync a single JSONL file to database."""
        session_id = file_path.stem
        file_path_str = str(file_path)

        # Determine starting line
        start_line = 0 if full_sync else self._sync_positions.get(file_path_str, 0)

        # Parse events
        parser = JSONLParser(file_path)
        
        try:
            total_lines = parser.get_line_count()
            
            if start_line >= total_lines:
                return
            
            entries: list[JSONLEntry] = []
            async for entry in parser.parse_entries(start_line=start_line):
                entries.append(entry)
            
            if not entries:
                return
            
            # Sync to database
            async with get_db_context() as db:
                await self._sync_entries_to_db(db, session_id, entries, parser)
            
            # Update sync position
            self._sync_positions[file_path_str] = total_lines
            
            print(f"✅ Synced {len(entries)} entries from {file_path.name} (lines {start_line}-{total_lines})")
        
        except Exception as e:
            print(f"❌ Error syncing {file_path.name}: {e}")
            raise

    async def _sync_entries_to_db(
        self, db: AsyncSession, session_id: str, entries: list[JSONLEntry], parser: JSONLParser
    ) -> None:
        """Sync parsed entries to database."""
        
        # 1. Ensure session exists
        await self._ensure_session(db, session_id, parser)
        
        # 2. Process each entry
        for entry in entries:
            entry_type = entry.entry_type
            
            if entry_type == "message":
                await self._sync_message(db, session_id, entry)
            
            elif entry_type == "model_change":
                await self._update_session_model(db, session_id, entry)
            
            # Add more entry type handlers as needed
        
        await db.commit()

    async def _ensure_session(self, db: AsyncSession, session_id: str, parser: JSONLParser) -> Session:
        """Ensure session exists in database."""
        result = await db.execute(
            select(Session).where(Session.session_id == session_id)
        )
        session = result.scalar_one_or_none()
        
        if session:
            session.last_activity_at = datetime.now(timezone.utc)
            session.updated_at = datetime.now(timezone.utc)
            return session
        
        # Create new session
        session_info = await parser.get_session_info()
        
        session = Session(
            session_id=session_id,
            first_seen_at=session_info.timestamp if session_info else datetime.now(timezone.utc),
            cwd=session_info.cwd if session_info else None,
            last_activity_at=datetime.now(timezone.utc),
        )
        db.add(session)
        await db.flush()
        
        return session

    def _clean_null_bytes(self, text: str) -> str:
        """Remove NULL bytes from text (PostgreSQL doesn't support them)."""
        if text:
            return text.replace('\x00', '')
        return text
    
    def _clean_null_bytes_from_json(self, data):
        """Recursively remove NULL bytes from JSON data."""
        if isinstance(data, str):
            return data.replace('\x00', '')
        elif isinstance(data, dict):
            return {k: self._clean_null_bytes_from_json(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [self._clean_null_bytes_from_json(item) for item in data]
        else:
            return data
    
    async def _sync_message(self, db: AsyncSession, session_id: str, entry: JSONLEntry) -> None:
        """Sync a message entry to database."""
        message_id = entry.entry_id
        if not message_id:
            print(f"⚠️  Message entry has no ID, skipping")
            return
        
        # Check if message already exists
        result = await db.execute(
            select(Message).where(Message.message_id == message_id)
        )
        existing_message = result.scalar_one_or_none()
        if existing_message:
            return  # Already synced
        
        msg_data = entry.raw_data.get("message", {})
        role = msg_data.get("role", "unknown")
        content = msg_data.get("content", [])
        
        # Extract text content (join all text blocks) and tool calls
        content_text = ""
        tool_calls_data = []
        text_parts: list[str] = []

        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict):
                    if item.get("type") == "text":
                        t = item.get("text", "")
                        if t:
                            text_parts.append(str(t))
                    elif item.get("type") == "toolCall":
                        # Extract tool call info from assistant message
                        tool_calls_data.append(item)
        elif isinstance(content, str) and content.strip():
            text_parts.append(content.strip())

        if text_parts:
            content_text = self._clean_null_bytes(" ".join(text_parts))
        else:
            content_text = ""
        
        # Clean NULL bytes from JSON data
        cleaned_content = self._clean_null_bytes_from_json(content) if content else None
        cleaned_raw_entry = self._clean_null_bytes_from_json(entry.raw_data)
        
        # Create message
        message = Message(
            session_id=session_id,
            message_id=message_id,
            parent_message_id=entry.parent_id,
            role=role,
            timestamp=entry.timestamp,
            content_text=content_text,
            content_json=cleaned_content,
            raw_entry=cleaned_raw_entry,
        )
        
        # Add model info for assistant messages
        if role == "assistant":
            usage = msg_data.get("usage", {})
            message.provider = msg_data.get("provider")
            message.model_id = msg_data.get("model")
            message.model_api = msg_data.get("api")
            message.stop_reason = msg_data.get("stopReason")
            
            if usage:
                message.input_tokens = usage.get("input", 0)
                message.output_tokens = usage.get("output", 0)
                message.total_tokens = usage.get("totalTokens", 0)
                message.cache_read_tokens = usage.get("cacheRead", 0)
                message.cache_write_tokens = usage.get("cacheWrite", 0)
        
        db.add(message)
        await db.flush()
        
        # Process tool calls from assistant message
        if role == "assistant" and tool_calls_data:
            for tool_call_item in tool_calls_data:
                await self._create_tool_call(db, message.id, message_id, tool_call_item, entry.timestamp)
        
        # Process toolResult message
        if role == "toolResult":
            await self._update_tool_call_result(db, msg_data, message_id, entry.timestamp)
        
        print(f"✅ Synced {role} message {message_id[:8]}...")

    async def _update_session_model(self, db: AsyncSession, session_id: str, entry: JSONLEntry) -> None:
        """Update session with model change."""
        result = await db.execute(
            select(Session).where(Session.session_id == session_id)
        )
        session = result.scalar_one_or_none()
        
        if session:
            session.current_model_provider = entry.raw_data.get("provider")
            session.current_model_name = entry.raw_data.get("modelId")
            session.updated_at = datetime.now(timezone.utc)

    async def _create_tool_call(
        self, db: AsyncSession, message_db_id: int, message_id: str, tool_call_data: dict, timestamp: datetime
    ) -> None:
        """Create a tool call record from assistant message."""
        tool_call_id = tool_call_data.get("id")
        if not tool_call_id:
            return
        
        # Check if already exists
        result = await db.execute(
            select(ToolCall).where(ToolCall.id == tool_call_id)
        )
        if result.scalar_one_or_none():
            return  # Already exists
        
        tool_call = ToolCall(
            id=tool_call_id,
            message_db_id=message_db_id,
            initiating_message_id=message_id,  # 存储JSONL message_id
            tool_name=tool_call_data.get("name", "unknown"),
            arguments=tool_call_data.get("arguments"),
            started_at=timestamp,
            status="pending",
        )
        
        db.add(tool_call)
        await db.flush()
        print(f"  ✅ Created tool call {tool_call_id[:12]}... ({tool_call.tool_name})")

    async def _update_tool_call_result(
        self, db: AsyncSession, msg_data: dict, result_message_id: str, timestamp: datetime
    ) -> None:
        """Update tool call with result from toolResult message."""
        tool_call_id = msg_data.get("toolCallId")
        if not tool_call_id:
            return
        
        # Find the tool call
        result = await db.execute(
            select(ToolCall).where(ToolCall.id == tool_call_id)
        )
        tool_call = result.scalar_one_or_none()
        
        if not tool_call:
            print(f"  ⚠️  ToolCall {tool_call_id[:12]}... not found, creating placeholder")
            # Create placeholder tool call if not found
            tool_call = ToolCall(
                id=tool_call_id,
                tool_name=msg_data.get("toolName", "unknown"),
                started_at=timestamp,
                status="completed",
                result_message_id=result_message_id,
            )
            db.add(tool_call)
            await db.flush()
        else:
            # Update result_message_id
            tool_call.result_message_id = result_message_id
        
        # Extract result text
        content = msg_data.get("content", [])
        result_text = ""
        if content and isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    result_text = item.get("text", "")
                    break
        
        # Clean NULL bytes (PostgreSQL doesn't support them)
        result_text = self._clean_null_bytes(result_text)
        
        # Extract details
        details = msg_data.get("details", {})
        
        # Update tool call
        tool_call.completed_at = timestamp
        tool_call.result_text = result_text
        tool_call.result_json = details if details else None
        tool_call.is_error = msg_data.get("isError", False)
        tool_call.status = "failed" if tool_call.is_error else "completed"
        
        # Extract exec-specific fields
        if details:
            tool_call.exit_code = details.get("exitCode")
            tool_call.cwd = details.get("cwd")
            
            # Calculate duration
            duration_ms = details.get("durationMs")
            if duration_ms:
                tool_call.duration_seconds = duration_ms / 1000.0
        
        print(f"  ✅ Updated tool call {tool_call_id[:12]}... with result (status={tool_call.status})")

    def is_running(self) -> bool:
        """Check if service is running."""
        return self._running
