from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import httpx
from linger_api.config import Settings
from linger_api.providers.mock import MockSTTProvider, MockTTSProvider
from linger_api.providers.tenstorrent import TenstorrentLLMProvider
from linger_api.services.orchestrator import SessionRegistry, VoiceSessionOrchestrator
from openai.types.chat import ChatCompletionChunk
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


class FakeChatStream:
    def __init__(self, chunks: list[ChatCompletionChunk]) -> None:
        self._chunks = iter(chunks)
        self.closed = False

    def __aiter__(self) -> FakeChatStream:
        return self

    async def __anext__(self) -> ChatCompletionChunk:
        try:
            return next(self._chunks)
        except StopIteration as exc:
            raise StopAsyncIteration from exc

    async def close(self) -> None:
        self.closed = True


def completion_chunk(
    *, text: str | None = None, finish_reason: str | None = None, completion_tokens: int | None = None
) -> ChatCompletionChunk:
    choices: list[dict[str, Any]] = []
    if text is not None or finish_reason is not None:
        choices.append(
            {
                "index": 0,
                "delta": {"content": text},
                "finish_reason": finish_reason,
            }
        )
    payload: dict[str, Any] = {
        "id": "chatcmpl-test",
        "created": 1,
        "model": "test-model",
        "object": "chat.completion.chunk",
        "choices": choices,
    }
    if completion_tokens is not None:
        payload["usage"] = {
            "prompt_tokens": 8,
            "completion_tokens": completion_tokens,
            "total_tokens": 8 + completion_tokens,
        }
    return ChatCompletionChunk.model_validate(payload)


async def test_usage_stream_is_requested_and_drives_generation_metrics(
    session_factory: async_sessionmaker[AsyncSession], monkeypatch: Any
) -> None:
    settings = Settings(
        app_environment="test",
        llm_provider="tenstorrent",
        tenstorrent_base_url="http://127.0.0.1:8000/v1",
        tenstorrent_model="test-model",
    )
    provider = TenstorrentLLMProvider(settings)
    fake_stream = FakeChatStream(
        [
            completion_chunk(text="Who "),
            completion_chunk(text="was there?", finish_reason="stop"),
            completion_chunk(completion_tokens=4),
        ]
    )
    captured: dict[str, Any] = {}

    async def fake_create(**kwargs: Any) -> FakeChatStream:
        captured.update(kwargs)
        return fake_stream

    monkeypatch.setattr(provider.client.chat.completions, "create", fake_create)
    orchestrator = VoiceSessionOrchestrator(
        settings=settings,
        stt=MockSTTProvider(delay_seconds=0),
        llm=provider,
        tts=MockTTSProvider(delay_seconds=0),
        session_factory=session_factory,
        registry=SessionRegistry(2),
    )
    session_id = uuid.uuid4()
    orchestrator.session_id = session_id
    from linger_api.protocol import TurnGuard

    orchestrator.turn_guard = TurnGuard(session_id)
    await orchestrator._respond_to_final("A normal memory.", 0)

    assert captured["stream"] is True
    assert captured["stream_options"] == {"include_usage": True}
    assert orchestrator.metrics["generated_tokens"] == 4
    assert float(orchestrator.metrics["generation_duration_ms"] or 0) > 0
    assert float(orchestrator.metrics["tokens_per_second"] or 0) > 0
    assert orchestrator.metrics["queue_time_ms"] is None
    assert fake_stream.closed
    await provider.close()


def test_tenstorrent_key_is_optional_only_for_dev_test_loopback() -> None:
    local = Settings(
        app_environment="development",
        llm_provider="tenstorrent",
        tenstorrent_base_url="http://localhost:8000/v1",
        tenstorrent_health_url="http://127.0.0.1:8000/health",
    )
    assert local.tenstorrent_unauthenticated_loopback_allowed
    assert not any("TENSTORRENT_API_KEY" in issue for issue in local.readiness_issues())

    remote = Settings(
        app_environment="development",
        llm_provider="tenstorrent",
        tenstorrent_base_url="https://tt.example.test/v1",
        tenstorrent_health_url="https://tt.example.test/health",
    )
    assert not remote.tenstorrent_unauthenticated_loopback_allowed
    assert any("TENSTORRENT_API_KEY" in issue for issue in remote.readiness_issues())

    production_loopback = Settings(
        app_environment="production",
        llm_provider="tenstorrent",
        tenstorrent_base_url="http://127.0.0.1:8000/v1",
        tenstorrent_health_url="http://127.0.0.1:8000/health",
    )
    assert any("TENSTORRENT_API_KEY" in issue for issue in production_loopback.readiness_issues())


async def test_tenstorrent_health_uses_bearer_auth_when_configured(monkeypatch: Any) -> None:
    settings = Settings(
        app_environment="test",
        llm_provider="tenstorrent",
        tenstorrent_base_url="https://tt.example.test/v1",
        tenstorrent_health_url="https://tt.example.test/health",
        tenstorrent_api_key="test-secret-key",
        tenstorrent_model="test-model",
    )
    provider = TenstorrentLLMProvider(settings)
    captured_headers: dict[str, str] | None = None

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

    async def fake_get(
        _client: httpx.AsyncClient, _url: str, *, headers: dict[str, str] | None = None
    ) -> FakeResponse:
        nonlocal captured_headers
        captured_headers = headers
        return FakeResponse()

    async def fake_models_list() -> SimpleNamespace:
        return SimpleNamespace(data=[SimpleNamespace(id="test-model")])

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    monkeypatch.setattr(provider.client.models, "list", fake_models_list)
    health = await provider.health()
    assert health.ready
    assert captured_headers == {"Authorization": "Bearer test-secret-key"}
    await provider.close()
