from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Sequence
from time import monotonic
from typing import Any, Literal, cast

import httpx
from openai import AsyncOpenAI, AsyncStream
from openai.types.chat import ChatCompletionChunk, ChatCompletionStreamOptionsParam

from ..config import Settings
from .base import LLMChunk, ProviderHealth, ProviderUnavailableError, StreamingLLMProvider


class TenstorrentLLMProvider(StreamingLLMProvider):
    """OpenAI-compatible chat-completions adapter for an operator-managed Tenstorrent server."""

    name = "tenstorrent"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._active_stream: Any | None = None
        timeout = httpx.Timeout(
            settings.tenstorrent_request_timeout_seconds,
            connect=settings.tenstorrent_connect_timeout_seconds,
        )
        # The SDK requires a non-empty value. This placeholder is reachable only for explicit dev/test loopback.
        key = settings.tenstorrent_api_key or "loopback-development-only"
        self.client = AsyncOpenAI(api_key=key, base_url=settings.tenstorrent_base_url, timeout=timeout)

    def _auth_issue(self) -> str | None:
        if self.settings.tenstorrent_api_key or self.settings.tenstorrent_unauthenticated_loopback_allowed:
            return None
        return "TENSTORRENT_API_KEY is required for non-loopback or non-development endpoints."

    async def health(self) -> ProviderHealth:
        checks: dict[str, Literal["pass", "fail", "skipped", "unavailable"]] = {}
        issues: list[str] = []
        auth_issue = self._auth_issue()
        if auth_issue:
            checks["authentication"] = "fail"
            return ProviderHealth(False, self.name, auth_issue, checks)
        checks["authentication"] = "pass" if self.settings.tenstorrent_api_key else "skipped"
        if not self.settings.tenstorrent_health_url:
            checks["health_endpoint"] = "unavailable"
            issues.append("TENSTORRENT_HEALTH_URL is not configured for this serving stack")
        else:
            try:
                async with httpx.AsyncClient(
                    timeout=self.settings.tenstorrent_connect_timeout_seconds
                ) as client:
                    headers = (
                        {"Authorization": f"Bearer {self.settings.tenstorrent_api_key}"}
                        if self.settings.tenstorrent_api_key
                        else None
                    )
                    response = await client.get(self.settings.tenstorrent_health_url, headers=headers)
                    response.raise_for_status()
                checks["health_endpoint"] = "pass"
            except (httpx.HTTPError, ValueError) as exc:
                checks["health_endpoint"] = "fail"
                issues.append(f"health check failed: {type(exc).__name__}")
        try:
            models = await self.client.models.list()
            identifiers = {model.id for model in models.data}
            if self.settings.tenstorrent_model in identifiers:
                checks["configured_model"] = "pass"
            else:
                checks["configured_model"] = "fail"
                issues.append("configured TENSTORRENT_MODEL was not returned by the server model list")
        except Exception as exc:  # SDK maps transport/server failures to provider-specific subclasses.
            checks["model_listing"] = "unavailable"
            issues.append(f"model listing unavailable: {type(exc).__name__}")
        ready = not issues
        return ProviderHealth(
            ready, self.name, "; ".join(issues) if issues else "Server and model are ready.", checks
        )

    async def _stream(
        self,
        messages: Sequence[dict[str, str]],
        *,
        turn_id: int,
        cancellation: asyncio.Event,
    ) -> AsyncIterator[LLMChunk]:
        if not self.settings.tenstorrent_model:
            raise ProviderUnavailableError(
                "model_not_configured", "TENSTORRENT_MODEL must be verified and configured for live mode."
            )
        auth_issue = self._auth_issue()
        if auth_issue:
            raise ProviderUnavailableError("tenstorrent_auth_required", auth_issue)
        started = monotonic()
        stream_options: ChatCompletionStreamOptionsParam = {"include_usage": True}
        stream = cast(
            AsyncStream[ChatCompletionChunk],
            await asyncio.wait_for(
                self.client.chat.completions.create(
                    model=self.settings.tenstorrent_model,
                    messages=cast(Any, list(messages)),
                    stream=True,
                    stream_options=stream_options,
                ),
                timeout=self.settings.tenstorrent_request_timeout_seconds,
            ),
        )
        self._active_stream = stream
        sequence = 0
        try:
            async with asyncio.timeout(self.settings.tenstorrent_total_timeout_seconds):
                async for chunk in stream:
                    if cancellation.is_set():
                        break
                    usage = chunk.usage
                    generated_tokens = usage.completion_tokens if usage is not None else None
                    choice = chunk.choices[0] if chunk.choices else None
                    text = choice.delta.content or "" if choice is not None else ""
                    finish_reason = choice.finish_reason if choice is not None else None
                    if text or generated_tokens is not None:
                        yield LLMChunk(text, sequence, finish_reason, generated_tokens)
                        sequence += 1
        finally:
            self._active_stream = None
            close = getattr(stream, "close", None)
            if close is not None:
                result = close()
                if hasattr(result, "__await__"):
                    await result
            _ = monotonic() - started

    def stream(
        self,
        messages: Sequence[dict[str, str]],
        *,
        turn_id: int,
        cancellation: asyncio.Event,
    ) -> AsyncIterator[LLMChunk]:
        return self._stream(messages, turn_id=turn_id, cancellation=cancellation)

    async def cancel(self) -> None:
        stream = self._active_stream
        if stream is not None:
            close = getattr(stream, "close", None)
            if close is not None:
                result = close()
                if hasattr(result, "__await__"):
                    await result
        self._active_stream = None

    async def close(self) -> None:
        await self.cancel()
        await self.client.close()
