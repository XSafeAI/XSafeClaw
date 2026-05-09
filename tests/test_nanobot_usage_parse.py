import json

import pytest

from xsafeclaw.runtime.nanobot import parse_nanobot_session_file


@pytest.mark.asyncio
async def test_nanobot_parser_reads_usage_when_present(tmp_path):
    file_path = tmp_path / "websocket_chat-1.jsonl"
    file_path.write_text(
        "\n".join(
            [
                json.dumps({"_type": "metadata", "key": "websocket:chat-1", "model": "provider-x/model-y"}),
                json.dumps({"role": "user", "content": "hello"}),
                json.dumps(
                    {
                        "role": "assistant",
                        "content": "world",
                        "provider": "provider-x",
                        "model": "model-y",
                        "usage": {"input_tokens": 11, "output_tokens": 7, "total_tokens": 18},
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    batch = await parse_nanobot_session_file(file_path)
    asst = next(msg for msg in batch.messages if msg.role == "assistant")
    assert asst.input_tokens == 11
    assert asst.output_tokens == 7
    assert asst.total_tokens == 18
    assert asst.provider == "provider-x"
    assert asst.model_id == "model-y"
    assert asst.raw_entry["_xsafeclaw_usage"]["source"] == "runtime_log"
    assert asst.raw_entry["_xsafeclaw_usage"]["estimated"] is False


@pytest.mark.asyncio
async def test_nanobot_parser_estimates_tokens_when_usage_missing(tmp_path):
    file_path = tmp_path / "websocket_chat-2.jsonl"
    file_path.write_text(
        "\n".join(
            [
                json.dumps({"_type": "metadata", "key": "websocket:chat-2", "provider": "nano", "model": "nano/m"}),
                json.dumps({"role": "user", "content": "abcdabcd"}),
                json.dumps({"role": "assistant", "content": "abcdefgh"}),
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    batch = await parse_nanobot_session_file(file_path)
    asst = next(msg for msg in batch.messages if msg.role == "assistant")
    # user text(8 chars)->2 tokens, assistant text(8 chars)->2 tokens
    assert asst.input_tokens == 2
    assert asst.output_tokens == 2
    assert asst.total_tokens == 4
    assert asst.raw_entry["_xsafeclaw_usage"]["source"] == "estimated"
    assert asst.raw_entry["_xsafeclaw_usage"]["estimated"] is True
