"""JSONL entry parser for OpenClaw session files."""

import json
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncIterator

from pydantic import BaseModel, Field, field_validator


class SessionEntry(BaseModel):
    """Session initialization entry."""

    type: str = "session"
    version: int
    id: str
    timestamp: datetime
    cwd: str | None = None


class ModelChangeEntry(BaseModel):
    """Model change entry."""

    type: str = "model_change"
    id: str
    parent_id: str | None = Field(None, alias="parentId")
    timestamp: datetime
    provider: str
    model_id: str = Field(alias="modelId")


class ThinkingLevelChangeEntry(BaseModel):
    """Thinking level change entry."""

    type: str = "thinking_level_change"
    id: str
    parent_id: str | None = Field(None, alias="parentId")
    timestamp: datetime
    thinking_level: str = Field(alias="thinkingLevel")


class MessageContent(BaseModel):
    """Message content item."""

    type: str  # "text", "image", "tool_use", "tool_result"
    text: str | None = None
    # Add more fields as needed for tool_use, tool_result, etc.


class TokenUsage(BaseModel):
    """Token usage information."""

    input: int = 0
    output: int = 0
    cache_read: int = Field(0, alias="cacheRead")
    cache_write: int = Field(0, alias="cacheWrite")
    total_tokens: int = Field(0, alias="totalTokens")


class Message(BaseModel):
    """Message data."""

    role: str  # "user", "assistant"
    content: list[MessageContent] | list[dict[str, Any]]
    timestamp: int
    api: str | None = None
    provider: str | None = None
    model: str | None = None
    usage: TokenUsage | None = None
    stop_reason: str | None = Field(None, alias="stopReason")


class MessageEntry(BaseModel):
    """Message entry (user or assistant)."""

    type: str = "message"
    id: str
    parent_id: str | None = Field(None, alias="parentId")
    timestamp: datetime
    message: Message


class CustomEntry(BaseModel):
    """Custom entry."""

    type: str = "custom"
    custom_type: str | None = Field(None, alias="customType")
    data: dict[str, Any] | None = None
    id: str
    parent_id: str | None = Field(None, alias="parentId")
    timestamp: datetime


class JSONLEntry(BaseModel):
    """Generic JSONL entry wrapper."""

    raw_data: dict[str, Any]
    entry_type: str
    timestamp: datetime
    entry_id: str | None = None
    parent_id: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "JSONLEntry":
        """Create JSONLEntry from dict."""
        entry_type = data.get("type", "unknown")
        timestamp_str = data.get("timestamp")
        
        # Parse timestamp
        timestamp = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00")) if timestamp_str else datetime.utcnow()
        
        return cls(
            raw_data=data,
            entry_type=entry_type,
            timestamp=timestamp,
            entry_id=data.get("id"),
            parent_id=data.get("parentId"),
        )


class JSONLParser:
    """Parser for OpenClaw JSONL session files."""

    def __init__(self, file_path: Path | str):
        """Initialize parser with file path."""
        self.file_path = Path(file_path)
        self.session_id = self.file_path.stem  # Use filename as session_id

    async def parse_line(self, line: str) -> JSONLEntry | None:
        """Parse a single JSONL line."""
        if not line.strip():
            return None

        try:
            data = json.loads(line)
            return JSONLEntry.from_dict(data)
        except json.JSONDecodeError as e:
            # Log error but continue parsing
            print(f"Failed to parse line: {e}")
            return None

    async def parse_entries(self, start_line: int = 0, limit: int | None = None) -> AsyncIterator[JSONLEntry]:
        """
        Parse entries from JSONL file.

        Args:
            start_line: Line number to start from (0-indexed)
            limit: Maximum number of entries to parse

        Yields:
            JSONLEntry objects
        """
        count = 0

        with open(self.file_path, "r", encoding="utf-8", errors="replace") as f:
            # Skip to start_line
            for _ in range(start_line):
                next(f, None)

            # Parse lines
            for line in f:
                if limit and count >= limit:
                    break

                # Clean NULL bytes (PostgreSQL doesn't support them)
                line = line.replace('\x00', '')

                entry = await self.parse_line(line)
                if entry:
                    yield entry
                    count += 1

    async def parse_all(self) -> list[JSONLEntry]:
        """Parse all entries from file."""
        entries = []
        async for entry in self.parse_entries():
            entries.append(entry)
        return entries

    async def get_session_info(self) -> SessionEntry | None:
        """Extract session initialization entry (first line)."""
        with open(self.file_path, "r", encoding="utf-8") as f:
            first_line = f.readline()
            if first_line:
                try:
                    data = json.loads(first_line)
                    if data.get("type") == "session":
                        return SessionEntry(**data)
                except (json.JSONDecodeError, Exception) as e:
                    print(f"Failed to parse session info: {e}")
        return None

    def get_line_count(self) -> int:
        """Get total number of lines in file."""
        with open(self.file_path, "r", encoding="utf-8") as f:
            return sum(1 for _ in f)

    async def parse_specific_entry_types(
        self, entry_types: set[str], start_line: int = 0, limit: int | None = None
    ) -> AsyncIterator[JSONLEntry]:
        """
        Parse only specific entry types.

        Args:
            entry_types: Set of entry type names to parse (e.g., {"message", "model_change"})
            start_line: Line number to start from
            limit: Maximum number of matching entries to return

        Yields:
            Matching JSONLEntry objects
        """
        count = 0
        async for entry in self.parse_entries(start_line=start_line):
            if entry.entry_type in entry_types:
                yield entry
                count += 1
                if limit and count >= limit:
                    break


async def parse_jsonl_file(file_path: Path | str) -> list[JSONLEntry]:
    """Convenience function to parse entire JSONL file."""
    parser = JSONLParser(file_path)
    return await parser.parse_all()


async def parse_jsonl_incremental(
    file_path: Path | str, start_line: int = 0, chunk_size: int = 100
) -> AsyncIterator[list[JSONLEntry]]:
    """
    Parse JSONL file incrementally in chunks.

    Args:
        file_path: Path to JSONL file
        start_line: Line to start from
        chunk_size: Number of entries per chunk

    Yields:
        Chunks of JSONLEntry objects
    """
    parser = JSONLParser(file_path)
    chunk: list[JSONLEntry] = []

    async for entry in parser.parse_entries(start_line=start_line):
        chunk.append(entry)
        if len(chunk) >= chunk_size:
            yield chunk
            chunk = []

    # Yield remaining entries
    if chunk:
        yield chunk
