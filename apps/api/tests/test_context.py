from __future__ import annotations

import pytest
from linger_api.services.context import truncate_conversation


def test_context_truncation_preserves_system_and_newest_turns() -> None:
    messages = [
        {"role": "system", "content": "System prompt"},
        {"role": "user", "content": "old " * 100},
        {"role": "assistant", "content": "older " * 100},
        {"role": "user", "content": "new question"},
    ]
    result = truncate_conversation(messages, max_tokens=80, reserve_response_tokens=20)
    assert result[0]["role"] == "system"
    assert result[-1]["content"] == "new question"
    assert all(message["content"] != messages[1]["content"] for message in result)


def test_context_limit_rejects_impossible_budget() -> None:
    with pytest.raises(ValueError, match="exceed"):
        truncate_conversation([], max_tokens=100, reserve_response_tokens=100)
