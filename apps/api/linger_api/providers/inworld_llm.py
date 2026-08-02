from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Sequence
from typing import Any, Literal

import httpx

from ..config import Settings
from .base import LLMChunk, ProviderError, ProviderHealth, ProviderUnavailableError, StreamingLLMProvider


class InworldLLMProvider(StreamingLLMProvider):
    """Streaming adapter for Inworld's OpenAI-compatible Chat Completions API."""

    name = "inworld"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._active_response: httpx.Response | None = None
        headers = (
            {"Authorization": f"Basic {settings.inworld_api_key}"}
            if settings.inworld_api_key
            else {}
        )
        timeout = httpx.Timeout(
            settings.inworld_llm_request_timeout_seconds,
            connect=settings.inworld_llm_connect_timeout_seconds,
        )
        self.client = httpx.AsyncClient(
            base_url=settings.inworld_llm_base_url.rstrip("/") + "/",
            headers=headers,
            timeout=timeout,
        )

    async def health(self) -> ProviderHealth:
        checks: dict[str, Literal["pass", "fail", "skipped", "unavailable"]] = {
            "credentials": "pass" if self.settings.inworld_api_key else "fail",
            "model": "pass" if self.settings.inworld_llm_model else "fail",
            "stream": "skipped",
        }
        ready = bool(self.settings.inworld_api_key and self.settings.inworld_llm_model)
        return ProviderHealth(
            ready,
            self.name,
            "Inworld reply generation is configured; the live stream starts with the first turn."
            if ready
            else "INWORLD_API_KEY and INWORLD_LLM_MODEL are required.",
            checks,
        )

    async def _stream(
        self,
        messages: Sequence[dict[str, str]],
        *,
        turn_id: int,
        cancellation: asyncio.Event,
    ) -> AsyncIterator[LLMChunk]:
        if not self.settings.inworld_api_key:
            raise ProviderUnavailableError(
                "inworld_credentials_missing",
                "INWORLD_API_KEY is required for Inworld reply generation.",
            )
        if not self.settings.inworld_llm_model:
            raise ProviderUnavailableError(
                "inworld_model_missing",
                "INWORLD_LLM_MODEL is required for Inworld reply generation.",
            )

        payload: dict[str, Any] = {
            "model": self.settings.inworld_llm_model,
            "messages": [dict(message) for message in messages],
            "stream": True,
        }
        sequence = 0
        try:
            async with asyncio.timeout(self.settings.inworld_llm_total_timeout_seconds):
                async with self.client.stream("POST", "chat/completions", json=payload) as response:
                    self._active_response = response
                    if response.status_code >= 400:
                        await response.aread()
                        raise ProviderError(
                            "inworld_llm_rejected",
                            f"Inworld reply generation returned HTTP {response.status_code}.",
                            recoverable=response.status_code >= 500 or response.status_code == 429,
                        )
                    async for line in response.aiter_lines():
                        if cancellation.is_set():
                            break
                        if not line.startswith("data:"):
                            continue
                        data = line.removeprefix("data:").strip()
                        if not data or data == "[DONE]":
                            if data == "[DONE]":
                                break
                            continue
                        try:
                            event = json.loads(data)
                        except json.JSONDecodeError as exc:
                            raise ProviderError(
                                "inworld_llm_malformed_event",
                                "Inworld returned a malformed reply stream event.",
                            ) from exc
                        if not isinstance(event, dict):
                            continue
                        error = event.get("error")
                        if error:
                            raise ProviderError(
                                "inworld_llm_provider_error",
                                "Inworld rejected reply generation.",
                            )
                        usage = event.get("usage")
                        generated_tokens = (
                            usage.get("completion_tokens")
                            if isinstance(usage, dict)
                            and isinstance(usage.get("completion_tokens"), int)
                            else None
                        )
                        choices = event.get("choices")
                        choice = choices[0] if isinstance(choices, list) and choices else None
                        delta = choice.get("delta") if isinstance(choice, dict) else None
                        text = delta.get("content") if isinstance(delta, dict) else ""
                        finish_reason = choice.get("finish_reason") if isinstance(choice, dict) else None
                        if not isinstance(text, str):
                            text = ""
                        if not isinstance(finish_reason, str):
                            finish_reason = None
                        if text or finish_reason or generated_tokens is not None:
                            yield LLMChunk(text, sequence, finish_reason, generated_tokens)
                            sequence += 1
        except TimeoutError as exc:
            raise ProviderError(
                "inworld_llm_timeout", "Inworld reply generation timed out.", recoverable=True
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(
                "inworld_llm_connection_failed",
                "Could not connect to Inworld reply generation.",
                recoverable=True,
            ) from exc
        finally:
            self._active_response = None

    def stream(
        self,
        messages: Sequence[dict[str, str]],
        *,
        turn_id: int,
        cancellation: asyncio.Event,
    ) -> AsyncIterator[LLMChunk]:
        return self._stream(messages, turn_id=turn_id, cancellation=cancellation)

    async def cancel(self) -> None:
        if self._active_response is not None:
            await self._active_response.aclose()
        self._active_response = None

    async def close(self) -> None:
        await self.cancel()
        await self.client.aclose()
