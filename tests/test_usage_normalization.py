from xsafeclaw.runtime.usage import estimate_tokens_from_text, normalize_usage


def test_normalize_usage_openclaw_shape():
    usage = normalize_usage(
        {
            "input": 120,
            "output": 80,
            "totalTokens": 220,
            "cacheRead": 20,
            "cacheWrite": 0,
        }
    )
    assert usage == {
        "input_tokens": 120,
        "output_tokens": 80,
        "cache_read_tokens": 20,
        "cache_write_tokens": 0,
        "total_tokens": 220,
    }


def test_normalize_usage_openai_shape():
    usage = normalize_usage(
        {
            "prompt_tokens": 50,
            "completion_tokens": 30,
            "total_tokens": 80,
        }
    )
    assert usage["input_tokens"] == 50
    assert usage["output_tokens"] == 30
    assert usage["total_tokens"] == 80


def test_normalize_usage_synthesizes_total():
    usage = normalize_usage(
        {
            "input_tokens": 40,
            "output_tokens": 10,
            "cached_tokens": 5,
        }
    )
    assert usage["cache_read_tokens"] == 5
    assert usage["total_tokens"] == 55


def test_estimate_tokens_from_text():
    assert estimate_tokens_from_text("") == 0
    assert estimate_tokens_from_text("abcd") == 1
    assert estimate_tokens_from_text("abcdefghij") == 3
