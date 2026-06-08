from __future__ import annotations

from xsafeclaw.api.routes.chat import _clean_history_user_text


def test_clean_history_user_text_strips_openclaw_sender_metadata() -> None:
    text = """Sender (untrusted metadata):

```json
{
  "label": "XSafeClaw (gateway-client)",
  "id": "gateway-client",
  "name": "XSafeClaw",
  "username": "XSafeClaw"
}
```
[Fri 2026-06-05 11:05 GMT+8] 你好
[message_id:abc123]"""

    assert _clean_history_user_text(text) == "你好"


def test_clean_history_user_text_strips_unfenced_sender_metadata() -> None:
    text = """Sender (untrusted metadata):

{
  "label": "XSafeClaw (gateway-client)",
  "id": "gateway-client",
  "name": "XSafeClaw",
  "username": "XSafeClaw"
}

[Fri 2026-06-05 11:05 GMT+8] 你好"""

    assert _clean_history_user_text(text) == "你好"


def test_clean_history_user_text_keeps_plain_user_text() -> None:
    assert _clean_history_user_text("你好") == "你好"
    assert _clean_history_user_text("[Fri 2026-06-05 11:05 GMT+8] 你好") == "你好"
