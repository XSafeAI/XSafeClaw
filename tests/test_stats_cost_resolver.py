from xsafeclaw.api.routes.stats import _build_price_catalog, _compute_cost, _resolve_cost_config


def test_resolve_cost_prefers_provider_and_model_pair():
    catalog = _build_price_catalog(
        {
            "models": {
                "providers": {
                    "deepseek": {
                        "models": [
                            {"id": "deepseek-chat", "cost": {"input": 1.0, "output": 2.0}},
                        ]
                    }
                }
            }
        }
    )

    cfg = _resolve_cost_config(catalog, "deepseek", "deepseek-chat")
    assert cfg == {"input": 1.0, "output": 2.0}


def test_resolve_cost_unique_model_fallback():
    catalog = _build_price_catalog(
        {
            "models": {
                "providers": {
                    "deepseek": {
                        "models": [
                            {"id": "deepseek/deepseek-v4", "cost": {"input": 0.5, "output": 1.5}},
                        ]
                    }
                }
            }
        }
    )

    cfg = _resolve_cost_config(catalog, "unknown", "deepseek-v4")
    assert cfg == {"input": 0.5, "output": 1.5}


def test_compute_cost_includes_cache_dimensions():
    cost = _compute_cost(
        {
            "input": 1000,
            "output": 2000,
            "cacheRead": 3000,
            "cacheWrite": 4000,
        },
        {
            "input": 1.0,
            "output": 2.0,
            "cacheRead": 0.1,
            "cacheWrite": 0.2,
        },
    )
    assert round(cost, 6) == round((1000 * 1.0 + 2000 * 2.0 + 3000 * 0.1 + 4000 * 0.2) / 1_000_000, 6)
