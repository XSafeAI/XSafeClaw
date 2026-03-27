"""API routes for Events."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_serializer
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ...database import get_db
from ...models import Event, Message, ToolCall

router = APIRouter()

_USER_PREVIEW_MAX_LEN = 280


def _clip_preview(text: str) -> str:
    text = text.strip()
    if not text:
        return ""
    return text[:_USER_PREVIEW_MAX_LEN] if len(text) > _USER_PREVIEW_MAX_LEN else text


def _extract_text_from_content_items(items: list | None) -> str:
    """Collect text parts from OpenClaw-style content arrays (type/text blocks)."""
    if not items or not isinstance(items, list):
        return ""
    parts: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "text" and item.get("text"):
            parts.append(str(item["text"]).strip())
        elif item.get("text") and not item.get("type"):
            parts.append(str(item["text"]).strip())
    return " ".join(p for p in parts if p)


def _sender_from_dict(d: dict | None) -> str | None:
    """Pick a short display label; prefer name over label (label often has '(gateway-client)' noise)."""
    if not isinstance(d, dict):
        return None
    for key in ("name", "username", "displayName", "label", "id"):
        v = d.get(key)
        if v is not None and str(v).strip():
            return str(v).strip()
    return None


def _sender_label_from_raw(raw: dict | None) -> str | None:
    """Resolve gateway / client sender label from JSONL raw entry (e.g. gateway-client)."""
    if not raw or not isinstance(raw, dict):
        return None
    sender = raw.get("sender")
    if isinstance(sender, dict):
        sl = _sender_from_dict(sender)
        if sl:
            return sl
    if isinstance(sender, str) and sender.strip():
        return sender.strip()
    msg = raw.get("message")
    if isinstance(msg, dict):
        sender = msg.get("sender")
        if isinstance(sender, dict):
            sl = _sender_from_dict(sender)
            if sl:
                return sl
        if isinstance(sender, str) and sender.strip():
            return sender.strip()
        for meta_key in ("metadata", "meta"):
            meta = msg.get(meta_key)
            if isinstance(meta, dict):
                sender = meta.get("sender")
                if isinstance(sender, dict):
                    sl = _sender_from_dict(sender)
                    if sl:
                        return sl
    return None


def _strip_sender_metadata_preamble(text: str) -> str:
    """If the body is markdown 'Sender (untrusted metadata):' + ```json ... ```, keep text after the fence."""
    s = text.strip()
    if not s:
        return ""
    lower = s.lower()
    if "sender (untrusted metadata)" not in lower and "untrusted metadata" not in lower:
        return s
    parts = s.split("```")
    if len(parts) >= 3:
        tail = "".join(parts[2:]).strip()
        if tail:
            return tail
    # Only the fenced JSON block, no user line — let caller try raw_entry / other paths
    return ""


def _extract_user_message_preview(um: Message) -> str | None:
    """Best-effort preview: user text first; sender label only when no body text exists."""
    text = (um.content_text or "").strip()
    if text:
        cleaned = _strip_sender_metadata_preamble(text)
        if cleaned:
            return _clip_preview(cleaned)

    cj = um.content_json
    if isinstance(cj, list):
        merged = _extract_text_from_content_items(cj)
        if merged:
            return _clip_preview(merged)
    elif isinstance(cj, dict):
        for key in ("text", "body", "message"):
            v = cj.get(key)
            if isinstance(v, str) and v.strip():
                return _clip_preview(v)
    elif isinstance(cj, str) and cj.strip():
        return _clip_preview(cj.strip())

    raw = um.raw_entry
    sender_label = _sender_label_from_raw(raw)
    if isinstance(raw, dict):
        msg = raw.get("message")
        if isinstance(msg, dict):
            content = msg.get("content")
            if isinstance(content, list):
                merged = _extract_text_from_content_items(content)
                if merged:
                    cleaned = _strip_sender_metadata_preamble(merged)
                    if cleaned:
                        if sender_label and cleaned != sender_label:
                            return _clip_preview(f"{sender_label}: {cleaned}")
                        return _clip_preview(cleaned)
            if isinstance(content, str) and content.strip():
                merged = _strip_sender_metadata_preamble(content.strip())
                if merged:
                    if sender_label:
                        return _clip_preview(f"{sender_label}: {merged}")
                    return _clip_preview(merged)
            for key in ("text", "body"):
                v = msg.get(key)
                if isinstance(v, str) and v.strip():
                    merged = _strip_sender_metadata_preamble(v.strip())
                    if merged:
                        if sender_label:
                            return _clip_preview(f"{sender_label}: {merged}")
                        return _clip_preview(merged)

    if sender_label:
        return _clip_preview(sender_label)

    return None


def _user_message_preview_from_event(event: Event) -> str | None:
    um = getattr(event, "user_message", None)
    if um is None:
        return None
    return _extract_user_message_preview(um)


# Pydantic schemas
class EventToolCallSummary(BaseModel):
    """Summary of a tool call in a message."""
    id: str
    tool_name: str
    arguments: dict | None = None


class EventMessageSummary(BaseModel):
    """Summary of a message in an event."""

    message_id: str
    role: str
    timestamp: str
    content_text: str | None = None
    tool_calls_count: int = 0
    tool_call_ids: list[str] = []  # Tool call IDs for assistant/toolResult messages
    tool_calls: list[EventToolCallSummary] = []  # Tool call details


class EventResponse(BaseModel):
    """Event response schema."""

    id: str
    session_id: str
    user_message_id: str
    started_at: datetime
    completed_at: datetime | None
    total_messages: int
    total_tool_calls: int
    total_assistant_messages: int
    total_tool_result_messages: int
    total_input_tokens: int
    total_output_tokens: int
    total_tokens: int
    tool_call_ids: list[str] | None = None  # List of tool call IDs
    status: str
    error_message: str | None
    user_message_preview: str | None = Field(
        default=None,
        description="UI preview: user text, structured content blocks, or sender label from raw JSONL (e.g. gateway).",
    )
    created_at: datetime
    updated_at: datetime | None

    @field_serializer('started_at', 'completed_at', 'created_at', 'updated_at')
    def serialize_datetime(self, value: datetime | None) -> str | None:
        return value.isoformat() if value else None

    class Config:
        from_attributes = True


class EventWithMessagesResponse(EventResponse):
    """Event response with message details."""

    messages: list[EventMessageSummary] = []


class EventListResponse(BaseModel):
    """List of events response."""

    events: list[EventResponse]
    total: int
    page: int
    page_size: int


class EventStatsResponse(BaseModel):
    """Event statistics response."""

    total_events: int
    completed_events: int
    error_events: int
    pending_events: int
    avg_messages_per_event: float
    avg_tool_calls_per_event: float
    avg_tokens_per_event: float
    avg_duration_seconds: float | None


@router.get("/", response_model=EventListResponse)
async def list_events(
    db: Annotated[AsyncSession, Depends(get_db)],
    session_id: str | None = Query(None, description="Filter by session ID"),
    status: str | None = Query(None, description="Filter by status"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(500, ge=1, le=5000, description="Max records to return"),
) -> EventListResponse:
    """List events with optional filters."""
    query = select(Event)

    if session_id:
        query = query.where(Event.session_id == session_id)
    if status:
        query = query.where(Event.status == status)

    count_query = select(func.count()).select_from(query.subquery())
    total = await db.scalar(count_query) or 0

    query = (
        query.options(selectinload(Event.user_message))
        .order_by(desc(Event.started_at))
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(query)
    events = result.scalars().unique().all()

    event_rows: list[EventResponse] = []
    for e in events:
        preview = _user_message_preview_from_event(e)
        base = EventResponse.model_validate(e)
        event_rows.append(base.model_copy(update={"user_message_preview": preview}))

    return EventListResponse(
        events=event_rows,
        total=total,
        page=skip // limit + 1,
        page_size=limit,
    )


@router.get("/{event_id}", response_model=EventWithMessagesResponse)
async def get_event(
    event_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EventWithMessagesResponse:
    """Get a specific event with all its messages."""
    result = await db.execute(
        select(Event).options(selectinload(Event.user_message)).where(Event.id == event_id),
    )
    event = result.scalar_one_or_none()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # Get all messages for this event
    # Messages belong to an event if they are between this user message
    # and the next user message (or end of session)
    
    # Get all messages in the session, ordered by timestamp
    messages_result = await db.execute(
        select(Message)
        .where(Message.session_id == event.session_id)
        .where(Message.timestamp >= event.started_at)
        .order_by(Message.timestamp)
    )
    all_messages = messages_result.scalars().all()

    # Find messages until next user message
    event_messages = []
    for msg in all_messages:
        if msg.message_id == event.user_message_id:
            # Start including messages
            event_messages.append(msg)
        elif event_messages:
            if msg.role == "user":
                # Stop at next user message
                break
            event_messages.append(msg)

    # Convert to summaries
    message_summaries = []
    for msg in event_messages:
        tool_calls_count = 0
        tool_call_ids = []
        tool_calls_detail = []
        
        if msg.content_json and isinstance(msg.content_json, list):
            for item in msg.content_json:
                if isinstance(item, dict) and item.get("type") == "toolCall":
                    tool_calls_count += 1
                    tool_call_id = item.get("id", "")
                    tool_name = item.get("name", "unknown")
                    arguments = item.get("input") or item.get("arguments")
                    if tool_call_id:
                        tool_call_ids.append(tool_call_id)
                    tool_calls_detail.append(
                        EventToolCallSummary(
                            id=tool_call_id,
                            tool_name=tool_name,
                            arguments=arguments if isinstance(arguments, dict) else None,
                        )
                    )

        message_summaries.append(
            EventMessageSummary(
                message_id=msg.message_id,
                role=msg.role,
                timestamp=msg.timestamp.isoformat(),
                content_text=msg.content_text,
                tool_calls_count=tool_calls_count,
                tool_call_ids=tool_call_ids,
                tool_calls=tool_calls_detail,
            )
        )

    base = EventResponse.model_validate(event).model_copy(
        update={"user_message_preview": _user_message_preview_from_event(event)},
    )
    return EventWithMessagesResponse(
        **base.model_dump(),
        messages=message_summaries,
    )


@router.get("/stats/overview", response_model=EventStatsResponse)
async def get_event_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    session_id: str | None = Query(None, description="Filter by session ID"),
) -> EventStatsResponse:
    """Get overall event statistics."""
    query = select(Event)
    if session_id:
        query = query.where(Event.session_id == session_id)

    result = await db.execute(query)
    events = result.scalars().all()

    if not events:
        return EventStatsResponse(
            total_events=0,
            completed_events=0,
            error_events=0,
            pending_events=0,
            avg_messages_per_event=0.0,
            avg_tool_calls_per_event=0.0,
            avg_tokens_per_event=0.0,
            avg_duration_seconds=None,
        )

    total_events = len(events)
    completed_events = sum(1 for e in events if e.status == "completed")
    error_events = sum(1 for e in events if e.status == "error")
    pending_events = sum(1 for e in events if e.status == "pending")

    total_messages = sum(e.total_messages for e in events)
    total_tool_calls = sum(e.total_tool_calls for e in events)
    total_tokens = sum(e.total_tokens for e in events)

    # Calculate average duration
    durations = []
    for e in events:
        if e.completed_at and e.started_at:
            duration = (e.completed_at - e.started_at).total_seconds()
            if duration >= 0:
                durations.append(duration)

    avg_duration = sum(durations) / len(durations) if durations else None

    return EventStatsResponse(
        total_events=total_events,
        completed_events=completed_events,
        error_events=error_events,
        pending_events=pending_events,
        avg_messages_per_event=total_messages / total_events,
        avg_tool_calls_per_event=total_tool_calls / total_events,
        avg_tokens_per_event=total_tokens / total_events,
        avg_duration_seconds=avg_duration,
    )


@router.post("/sync/{session_id}")
async def sync_session_events(
    session_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """Manually trigger event synchronization for a session."""
    from ...services import EventSyncService

    service = EventSyncService()
    count = await service.sync_session_events(session_id)

    return {
        "session_id": session_id,
        "events_synced": count,
        "message": f"Successfully synced {count} events",
    }


@router.post("/sync-all")
async def sync_all_events(db: Annotated[AsyncSession, Depends(get_db)]) -> dict:
    """Manually trigger event synchronization for all sessions."""
    from ...services import EventSyncService

    service = EventSyncService()
    results = await service.sync_all_sessions()

    total_events = sum(results.values())
    return {
        "sessions_processed": len(results),
        "total_events_synced": total_events,
        "message": f"Successfully synced {total_events} events across {len(results)} sessions",
    }
