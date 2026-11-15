import llm_prices

from xsafeclaw.api.routes.stats import _build_price_catalog, _resolve_cost_config
from xsafeclaw.runtime.pricing import lookup_price


def test_current_opus_uses_current_price():
    # The old built-in rows billed Opus 4.6/4.7 at the Opus 4.1 rate ($15/$75).
    expected = llm_prices.lookup("claude-opus-4-7")
    for model_id in ("claude-opus-4-7", "claude-opus-4.7", "anthropic/claude-opus-4.6"):
        cost = lookup_price("anthropic", model_id)
        assert cost is not None
        assert cost["input"] == expected.input < 15.0
        assert cost["output"] == expected.output < 75.0
        assert cost["cacheRead"] == expected.cache_read
        assert cost["cacheWrite"] == expected.cache_write["5m"]


def test_new_models_have_a_fallback_price():
    for provider, model_id in (
        ("openai", "gpt-5"),
        ("openai-codex", "gpt-5.2"),
        ("google", "gemini-3-flash-preview"),
        (None, "claude-sonnet-4-5-20250929"),
    ):
        cost = lookup_price(provider, model_id)
        assert cost is not None, model_id
        assert cost["input"] > 0 and cost["output"] > 0


def test_dated_snapshot_resolves_to_base_model():
    assert lookup_price(None, "gpt-4o-2024-11-20") == lookup_price(None, "gpt-4o")
    dated = lookup_price(None, "claude-sonnet-4-6-20260101")
    assert dated == lookup_price(None, "claude-sonnet-4-6")


def test_local_rows_still_take_precedence():
    assert lookup_price("openai", "gpt-4")["input"] == 30.0
    assert lookup_price("deepseek", "deepseek-v4-flash")["input"] == 0.14
    assert lookup_price(None, "qwen-max")["input"] == 1.6
    assert lookup_price(None, "not-a-real-model") is None


def test_dashboard_catalog_uses_llm_prices():
    catalog = _build_price_catalog({})
    cfg = _resolve_cost_config(catalog, "anthropic", "claude-opus-4-7")
    assert cfg["input"] == llm_prices.lookup("claude-opus-4-7").input
    cfg = _resolve_cost_config(catalog, "openai", "gpt-5")
    assert cfg["input"] > 0
