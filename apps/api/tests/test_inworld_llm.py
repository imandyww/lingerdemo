from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
from linger_api.config import Settings
from linger_api.providers.inworld_llm import InworldLLMProvider


async def test_inworld_llm_streams_chat_completion_with_basic_auth() -> None:
    settings = Settings(
        app_environment="test",
        llm_provider="inworld",
        inworld_api_key="base64-credential",
        inworld_llm_base_url="https://inworld.example.test/v1",
        inworld_llm_model="auto",
    )
    captured: dict[str, Any] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["authorization"] = request.headers.get("authorization")
        captured["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            headers={"Content-Type": "text/event-stream"},
            content=(
                'data: {"choices":[{"delta":{"content":"Inworld "},"finish_reason":null}]}\n\n'
                'data: {"choices":[{"delta":{"content":"responded."},"finish_reason":"stop"}]}\n\n'
                "data: [DONE]\n\n"
            ),
        )

    provider = InworldLLMProvider(settings)
    await provider.client.aclose()
    provider.client = httpx.AsyncClient(
        base_url="https://inworld.example.test/v1/",
        headers={"Authorization": "Basic base64-credential"},
        transport=httpx.MockTransport(handler),
    )
    chunks = [
        chunk
        async for chunk in provider.stream(
            [{"role": "user", "content": "Hello"}],
            turn_id=0,
            cancellation=asyncio.Event(),
        )
    ]

    assert "".join(chunk.text for chunk in chunks) == "Inworld responded."
    assert chunks[-1].finish_reason == "stop"
    assert captured["authorization"] == "Basic base64-credential"
    assert captured["payload"] == {
        "model": "auto",
        "messages": [{"role": "user", "content": "Hello"}],
        "stream": True,
    }
    await provider.close()


async def test_inworld_llm_health_requires_credentials() -> None:
    provider = InworldLLMProvider(Settings(app_environment="test", inworld_api_key=None))
    health = await provider.health()
    assert not health.ready
    assert health.checks["credentials"] == "fail"
    await provider.close()
