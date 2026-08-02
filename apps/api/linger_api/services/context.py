from __future__ import annotations

from collections.abc import Sequence


def estimate_tokens(text: str) -> int:
    # Deterministic conservative approximation for provider-neutral context budgeting.
    return max(1, (len(text) + 3) // 4)


def truncate_conversation(
    messages: Sequence[dict[str, str]],
    *,
    max_tokens: int,
    reserve_response_tokens: int = 512,
) -> list[dict[str, str]]:
    if max_tokens <= reserve_response_tokens:
        raise ValueError("context limit must exceed the reserved response budget")
    if not messages:
        return []
    system = [dict(message) for message in messages if message.get("role") == "system"]
    conversation = [dict(message) for message in messages if message.get("role") != "system"]
    budget = max_tokens - reserve_response_tokens
    selected_system: list[dict[str, str]] = []
    for message in system[:1]:
        cost = estimate_tokens(message.get("content", "")) + 4
        if cost > budget:
            raise ValueError("system prompt exceeds the configured context budget")
        selected_system.append(message)
        budget -= cost

    selected_reversed: list[dict[str, str]] = []
    for message in reversed(conversation):
        cost = estimate_tokens(message.get("content", "")) + 4
        if cost > budget:
            break
        selected_reversed.append(message)
        budget -= cost
    return selected_system + list(reversed(selected_reversed))
