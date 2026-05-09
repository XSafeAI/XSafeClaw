"""Shared helpers for runtime token-usage normalization.

References:
- OpenClaw token/cost docs: https://docs.openclaw.ai/reference/token-use
- Hermes API server docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server
- Nanobot currently may omit usage in session logs/gateway payloads.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any


def _as_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _first_int(raw_usage: Mapping[str, Any], *keys: str) -> int | None:
    for key in keys:
        value = _as_int(raw_usage.get(key))
        if value is not None:
            return value
    return None


def normalize_usage(raw_usage: Mapping[str, Any] | None) -> dict[str, int | None]:
    """Normalize runtime-specific usage keys into one shared shape."""
    usage = raw_usage if isinstance(raw_usage, Mapping) else {}
    if not usage:
        return {
            "input_tokens": None,
            "output_tokens": None,
            "cache_read_tokens": None,
            "cache_write_tokens": None,
            "total_tokens": None,
        }

    input_tokens = _first_int(
        usage,
        "input",
        "input_tokens",
        "prompt_tokens",
        "promptTokens",
    )
    output_tokens = _first_int(
        usage,
        "output",
        "output_tokens",
        "completion_tokens",
        "completionTokens",
    )
    cache_read_tokens = _first_int(
        usage,
        "cacheRead",
        "cache_read",
        "cache_read_tokens",
        "cached_tokens",
    )
    cache_write_tokens = _first_int(
        usage,
        "cacheWrite",
        "cache_write",
        "cache_write_tokens",
    )
    total_tokens = _first_int(
        usage,
        "totalTokens",
        "total_tokens",
    )

    if total_tokens is None:
        parts = [input_tokens, output_tokens, cache_read_tokens, cache_write_tokens]
        if any(part is not None for part in parts):
            total_tokens = sum(part or 0 for part in parts)

    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_read_tokens": cache_read_tokens,
        "cache_write_tokens": cache_write_tokens,
        "total_tokens": total_tokens,
    }


def has_usage(usage: Mapping[str, Any] | None) -> bool:
    normalized = normalize_usage(usage)
    return any(value is not None for value in normalized.values())


def estimate_tokens_from_text(text: str | None) -> int:
    content = str(text or "").strip()
    if not content:
        return 0
    # OpenClaw docs estimate ~4 chars/token for OpenAI-style English.
    return max(1, math.ceil(len(content) / 4))


def attach_usage_metadata(
    raw_entry: dict[str, Any] | None,
    *,
    usage_source: str,
    usage_estimated: bool,
) -> dict[str, Any]:
    payload = dict(raw_entry) if isinstance(raw_entry, dict) else {}
    payload["_xsafeclaw_usage"] = {
        "source": usage_source,
        "estimated": bool(usage_estimated),
    }
    return payload
