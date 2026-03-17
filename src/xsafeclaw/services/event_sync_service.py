"""Event synchronization service - groups messages into events."""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db_context
from ..models import Event, Message, Session


class EventSyncService:
    """Service to create and update Events from Messages."""

    async def sync_session_events(self, session_id: str) -> int:
        """
        Sync all events for a session.
        
        Groups messages by user messages, creating one Event per user message
        that includes all subsequent messages until the next user message.
        
        Returns:
            Number of events created/updated
        """
        async with get_db_context() as db:
            # Get all messages for this session, ordered by timestamp
            result = await db.execute(
                select(Message)
                .where(Message.session_id == session_id)
                .order_by(Message.timestamp)
            )
            messages = result.scalars().all()

            if not messages:
                return 0

            # Group messages into events
            events_data = self._group_messages_into_events(messages)

            # Create/update events in database
            events_created = 0
            for event_data in events_data:
                await self._create_or_update_event(db, session_id, event_data)
                events_created += 1

            await db.commit()
            return events_created

    def _group_messages_into_events(
        self, messages: list[Message]
    ) -> list[dict]:
        """
        Group messages into events.
        
        Each event starts with a user message and includes all subsequent
        messages until the next user message (or end of list).
        """
        events = []
        current_event = None

        for msg in messages:
            if msg.role == "user":
                # Save previous event if exists
                if current_event:
                    events.append(current_event)

                # Start new event
                current_event = {
                    "event_id": msg.message_id,
                    "user_message_id": msg.message_id,
                    "started_at": msg.timestamp,
                    "completed_at": msg.timestamp,  # Will be updated
                    "messages": [msg],
                    "total_messages": 1,
                    "total_assistant_messages": 0,
                    "total_tool_result_messages": 0,
                    "total_tool_calls": 0,
                    "tool_call_ids": [],  # Track tool call IDs
                    "total_input_tokens": 0,
                    "total_output_tokens": 0,
                    "total_tokens": 0,
                    "status": "pending",
                    "error_message": None,
                }
            elif current_event:
                # Add message to current event
                current_event["messages"].append(msg)
                current_event["total_messages"] += 1
                current_event["completed_at"] = msg.timestamp

                # Update counters by role
                if msg.role == "assistant":
                    current_event["total_assistant_messages"] += 1
                    # Count tool calls from assistant messages and collect IDs
                    if msg.content_json:
                        tool_call_info = self._extract_tool_calls_from_content(
                            msg.content_json
                        )
                        current_event["total_tool_calls"] += tool_call_info["count"]
                        current_event["tool_call_ids"].extend(tool_call_info["ids"])

                    # Add token usage
                    current_event["total_input_tokens"] += msg.input_tokens or 0
                    current_event["total_output_tokens"] += msg.output_tokens or 0
                    current_event["total_tokens"] += msg.total_tokens or 0

                    # Update status
                    if msg.error_message:
                        current_event["status"] = "error"
                        current_event["error_message"] = msg.error_message
                    elif msg.stop_reason == "stop":
                        current_event["status"] = "completed"

                elif msg.role == "toolResult":
                    current_event["total_tool_result_messages"] += 1

        # Don't forget the last event
        if current_event:
            events.append(current_event)

        return events

    def _extract_tool_calls_from_content(self, content: list | dict) -> dict:
        """Extract tool call count and IDs from message content."""
        if not content:
            return {"count": 0, "ids": []}

        count = 0
        ids = []
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "toolCall":
                    count += 1
                    tool_call_id = item.get("id")
                    if tool_call_id:
                        ids.append(tool_call_id)
        return {"count": count, "ids": ids}

    def _count_tool_calls_in_content(self, content: list | dict) -> int:
        """Count tool calls in message content (backward compatibility)."""
        return self._extract_tool_calls_from_content(content)["count"]

    async def _create_or_update_event(
        self, db: AsyncSession, session_id: str, event_data: dict
    ) -> None:
        """Create or update an event in the database."""
        event_id = event_data["event_id"]

        # Check if event already exists
        result = await db.execute(
            select(Event).where(Event.id == event_id)
        )
        existing_event = result.scalar_one_or_none()

        if existing_event:
            # Update existing event
            existing_event.completed_at = event_data["completed_at"]
            existing_event.total_messages = event_data["total_messages"]
            existing_event.total_assistant_messages = event_data[
                "total_assistant_messages"
            ]
            existing_event.total_tool_result_messages = event_data[
                "total_tool_result_messages"
            ]
            existing_event.total_tool_calls = event_data["total_tool_calls"]
            existing_event.tool_call_ids = event_data["tool_call_ids"]
            existing_event.total_input_tokens = event_data["total_input_tokens"]
            existing_event.total_output_tokens = event_data["total_output_tokens"]
            existing_event.total_tokens = event_data["total_tokens"]
            existing_event.status = event_data["status"]
            existing_event.error_message = event_data["error_message"]
            existing_event.updated_at = datetime.now(timezone.utc)
        else:
            # Create new event
            new_event = Event(
                id=event_id,
                session_id=session_id,
                user_message_id=event_data["user_message_id"],
                started_at=event_data["started_at"],
                completed_at=event_data["completed_at"],
                total_messages=event_data["total_messages"],
                total_assistant_messages=event_data["total_assistant_messages"],
                total_tool_result_messages=event_data["total_tool_result_messages"],
                total_tool_calls=event_data["total_tool_calls"],
                tool_call_ids=event_data["tool_call_ids"],
                total_input_tokens=event_data["total_input_tokens"],
                total_output_tokens=event_data["total_output_tokens"],
                total_tokens=event_data["total_tokens"],
                status=event_data["status"],
                error_message=event_data["error_message"],
            )
            db.add(new_event)

    async def sync_all_sessions(self) -> dict[str, int]:
        """
        Sync events for all sessions.
        
        Returns:
            Dict mapping session_id to number of events created
        """
        async with get_db_context() as db:
            result = await db.execute(select(Session.session_id))
            session_ids = result.scalars().all()

        results = {}
        for session_id in session_ids:
            count = await self.sync_session_events(session_id)
            results[session_id] = count
            print(f"✅ Synced {count} events for session {session_id[:8]}...")

        return results
