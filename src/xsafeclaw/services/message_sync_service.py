"""Service for synchronizing multi-runtime session files into the database."""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db_context
from ..models import Event, Message, Session, ToolCall
from ..runtime import (
    RuntimeInstance,
    RuntimeRegistry,
    namespace_message_id,
    namespace_session_id,
    namespace_tool_call_id,
)
from ..runtime.hermes import parse_hermes_session_file
from ..runtime.nanobot import parse_nanobot_session_file
from ..runtime.openclaw import parse_openclaw_session_file
from ..runtime.parsing import ParsedMessage, ParsedSessionBatch, ParsedSessionInfo, ParsedToolResult
from ..watchers import SessionFileWatcher
from .event_sync_service import EventSyncService


def _clean_null_bytes(text: str | None) -> str | None:
    if text is None:
        return None
    return text.replace("\x00", "")


def _clean_json(value: Any) -> Any:
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, dict):
        return {key: _clean_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_clean_json(item) for item in value]
    return value


class RuntimeSyncWorker:
    """Instance-scoped watcher and sync worker."""

    def __init__(self, instance: RuntimeInstance, event_sync_service: EventSyncService):
        self.instance = instance
        self.sessions_dir = Path(instance.sessions_path or "").expanduser()
        self.event_sync_service = event_sync_service
        self.watcher: SessionFileWatcher | None = None
        self._running = False
        self._sync_positions: dict[str, int] = {}
        self._file_to_source_session: dict[str, str] = {}
        self._pending_event_sync: set[str] = set()
        self._pending_file_sync: dict[str, dict[str, Any]] = {}
        self._sync_lock = asyncio.Lock()
        self._event_task: asyncio.Task | None = None
        self._file_task: asyncio.Task | None = None
        self._created_event_debounce_seconds = 0.5 if os.name == "nt" else 0.25
        self._modified_event_debounce_seconds = 1.5 if os.name == "nt" else 0.75
        self._file_sync_poll_interval_seconds = 0.5 if os.name == "nt" else 0.25

    async def start(self) -> None:
        if self._running:
            return
        await self._initial_scan()
        self.watcher = SessionFileWatcher(
            watch_directory=self.sessions_dir,
            on_file_event=self._on_file_event,
        )
        await self.watcher.start()
        self._running = True
        self._file_task = asyncio.create_task(self._batched_file_sync_loop())
        self._event_task = asyncio.create_task(self._debounced_event_sync_loop())
        print(f"✅ Sync worker ready: {self.instance.instance_id} -> {self.sessions_dir}")

    async def stop(self) -> None:
        if not self._running:
            return
        if self.watcher:
            await self.watcher.stop()
        for task in (self._file_task, self._event_task):
            if task is None:
                continue
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self._running = False

    async def _initial_scan(self) -> None:
        async with self._sync_lock:
            if not self.sessions_dir.exists():
                return
            jsonl_files = sorted(self.sessions_dir.glob("*.jsonl"))
            existing_source_ids = {
                await self._load_source_session_id(file_path) for file_path in jsonl_files
            }
            await self._cleanup_stale_sessions(existing_source_ids)
            for file_path in jsonl_files:
                await self._sync_file(file_path, full_sync=True)

    async def _load_source_session_id(self, file_path: Path) -> str:
        file_path_str = str(file_path)
        cached = self._file_to_source_session.get(file_path_str)
        if cached:
            return cached

        if self.instance.platform == "openclaw":
            source_session_id = file_path.stem
        elif self.instance.platform == "nanobot":
            batch = await parse_nanobot_session_file(file_path, start_line=0)
            source_session_id = batch.session.source_session_id
        else:
            batch = await parse_hermes_session_file(file_path, start_line=0)
            source_session_id = batch.session.source_session_id
        self._file_to_source_session[file_path_str] = source_session_id
        return source_session_id

    async def _cleanup_stale_sessions(self, existing_source_ids: set[str]) -> None:
        # Only purge sessions whose ``jsonl_file_path`` is non-empty — those rows
        # were created by JSONL ingestion and the runtime file is the source of
        # truth, so a missing file means the session was deleted upstream.
        # Sessions written directly to SQLite by ``chat.py`` (Hermes
        # direct-persist path, see ``_persist_hermes_session`` /
        # ``_persist_hermes_chat_turn``) leave ``jsonl_file_path`` NULL and must
        # survive XSafeClaw restarts even when the runtime never produced a
        # corresponding JSONL on disk.
        try:
            async with get_db_context() as db:
                result = await db.execute(
                    select(
                        Session.session_id,
                        Session.source_session_id,
                        Session.jsonl_file_path,
                    )
                    .where(Session.platform == self.instance.platform)
                    .where(Session.instance_id == self.instance.instance_id)
                )
                stale: list[str] = []
                for session_id, source_session_id, jsonl_file_path in result.all():
                    if not source_session_id:
                        continue
                    if not jsonl_file_path:
                        continue
                    if source_session_id in existing_source_ids:
                        continue
                    stale.append(session_id)
                for session_id in stale:
                    await self._delete_session_data_by_internal_id(db, session_id)
        except Exception as exc:
            print(f"❌ Failed stale cleanup for {self.instance.instance_id}: {exc}")

    async def _delete_session_data_by_internal_id(
        self,
        db: AsyncSession,
        session_id: str,
    ) -> None:
        await db.execute(delete(Event).where(Event.session_id == session_id))
        message_ids = (
            await db.execute(select(Message.id).where(Message.session_id == session_id))
        ).scalars().all()
        if message_ids:
            await db.execute(
                delete(ToolCall).where(ToolCall.message_db_id.in_(message_ids))
            )
        await db.execute(delete(Message).where(Message.session_id == session_id))
        await db.execute(delete(Session).where(Session.session_id == session_id))

    def _queue_file_sync(self, path: Path, *, full_sync: bool) -> None:
        loop = asyncio.get_running_loop()
        file_path_str = str(path)
        debounce = (
            self._created_event_debounce_seconds
            if full_sync
            else self._modified_event_debounce_seconds
        )
        ready_at = loop.time() + debounce
        existing = self._pending_file_sync.get(file_path_str)
        if existing:
            full_sync = bool(existing["full_sync"]) or full_sync
            ready_at = max(float(existing["ready_at"]), ready_at)
        self._pending_file_sync[file_path_str] = {
            "path": path,
            "full_sync": full_sync,
            "ready_at": ready_at,
        }

    async def _on_file_event(self, event_type: str, file_path: str) -> None:
        path = Path(file_path)
        if event_type == "deleted":
            source_session_id = self._file_to_source_session.pop(str(path), path.stem)
            internal_session_id = namespace_session_id(
                self.instance.platform,
                self.instance.instance_id,
                source_session_id,
            )
            async with self._sync_lock:
                async with get_db_context() as db:
                    await self._delete_session_data_by_internal_id(db, internal_session_id)
            self._sync_positions.pop(str(path), None)
            self._pending_event_sync.discard(internal_session_id)
            return

        self._queue_file_sync(path, full_sync=event_type == "created")

    async def _batched_file_sync_loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(self._file_sync_poll_interval_seconds)
                if not self._pending_file_sync:
                    continue
                now = asyncio.get_running_loop().time()
                due = [
                    key
                    for key, entry in self._pending_file_sync.items()
                    if float(entry["ready_at"]) <= now
                ]
                if not due:
                    continue
                batch = [self._pending_file_sync.pop(key) for key in due]
                async with self._sync_lock:
                    for entry in batch:
                        path = entry["path"]
                        if not path.exists():
                            continue
                        await self._sync_file(path, full_sync=bool(entry["full_sync"]))
            except asyncio.CancelledError:
                break
            except Exception as exc:
                print(f"❌ Sync batch failed for {self.instance.instance_id}: {exc}")

    async def _debounced_event_sync_loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(2)
                if not self._pending_event_sync:
                    continue
                session_ids = sorted(self._pending_event_sync)
                self._pending_event_sync.clear()
                for session_id in session_ids:
                    await self.event_sync_service.sync_session_events(session_id)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                print(f"❌ Event sync failed for {self.instance.instance_id}: {exc}")

    async def _parse_file(self, file_path: Path, start_line: int) -> ParsedSessionBatch:
        if self.instance.platform == "openclaw":
            return await parse_openclaw_session_file(file_path, start_line=start_line)
        if self.instance.platform == "hermes":
            return await parse_hermes_session_file(file_path, start_line=start_line)
        return await parse_nanobot_session_file(file_path, start_line=start_line)

    async def _sync_file(self, file_path: Path, *, full_sync: bool = False) -> None:
        start_line = 0 if full_sync else self._sync_positions.get(str(file_path), 0)
        batch = await self._parse_file(file_path, start_line)
        self._file_to_source_session[str(file_path)] = batch.session.source_session_id

        async with get_db_context() as db:
            internal_session_id = await self._ensure_session(db, batch.session)
            for message in batch.messages:
                await self._sync_message(
                    db,
                    batch.session.source_session_id,
                    internal_session_id,
                    message,
                )

        self._sync_positions[str(file_path)] = batch.total_lines
        self._pending_event_sync.add(internal_session_id)

    async def _ensure_session(
        self,
        db: AsyncSession,
        session: ParsedSessionInfo,
    ) -> str:
        internal_session_id = namespace_session_id(
            self.instance.platform,
            self.instance.instance_id,
            session.source_session_id,
        )
        encoded_session_key = (
            f"{self.instance.platform}::{self.instance.instance_id}::{session.session_key}"
            if session.session_key
            else None
        )
        result = await db.execute(
            select(Session).where(Session.session_id == internal_session_id)
        )
        existing = result.scalar_one_or_none()
        provider = session.current_model_provider or str(self.instance.meta.get("provider") or "")
        model_name = session.current_model_name or str(self.instance.meta.get("model") or "")
        if existing:
            existing.platform = self.instance.platform
            existing.instance_id = self.instance.instance_id
            existing.source_session_id = session.source_session_id
            existing.session_key = encoded_session_key or existing.session_key
            existing.cwd = session.cwd or existing.cwd
            existing.last_activity_at = session.last_activity_at or existing.last_activity_at
            existing.current_model_provider = provider or existing.current_model_provider
            existing.current_model_name = model_name or existing.current_model_name
            existing.jsonl_file_path = session.jsonl_file_path or existing.jsonl_file_path
            existing.updated_at = datetime.now(timezone.utc)
            return internal_session_id

        db.add(
            Session(
                session_id=internal_session_id,
                platform=self.instance.platform,
                instance_id=self.instance.instance_id,
                source_session_id=session.source_session_id,
                session_key=encoded_session_key,
                first_seen_at=session.first_seen_at,
                last_activity_at=session.last_activity_at or session.first_seen_at,
                cwd=session.cwd,
                current_model_provider=provider or None,
                current_model_name=model_name or None,
                jsonl_file_path=session.jsonl_file_path,
            )
        )
        await db.flush()
        return internal_session_id

    async def _sync_message(
        self,
        db: AsyncSession,
        source_session_id: str,
        session_id: str,
        parsed: ParsedMessage,
    ) -> None:
        internal_message_id = namespace_message_id(
            self.instance.platform,
            self.instance.instance_id,
            source_session_id,
            parsed.source_message_id,
        )
        existing = await db.execute(
            select(Message.id).where(Message.message_id == internal_message_id)
        )
        if existing.scalar_one_or_none():
            return

        parent_message_id = None
        if parsed.source_parent_message_id:
            parent_message_id = namespace_message_id(
                self.instance.platform,
                self.instance.instance_id,
                source_session_id,
                parsed.source_parent_message_id,
            )

        message = Message(
            session_id=session_id,
            message_id=internal_message_id,
            platform=self.instance.platform,
            instance_id=self.instance.instance_id,
            source_session_id=source_session_id,
            source_message_id=parsed.source_message_id,
            parent_message_id=parent_message_id,
            role=parsed.role,
            timestamp=parsed.timestamp,
            content_text=_clean_null_bytes(parsed.content_text),
            content_json=_clean_json(parsed.content_json),
            provider=parsed.provider,
            model_id=parsed.model_id,
            model_api=parsed.model_api,
            input_tokens=parsed.input_tokens,
            output_tokens=parsed.output_tokens,
            total_tokens=parsed.total_tokens,
            cache_read_tokens=parsed.cache_read_tokens,
            cache_write_tokens=parsed.cache_write_tokens,
            stop_reason=parsed.stop_reason,
            error_message=parsed.error_message,
            raw_entry=_clean_json(parsed.raw_entry),
        )
        db.add(message)
        await db.flush()

        for tool_call in parsed.tool_calls:
            await self._create_tool_call(
                db,
                source_session_id=source_session_id,
                message=message,
                source_tool_call_id=tool_call.source_tool_call_id,
                tool_name=tool_call.tool_name,
                arguments=tool_call.arguments,
                started_at=parsed.timestamp,
            )

        if parsed.tool_result and parsed.tool_result.source_tool_call_id:
            await self._update_tool_call_result(
                db,
                source_session_id=source_session_id,
                message=message,
                raw_entry=parsed.raw_entry or {},
                tool_result=parsed.tool_result,
                timestamp=parsed.timestamp,
            )

    async def _create_tool_call(
        self,
        db: AsyncSession,
        *,
        source_session_id: str,
        message: Message,
        source_tool_call_id: str,
        tool_name: str,
        arguments: dict[str, Any] | None,
        started_at: datetime,
    ) -> None:
        internal_tool_call_id = namespace_tool_call_id(
            self.instance.platform,
            self.instance.instance_id,
            source_session_id,
            source_tool_call_id,
        )
        existing = await db.execute(
            select(ToolCall.id).where(ToolCall.id == internal_tool_call_id)
        )
        if existing.scalar_one_or_none():
            return

        db.add(
            ToolCall(
                id=internal_tool_call_id,
                platform=self.instance.platform,
                instance_id=self.instance.instance_id,
                source_session_id=source_session_id,
                source_tool_call_id=source_tool_call_id,
                message_db_id=message.id,
                initiating_message_id=message.message_id,
                tool_name=tool_name,
                arguments=arguments,
                started_at=started_at,
                status="pending",
            )
        )
        await db.flush()

    async def _update_tool_call_result(
        self,
        db: AsyncSession,
        *,
        source_session_id: str,
        message: Message,
        raw_entry: dict[str, Any],
        tool_result: ParsedToolResult,
        timestamp: datetime,
    ) -> None:
        internal_tool_call_id = namespace_tool_call_id(
            self.instance.platform,
            self.instance.instance_id,
            source_session_id,
            tool_result.source_tool_call_id,
        )
        result = await db.execute(
            select(ToolCall).where(ToolCall.id == internal_tool_call_id)
        )
        tool_call = result.scalar_one_or_none()
        if tool_call is None:
            tool_name = str(raw_entry.get("name") or raw_entry.get("toolName") or "unknown")
            tool_call = ToolCall(
                id=internal_tool_call_id,
                platform=self.instance.platform,
                instance_id=self.instance.instance_id,
                source_session_id=source_session_id,
                source_tool_call_id=tool_result.source_tool_call_id,
                tool_name=tool_name,
                started_at=timestamp,
                status="pending",
            )
            db.add(tool_call)
            await db.flush()

        tool_call.result_message_id = message.message_id
        tool_call.completed_at = timestamp
        tool_call.result_text = _clean_null_bytes(tool_result.result_text)
        tool_call.result_json = _clean_json(tool_result.result_json)
        tool_call.is_error = tool_result.is_error
        tool_call.status = "failed" if tool_result.is_error else "completed"
        tool_call.exit_code = tool_result.exit_code
        tool_call.cwd = tool_result.cwd
        tool_call.duration_seconds = tool_result.duration_seconds


class MessageSyncService:
    """Instance-driven message synchronization service."""

    def __init__(self):
        self.registry = RuntimeRegistry()
        self._running = False
        self._refresh_task: asyncio.Task | None = None
        self._workers: dict[str, RuntimeSyncWorker] = {}
        self._event_sync_service = EventSyncService()

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        await self.refresh_instances()
        self._refresh_task = asyncio.create_task(self._periodic_instance_refresh())

    async def stop(self) -> None:
        self._running = False
        if self._refresh_task:
            self._refresh_task.cancel()
            try:
                await self._refresh_task
            except asyncio.CancelledError:
                pass
        for worker in list(self._workers.values()):
            await worker.stop()
        self._workers.clear()

    async def refresh_instances(self) -> None:
        instances = await self.registry.get_instances()
        desired = {
            instance.instance_id: instance
            for instance in instances
            if instance.enabled
            and instance.capabilities.get("monitoring")
            and instance.sessions_path
        }

        for instance_id in list(self._workers):
            if instance_id not in desired:
                await self._workers.pop(instance_id).stop()

        for instance_id, instance in desired.items():
            worker = self._workers.get(instance_id)
            if worker is None:
                worker = RuntimeSyncWorker(instance, self._event_sync_service)
                self._workers[instance_id] = worker
                await worker.start()
            else:
                worker.instance = instance

    async def _periodic_instance_refresh(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(30)
                await self.refresh_instances()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                print(f"❌ Runtime refresh failed: {exc}")

    async def _initial_scan(self) -> None:
        """Manually trigger a full re-scan for every active worker."""
        for worker in self._workers.values():
            await worker._initial_scan()

    def is_running(self) -> bool:
        return self._running
