"""Built-in model pricing catalog.

Prices are in USD per 1 million tokens.  OpenAI, Anthropic, Google and
the other providers covered by the ``llm-prices`` package come from its
dated, source-cited table (re-read from each provider's pricing page), so
new models and price changes arrive with a dependency bump instead of an
edit here.  ``_BUILTIN_PRICES`` keeps the rows ``llm-prices`` does not
list (older snapshots, Qwen, Meta Llama hosts, ...) and takes precedence
where both define the same id.  The catalog is used as a fallback when
``~/.openclaw/openclaw.json`` does not contain cost data
— which is always the case for Hermes and Nanobot runtimes.

To add a model ``llm-prices`` does not know, append an entry to
``_BUILTIN_PRICES``.  The ``aliases`` list lets fuzzy matching work when
the model_id stored in the DB doesn't exactly match the canonical name
(e.g. "gpt-4o" vs "gpt-4o-2024-08-06").
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import llm_prices


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
    # ── OpenAI / Anthropic / Google ───────────────────────────────────
    # Current models come from llm-prices (see ``_LLM_PRICES_ROWS``).
    # These are older ids it does not list.
    ModelPrice("openai", "gpt-4", 30.0, 60.0),
    ModelPrice("openai", "o1-mini", 3.0, 12.0,
              aliases=("o1-mini-2024-09-12",)),
    ModelPrice("openai", "o1-preview", 15.0, 60.0),
    ModelPrice("anthropic", "claude-3-7-sonnet-20250219", 3.0, 15.0,
              cache_read=0.3, cache_write=3.75,
              aliases=("claude-3.7-sonnet", "claude-3-7-sonnet")),
    ModelPrice("anthropic", "claude-3-5-sonnet-20241022", 3.0, 15.0,
              cache_read=0.3, cache_write=3.75,
              aliases=("claude-3.5-sonnet", "claude-3-5-sonnet",
                       "claude-3-5-sonnet-v2", "claude-3-5-sonnet-20240620")),
    ModelPrice("anthropic", "claude-3-haiku-20240307", 0.25, 1.25,
              aliases=("claude-3-haiku",)),
    ModelPrice("anthropic", "claude-3-opus-20240229", 15.0, 75.0,
              cache_read=1.5, cache_write=18.75,
              aliases=("claude-3-opus",)),
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

# Older ids this catalog accepted for models that llm-prices now prices.
_LEGACY_ALIASES: dict[str, tuple[str, ...]] = {
    "claude-opus-4-5": ("claude-4-5-opus", "claude-opus-4-5-20250220"),
    "claude-sonnet-4-5-20250929": ("claude-4-5-sonnet", "claude-sonnet-4-5-20250514"),
    "claude-sonnet-4-20250514": ("claude-4-sonnet",),
    "gemini-2.5-pro": ("gemini-2.5-pro-preview-05-06", "gemini-2.5-pro-preview-03-25"),
    "gemini-2.5-flash": ("gemini-2.5-flash-preview-05-20", "gemini-2.5-flash-preview-04-17"),
}


def _from_llm_prices(p: llm_prices.Price) -> ModelPrice:
    cache_write = p.cache_write.get("5m")
    if cache_write is None:
        cache_write = min(p.cache_write.values(), default=0.0)
    return ModelPrice(
        p.provider,
        p.model,
        p.input or 0.0,
        p.output or 0.0,
        cache_read=p.cache_read or 0.0,
        cache_write=cache_write,
        aliases=(*p.aliases, *_LEGACY_ALIASES.get(p.model, ())),
    )


_LLM_PRICES_ROWS: list[ModelPrice] = [
    _from_llm_prices(p) for p in llm_prices.all_prices() if p.input is not None
]

# ── Lookup index (built once at import time) ──────────────────────────

_NORM_RE = re.compile(r"[^a-z0-9./:-]")


def _norm(value: str) -> str:
    key = _NORM_RE.sub("", value.strip().lower())
    # Claude ids write versions with dashes ("claude-opus-4-7"); accept "4.7" too.
    return key.replace(".", "-") if "claude" in key else key


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

# llm-prices rows never shadow a local entry.
for _mp in _LLM_PRICES_ROWS:
    for name in (_mp.model, *_mp.aliases):
        key = _norm(name)
        if not key or key in _BY_EXACT:
            continue
        _BY_EXACT[key] = _mp
        bare = key.split("/")[-1] if "/" in key else key
        _BY_BARE.setdefault(bare, []).append(_mp)

# Longest key first, so "gpt-4o-..." prefers "gpt-4o" over "gpt-4".
_PREFIX_KEYS = sorted(_BY_EXACT, key=len, reverse=True)


def _llm_prices_lookup(provider: str | None, model_id: str) -> ModelPrice | None:
    for candidate in dict.fromkeys((model_id.strip(), _norm(model_id))):
        hit = llm_prices.lookup_provider(provider, candidate) if provider else None
        hit = hit or llm_prices.lookup(candidate)
        if hit is not None and hit.input is not None:
            return _from_llm_prices(hit)
    return None


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
      5. llm-prices id resolution (dated snapshots, ``-latest``, Bedrock,
         Vertex and OpenRouter ids)
      6. Prefix match (model_id starts with a known key, longest first)
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

    # 5. llm-prices (e.g. "claude-sonnet-4-6-20260101" matches "claude-sonnet-4-6")
    hit = _llm_prices_lookup(provider, model_id)
    if hit:
        return _to_cost_dict(hit)

    # 6. prefix match (e.g. "gpt-4o-mini-tts" matches "gpt-4o-mini")
    for known_key in _PREFIX_KEYS:
        if model_key.startswith(known_key) and len(known_key) > 3:
            return _to_cost_dict(_BY_EXACT[known_key])

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

    local_models: set[str] = set()

    def add(pkey: str, mkey: str, cost: dict[str, float], local: bool) -> None:
        # Local rows win; llm-prices rows only fill ids the local table lacks.
        if local or (pkey, mkey) not in by_provider_model:
            by_provider_model[(pkey, mkey)] = cost
        if local:
            local_models.add(mkey)
        if local or mkey not in local_models:
            by_model.setdefault(mkey, []).append(cost)

    for local, rows in ((True, _BUILTIN_PRICES), (False, _LLM_PRICES_ROWS)):
        for mp in rows:
            cost = _to_cost_dict(mp)
            pkey = _norm(mp.provider)
            add(pkey, _norm(mp.model), cost, local)

            for alias in mp.aliases:
                akey = _norm(alias)
                add(pkey, akey, cost, local)
                if "/" in akey:
                    _, bare = akey.split("/", 1)
                    add(pkey, bare, cost, local)

    return {"by_provider_model": by_provider_model, "by_model": by_model}
