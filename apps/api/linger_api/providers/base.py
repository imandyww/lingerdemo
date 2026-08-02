from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Literal

from ..protocol import AudioFormat
from ..schemas import ExtractedMemory, FamilyContext


class ProviderError(RuntimeError):
    def __init__(self, code: str, message: str, *, recoverable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.recoverable = recoverable


class ProviderUnavailableError(ProviderError):
    pass


@dataclass(frozen=True, slots=True)
class ProviderHealth:
    ready: bool
    provider: str
    detail: str
    checks: dict[str, Literal["pass", "fail", "skipped", "unavailable"]] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class TranscriptChunk:
    text: str = ""
    is_final: bool = False
    confidence: float | None = None
    provider_sequence: int = 0
    turn_id: int = 0
    signal: Literal["transcript", "speech_started", "speech_stopped"] = "transcript"


@dataclass(frozen=True, slots=True)
class LLMChunk:
    text: str
    provider_sequence: int
    finish_reason: str | None = None
    generated_tokens: int | None = None


@dataclass(frozen=True, slots=True)
class AudioChunk:
    data: bytes
    audio_format: AudioFormat
    provider_sequence: int
    final_for_segment: bool = False


class StreamingSTTProvider(ABC):
    name: str

    @abstractmethod
    async def connect(self, *, language: str, audio_format: AudioFormat | None) -> None: ...

    @abstractmethod
    async def append_audio(self, data: bytes, *, turn_id: int) -> None: ...

    @abstractmethod
    async def commit(self, *, turn_id: int) -> None: ...

    @abstractmethod
    def events(self) -> AsyncIterator[TranscriptChunk]: ...

    @abstractmethod
    async def cancel(self) -> None: ...

    async def reassign_turn(self, old_turn_id: int, new_turn_id: int) -> None:
        return None

    @abstractmethod
    async def close(self) -> None: ...

    @abstractmethod
    async def health(self) -> ProviderHealth: ...


class StreamingLLMProvider(ABC):
    name: str

    @abstractmethod
    def stream(
        self,
        messages: Sequence[dict[str, str]],
        *,
        turn_id: int,
        cancellation: asyncio.Event,
    ) -> AsyncIterator[LLMChunk]: ...

    @abstractmethod
    async def health(self) -> ProviderHealth: ...

    async def cancel(self) -> None:
        return None

    async def close(self) -> None:
        return None


class StreamingTTSProvider(ABC):
    name: str

    @abstractmethod
    def synthesize(
        self,
        text: str,
        *,
        segment_id: str,
        turn_id: int,
        cancellation: asyncio.Event,
    ) -> AsyncIterator[AudioChunk]: ...

    @abstractmethod
    async def health(self) -> ProviderHealth: ...

    async def cancel(self) -> None:
        return None

    async def close(self) -> None:
        return None


class MemoryExtractionProvider(ABC):
    name: str

    @abstractmethod
    async def extract(self, transcript: str, context: FamilyContext) -> ExtractedMemory: ...


class UnavailableStreamingSTT(StreamingSTTProvider):
    def __init__(self, name: str, detail: str) -> None:
        self.name = name
        self.detail = detail

    async def connect(self, *, language: str, audio_format: AudioFormat | None) -> None:
        raise ProviderUnavailableError("provider_unavailable", self.detail)

    async def append_audio(self, data: bytes, *, turn_id: int) -> None:
        raise ProviderUnavailableError("provider_unavailable", self.detail)

    async def commit(self, *, turn_id: int) -> None:
        raise ProviderUnavailableError("provider_unavailable", self.detail)

    async def _events(self) -> AsyncIterator[TranscriptChunk]:
        raise ProviderUnavailableError("provider_unavailable", self.detail)
        yield  # pragma: no cover

    def events(self) -> AsyncIterator[TranscriptChunk]:
        return self._events()

    async def cancel(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def health(self) -> ProviderHealth:
        return ProviderHealth(False, self.name, self.detail, {self.name: "unavailable"})


class UnavailableStreamingTTS(StreamingTTSProvider):
    def __init__(self, name: str, detail: str) -> None:
        self.name = name
        self.detail = detail

    async def _synthesize(
        self,
        text: str,
        *,
        segment_id: str,
        turn_id: int,
        cancellation: asyncio.Event,
    ) -> AsyncIterator[AudioChunk]:
        raise ProviderUnavailableError("provider_unavailable", self.detail)
        yield  # pragma: no cover

    def synthesize(
        self,
        text: str,
        *,
        segment_id: str,
        turn_id: int,
        cancellation: asyncio.Event,
    ) -> AsyncIterator[AudioChunk]:
        return self._synthesize(text, segment_id=segment_id, turn_id=turn_id, cancellation=cancellation)

    async def health(self) -> ProviderHealth:
        return ProviderHealth(False, self.name, self.detail, {self.name: "unavailable"})
