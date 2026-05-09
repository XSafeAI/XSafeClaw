"""Built-in model pricing catalog.

Prices are in USD per 1 million tokens, sourced from each provider's
public API pricing pages (as of May 2026).  The catalog is used as a
fallback when ``~/.openclaw/openclaw.json`` does not contain cost data
— which is always the case for Hermes and Nanobot runtimes.

To add a new model, append an entry to ``_BUILTIN_PRICES``.  The
``aliases`` list lets fuzzy matching work when the model_id stored in
the DB doesn't exactly match the canonical name (e.g. "gpt-4o" vs
"gpt-4o-2024-08-06").
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True, slots=True)
class ModelPrice:
    provider: str
    model: str
    input: float
    output: float
    cache_read: float = 0.0
    cache_write: float = 0.0
    aliases: tuple[str, ...] = field(default_factory=tuple)


# All prices: USD per 1M tokens
_BUILTIN_PRICES: list[ModelPrice] = [
    # ── OpenAI ────────────────────────────────────────────────────────
    ModelPrice("openai", "gpt-4.1", 2.0, 8.0,
              aliases=("gpt-4.1-2025-04-14",)),
    ModelPrice("openai", "gpt-4.1-mini", 0.4, 1.6,
              aliases=("gpt-4.1-mini-2025-04-14",)),
    ModelPrice("openai", "gpt-4.1-nano", 0.1, 0.4,
              aliases=("gpt-4.1-nano-2025-04-14",)),
    ModelPrice("openai", "gpt-4o", 2.5, 10.0,
              aliases=("gpt-4o-2024-08-06", "gpt-4o-2024-11-20")),
    ModelPrice("openai", "gpt-4o-mini", 0.15, 0.6,
              aliases=("gpt-4o-mini-2024-07-18",)),
    ModelPrice("openai", "gpt-4-turbo", 10.0, 30.0,
              aliases=("gpt-4-turbo-2024-04-09",)),
    ModelPrice("openai", "gpt-4", 30.0, 60.0),
    ModelPrice("openai", "gpt-3.5-turbo", 0.5, 1.5,
              aliases=("gpt-3.5-turbo-0125",)),
    ModelPrice("openai", "o3", 2.0, 8.0,
              aliases=("o3-2025-04-16",)),
    ModelPrice("openai", "o3-mini", 1.1, 4.4,
              aliases=("o3-mini-2025-01-31",)),
    ModelPrice("openai", "o4-mini", 1.1, 4.4,
              aliases=("o4-mini-2025-04-16",)),
    ModelPrice("openai", "o1", 15.0, 60.0,
              aliases=("o1-2024-12-17",)),
    ModelPrice("openai", "o1-mini", 3.0, 12.0,
              aliases=("o1-mini-2024-09-12",)),
    ModelPrice("openai", "o1-preview", 15.0, 60.0),

    # ── Anthropic ─────────────────────────────────────────────────────
    ModelPrice("anthropic", "claude-opus-4-7", 15.0, 75.0,
              cache_read=1.5, cache_write=18.75,
              aliases=("claude-opus-4.7",)),
    ModelPrice("anthropic", "claude-opus-4-6", 15.0, 75.0,
              cache_read=1.5, cache_write=18.75,
              aliases=("claude-opus-4.6",)),
    ModelPrice("anthropic", "claude-opus-4-5-20250220", 15.0, 75.0,
              cache_read=1.5, cache_write=18.75,
              aliases=("claude-opus-4.5", "claude-4-5-opus",
                       "claude-opus-4-5")),
    ModelPrice("anthropic", "claude-sonnet-4-6", 3.0, 15.0,
              cache_read=0.3, cache_write=3.75,
              aliases=("claude-sonnet-4.6",)),
    ModelPrice("anthropic", "claude-sonnet-4-5-20250514", 3.0, 15.0,
              cache_read=0.3, cache_write=3.75,
              aliases=("claude-sonnet-4.5", "claude-4-5-sonnet",
                       "claude-sonnet-4-5")),
    ModelPrice("anthropic", "claude-sonnet-4-20250514", 3.0, 15.0,
              cache_read=0.3, cache_write=3.75,
              aliases=("claude-sonnet-4", "claude-4-sonnet")),
    ModelPrice("anthropic", "claude-3-7-sonnet-20250219", 3.0, 15.0,
              cache_read=0.3, cache_write=3.75,
              aliases=("claude-3.7-sonnet", "claude-3-7-sonnet")),
    ModelPrice("anthropic", "claude-3-5-sonnet-20241022", 3.0, 15.0,
              cache_read=0.3, cache_write=3.75,
              aliases=("claude-3.5-sonnet", "claude-3-5-sonnet",
                       "claude-3-5-sonnet-v2", "claude-3-5-sonnet-20240620")),
    ModelPrice("anthropic", "claude-3-5-haiku-20241022", 0.8, 4.0,
              cache_read=0.08, cache_write=1.0,
              aliases=("claude-3.5-haiku", "claude-3-5-haiku")),
    ModelPrice("anthropic", "claude-3-haiku-20240307", 0.25, 1.25,
              aliases=("claude-3-haiku",)),
    ModelPrice("anthropic", "claude-3-opus-20240229", 15.0, 75.0,
              cache_read=1.5, cache_write=18.75,
              aliases=("claude-3-opus",)),

    # ── Google Gemini ─────────────────────────────────────────────────
    ModelPrice("google", "gemini-2.5-pro", 1.25, 10.0,
              aliases=("gemini-2.5-pro-preview-05-06",
                       "gemini-2.5-pro-preview-03-25")),
    ModelPrice("google", "gemini-2.5-flash", 0.15, 0.6,
              aliases=("gemini-2.5-flash-preview-05-20",
                       "gemini-2.5-flash-preview-04-17")),
    ModelPrice("google", "gemini-2.0-flash", 0.1, 0.4,
              aliases=("gemini-2.0-flash-001",)),
    ModelPrice("google", "gemini-2.0-flash-lite", 0.075, 0.3),
    ModelPrice("google", "gemini-1.5-pro", 1.25, 5.0,
              aliases=("gemini-1.5-pro-002", "gemini-1.5-pro-001")),
    ModelPrice("google", "gemini-1.5-flash", 0.075, 0.3,
              aliases=("gemini-1.5-flash-002", "gemini-1.5-flash-001")),

    # ── DeepSeek ──────────────────────────────────────────────────────
    ModelPrice("deepseek", "deepseek-v4-flash", 0.14, 0.28,
              cache_read=0.0028,
              aliases=("deepseek-v4-flash-250417",
                       "custom:api.deepseek.com/deepseek-v4-flash")),
    ModelPrice("deepseek", "deepseek-v4-pro", 0.435, 0.87,
              cache_read=0.0087,
              aliases=("deepseek-v4-pro-250417",)),
    ModelPrice("deepseek", "deepseek-chat", 0.27, 1.10,
              cache_read=0.07,
              aliases=("deepseek-v3", "deepseek-v3-250324")),
    ModelPrice("deepseek", "deepseek-reasoner", 0.55, 2.19,
              cache_read=0.14,
              aliases=("deepseek-r1", "deepseek-r1-250528")),

    # ── Mistral ───────────────────────────────────────────────────────
    ModelPrice("mistral", "mistral-large-latest", 2.0, 6.0,
              aliases=("mistral-large", "mistral-large-2411")),
    ModelPrice("mistral", "mistral-medium-latest", 0.4, 2.0,
              aliases=("mistral-medium",)),
    ModelPrice("mistral", "mistral-small-latest", 0.1, 0.3,
              aliases=("mistral-small", "mistral-small-2503")),
    ModelPrice("mistral", "codestral-latest", 0.3, 0.9,
              aliases=("codestral", "codestral-2501")),
    ModelPrice("mistral", "pixtral-large-latest", 2.0, 6.0,
              aliases=("pixtral-large",)),

    # ── Meta Llama (via Groq / Together / etc.) ───────────────────────
    ModelPrice("meta", "llama-4-scout", 0.11, 0.34,
              aliases=("meta-llama/llama-4-scout-17b-16e-instruct",
                       "llama-4-scout-17b")),
    ModelPrice("meta", "llama-4-maverick", 0.27, 0.85,
              aliases=("meta-llama/llama-4-maverick-17b-128e-instruct",
                       "llama-4-maverick-17b")),
    ModelPrice("meta", "llama-3.3-70b", 0.59, 0.79,
              aliases=("meta-llama/llama-3.3-70b-instruct",
                       "llama-3.3-70b-versatile",
                       "llama-3.3-70b-instruct")),
    ModelPrice("meta", "llama-3.1-405b", 3.0, 3.0,
              aliases=("meta-llama/llama-3.1-405b-instruct",
                       "llama-3.1-405b-instruct")),
    ModelPrice("meta", "llama-3.1-70b", 0.59, 0.79,
              aliases=("meta-llama/llama-3.1-70b-instruct",
                       "llama-3.1-70b-versatile")),
    ModelPrice("meta", "llama-3.1-8b", 0.05, 0.08,
              aliases=("meta-llama/llama-3.1-8b-instruct",
                       "llama-3.1-8b-instant")),

    # ── Qwen ──────────────────────────────────────────────────────────
    ModelPrice("qwen", "qwen-max", 1.6, 6.4,
              aliases=("qwen-max-latest",)),
    ModelPrice("qwen", "qwen-plus", 0.8, 2.0,
              aliases=("qwen-plus-latest",)),
    ModelPrice("qwen", "qwen-turbo", 0.3, 0.6,
              aliases=("qwen-turbo-latest",)),
    ModelPrice("qwen", "qwen2.5-72b-instruct", 0.9, 0.9,
              aliases=("qwen-2.5-72b",)),
    ModelPrice("qwen", "qwen2.5-coder-32b-instruct", 0.9, 0.9,
              aliases=("qwen-2.5-coder-32b",)),

    # ── Groq-hosted (explicit Groq pricing) ───────────────────────────
    ModelPrice("groq", "llama-3.3-70b-versatile", 0.59, 0.79),
    ModelPrice("groq", "llama-3.1-8b-instant", 0.05, 0.08),
    ModelPrice("groq", "llama-4-scout-17b-16e-instruct", 0.11, 0.34),
    ModelPrice("groq", "gemma2-9b-it", 0.20, 0.20),
    ModelPrice("groq", "mixtral-8x7b-32768", 0.24, 0.24),

    # ── xAI Grok ──────────────────────────────────────────────────────
    ModelPrice("xai", "grok-3", 3.0, 15.0,
              aliases=("grok-3-latest",)),
    ModelPrice("xai", "grok-3-mini", 0.3, 0.5,
              aliases=("grok-3-mini-latest",)),
    ModelPrice("xai", "grok-2", 2.0, 10.0,
              aliases=("grok-2-latest", "grok-2-1212")),

    # ── Cohere ────────────────────────────────────────────────────────
    ModelPrice("cohere", "command-r-plus", 2.5, 10.0,
              aliases=("command-r-plus-08-2024",)),
    ModelPrice("cohere", "command-r", 0.15, 0.6,
              aliases=("command-r-08-2024",)),
]

# ── Lookup index (built once at import time) ──────────────────────────

_NORM_RE = re.compile(r"[^a-z0-9./:-]")


def _norm(value: str) -> str:
    return _NORM_RE.sub("", value.strip().lower())


_BY_EXACT: dict[str, ModelPrice] = {}
_BY_BARE: dict[str, list[ModelPrice]] = {}

for _mp in _BUILTIN_PRICES:
    all_names = [_mp.model, *_mp.aliases]
    for name in all_names:
        key = _norm(name)
        if key:
            _BY_EXACT[key] = _mp
        bare = key.split("/")[-1] if "/" in key else key
        if bare:
            _BY_BARE.setdefault(bare, []).append(_mp)


def lookup_price(
    provider: str | None,
    model_id: str | None,
) -> dict[str, float] | None:
    """Look up a model's pricing (per 1M tokens).

    Returns ``{"input": ..., "output": ..., "cacheRead": ..., "cacheWrite": ...}``
    or ``None`` if no match is found.

    Matching strategy (first hit wins):
      1. Exact ``provider/model`` key
      2. Exact ``model`` key (ignoring provider)
      3. ``provider/bare_model`` where ``bare_model`` strips the ``org/`` prefix
      4. Bare model name only
      5. Prefix match (model_id starts with a known key)
    """
    if not model_id:
        return None

    model_key = _norm(model_id)
    provider_key = _norm(provider or "")

    # 1. provider/model exact
    if provider_key:
        composite = f"{provider_key}/{model_key}"
        hit = _BY_EXACT.get(composite)
        if hit:
            return _to_cost_dict(hit)

    # 2. model exact
    hit = _BY_EXACT.get(model_key)
    if hit:
        return _to_cost_dict(hit)

    # 3. bare model (strip org/ prefix) with provider hint
    bare = model_key.split("/")[-1] if "/" in model_key else model_key
    if provider_key and bare:
        candidates = _BY_BARE.get(bare, [])
        for c in candidates:
            if _norm(c.provider) == provider_key:
                return _to_cost_dict(c)

    # 4. bare model only
    candidates = _BY_BARE.get(bare, [])
    if candidates:
        return _to_cost_dict(candidates[0])

    # 5. prefix match (e.g. "gpt-4o-2024-11-20" matches "gpt-4o")
    for known_key, mp in _BY_EXACT.items():
        if model_key.startswith(known_key) and len(known_key) > 3:
            return _to_cost_dict(mp)

    return None


def _to_cost_dict(mp: ModelPrice) -> dict[str, float]:
    return {
        "input": mp.input,
        "output": mp.output,
        "cacheRead": mp.cache_read,
        "cacheWrite": mp.cache_write,
    }


def get_builtin_catalog() -> dict[str, Any]:
    """Return the full catalog in the same shape as ``_build_price_catalog``.

    This allows ``stats.py`` to merge the built-in prices with any
    user-provided OpenClaw config, giving priority to user config.
    """
    by_provider_model: dict[tuple[str, str], dict[str, float]] = {}
    by_model: dict[str, list[dict[str, float]]] = {}

    for mp in _BUILTIN_PRICES:
        cost = _to_cost_dict(mp)
        pkey = _norm(mp.provider)
        mkey = _norm(mp.model)
        by_provider_model[(pkey, mkey)] = cost
        by_model.setdefault(mkey, []).append(cost)

        for alias in mp.aliases:
            akey = _norm(alias)
            by_provider_model[(pkey, akey)] = cost
            by_model.setdefault(akey, []).append(cost)
            if "/" in akey:
                _, bare = akey.split("/", 1)
                by_provider_model[(pkey, bare)] = cost
                by_model.setdefault(bare, []).append(cost)

    return {"by_provider_model": by_provider_model, "by_model": by_model}
