from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Sequence

from ..protocol import AudioFormat
from ..schemas import (
    ExtractedEvent,
    ExtractedMemory,
    ExtractedPerson,
    ExtractedPlace,
    FamilyContext,
    Provenance,
)
from .base import (
    AudioChunk,
    LLMChunk,
    MemoryExtractionProvider,
    ProviderHealth,
    StreamingLLMProvider,
    StreamingSTTProvider,
    StreamingTTSProvider,
    TranscriptChunk,
)

DEMO_UTTERANCES = (
    "The rain today reminds me of the day I left home.",
    "My younger brother Ming came with me to the station, but he was not allowed to board the train.",
    "Seventeen. I had one suitcase and a red scarf my mother made.",
    "No. But I still remember Ming standing there in the rain.",
)
DEMO_EXTRACTION_TRANSCRIPT = " ".join(DEMO_UTTERANCES)
DEMO_ASSISTANT_UTTERANCES = (
    "Who was with you?",
    "How old were you then?",
    "Did you ever see that station again?",
)
DEMO_FRONTEND_TRANSCRIPT = "\n\n".join(
    item
    for index, utterance in enumerate(DEMO_UTTERANCES)
    for item in (
        f"Speaker: {utterance}",
        f"Linger: {DEMO_ASSISTANT_UTTERANCES[index]}"
        if index < len(DEMO_ASSISTANT_UTTERANCES)
        else "",
    )
    if item
)


def _normalize_transcript(value: str) -> str:
    return " ".join(value.casefold().split())


class MockSTTProvider(StreamingSTTProvider):
    name = "mock"

    def __init__(self, *, delay_seconds: float = 0.01, utterances: Sequence[str] = DEMO_UTTERANCES) -> None:
        self.delay_seconds = delay_seconds
        self.utterances = tuple(utterances)
        self.audio_bytes = 0
        self.connected = False
        self.cancelled = False
        self._events: asyncio.Queue[TranscriptChunk | Exception] = asyncio.Queue(32)
        self._producer: asyncio.Task[None] | None = None

    async def connect(self, *, language: str, audio_format: AudioFormat | None) -> None:
        await asyncio.sleep(self.delay_seconds)
        self.connected = True
        self.cancelled = False

    async def append_audio(self, data: bytes, *, turn_id: int) -> None:
        if not self.connected:
            raise RuntimeError("mock STT is not connected")
        self.audio_bytes += len(data)

    async def _produce(self, *, turn_id: int) -> None:
        if not self.connected:
            raise RuntimeError("mock STT is not connected")
        self.cancelled = False
        text = self.utterances[turn_id % len(self.utterances)]
        words = text.split()
        partial_points = sorted({max(1, len(words) // 3), max(1, (len(words) * 2) // 3)})
        sequence = 0
        for count in partial_points:
            if self.cancelled:
                return
            await asyncio.sleep(self.delay_seconds)
            await self._events.put(TranscriptChunk(" ".join(words[:count]), False, 0.84, sequence, turn_id))
            sequence += 1
        if not self.cancelled:
            await asyncio.sleep(self.delay_seconds)
            await self._events.put(TranscriptChunk(text, True, 0.99, sequence, turn_id))

    async def commit(self, *, turn_id: int) -> None:
        if not self.connected:
            raise RuntimeError("mock STT is not connected")
        if self._producer and not self._producer.done():
            raise RuntimeError("mock STT is already producing a transcript")
        self._producer = asyncio.create_task(self._produce(turn_id=turn_id))

    async def _event_stream(self) -> AsyncIterator[TranscriptChunk]:
        while self.connected:
            event = await self._events.get()
            if isinstance(event, Exception):
                raise event
            yield event

    def events(self) -> AsyncIterator[TranscriptChunk]:
        return self._event_stream()

    async def cancel(self) -> None:
        self.cancelled = True
        if self._producer and not self._producer.done():
            self._producer.cancel()
            try:
                await self._producer
            except asyncio.CancelledError:
                pass
        self._producer = None

    async def close(self) -> None:
        await self.cancel()
        self.connected = False

    async def health(self) -> ProviderHealth:
        return ProviderHealth(
            True, self.name, "Credential-free deterministic mock STT is ready.", {"stt": "pass"}
        )


class MockLLMProvider(StreamingLLMProvider):
    name = "mock"

    def __init__(self, *, delay_seconds: float = 0.005) -> None:
        self.delay_seconds = delay_seconds
        self.requests: list[list[dict[str, str]]] = []
        self.cancelled = False

    @staticmethod
    def response_for(text: str) -> str:
        lowered = text.casefold()
        if "rain today" in lowered or "left home" in lowered:
            return "Who was with you?"
        if "younger brother ming" in lowered:
            return "How old were you then?"
        if "seventeen" in lowered or "red scarf" in lowered:
            return "Did you ever see that station again?"
        if "standing there in the rain" in lowered:
            return "Is this a story you would want your family to remember?"
        return "Who was with you?"

    async def _stream(
        self,
        messages: Sequence[dict[str, str]],
        *,
        turn_id: int,
        cancellation: asyncio.Event,
    ) -> AsyncIterator[LLMChunk]:
        copied = [dict(message) for message in messages]
        self.requests.append(copied)
        self.cancelled = False
        user_text = next(
            (message["content"] for message in reversed(copied) if message["role"] == "user"), ""
        )
        response = self.response_for(user_text)
        parts = response.split(" ")
        for index, part in enumerate(parts):
            if cancellation.is_set() or self.cancelled:
                return
            await asyncio.sleep(self.delay_seconds)
            suffix = " " if index < len(parts) - 1 else ""
            yield LLMChunk(part + suffix, index, "stop" if index == len(parts) - 1 else None, len(parts))

    def stream(
        self,
        messages: Sequence[dict[str, str]],
        *,
        turn_id: int,
        cancellation: asyncio.Event,
    ) -> AsyncIterator[LLMChunk]:
        return self._stream(messages, turn_id=turn_id, cancellation=cancellation)

    async def cancel(self) -> None:
        self.cancelled = True

    async def health(self) -> ProviderHealth:
        return ProviderHealth(
            True, self.name, "Credential-free deterministic mock LLM is ready.", {"llm": "pass"}
        )


class MockTTSProvider(StreamingTTSProvider):
    name = "mock"
    audio_format = AudioFormat(
        encoding="pcm_s16le", sample_rate_hz=16_000, channels=1, content_type="audio/L16"
    )

    def __init__(self, *, delay_seconds: float = 0.005, fail: bool = False) -> None:
        self.delay_seconds = delay_seconds
        self.fail = fail
        self.cancelled = False
        self.synthesized: list[str] = []

    async def _synthesize(
        self,
        text: str,
        *,
        segment_id: str,
        turn_id: int,
        cancellation: asyncio.Event,
    ) -> AsyncIterator[AudioChunk]:
        self.synthesized.append(text)
        self.cancelled = False
        if self.fail:
            raise RuntimeError("simulated TTS failure")
        # Silence is valid signed 16-bit little-endian PCM and lets the mock exercise binary framing safely.
        duration_chunks = max(1, min(4, len(text) // 24 + 1))
        for index in range(duration_chunks):
            if cancellation.is_set() or self.cancelled:
                return
            await asyncio.sleep(self.delay_seconds)
            yield AudioChunk(b"\x00\x00" * 1_600, self.audio_format, index, index == duration_chunks - 1)

    def synthesize(
        self,
        text: str,
        *,
        segment_id: str,
        turn_id: int,
        cancellation: asyncio.Event,
    ) -> AsyncIterator[AudioChunk]:
        return self._synthesize(text, segment_id=segment_id, turn_id=turn_id, cancellation=cancellation)

    async def cancel(self) -> None:
        self.cancelled = True

    async def health(self) -> ProviderHealth:
        return ProviderHealth(
            True, self.name, "Credential-free deterministic mock TTS is ready.", {"tts": "pass"}
        )


class MockMemoryExtractionProvider(MemoryExtractionProvider):
    name = "mock"

    async def extract(self, transcript: str, context: FamilyContext) -> ExtractedMemory:
        normalized = _normalize_transcript(transcript)
        valid_demo_transcripts = {
            _normalize_transcript(DEMO_EXTRACTION_TRANSCRIPT),
            _normalize_transcript(DEMO_FRONTEND_TRANSCRIPT),
        }
        if normalized not in valid_demo_transcripts:
            return ExtractedMemory(
                suggested_title="A family memory",
                summary=transcript.strip()[:500],
                people=[],
                places=[],
                events=[],
                emotional_themes=[],
                unresolved_questions=[],
                sensitivity_level="low",
                notable_quotes=[],
                provenance={},
            )

        direct = Provenance(
            kind="direct",
            sources=["transcript"],
            explanation="The speaker stated this detail.",
            confidence=0.99,
        )
        place_provenance = Provenance(
            kind="derived",
            sources=["transcript: left home", "transcript: station"],
            explanation=(
                "The station is directly mentioned; the hometown label is contextual and must be confirmed."
            ),
            confidence=0.72,
        )
        date_provenance = (
            Provenance(
                kind="derived",
                sources=[
                    "transcript: age seventeen",
                    f"family_context: primary user birth year {context.primary_user_birth_year}",
                ],
                explanation=(
                    f"{context.primary_user_birth_year} birth year plus age seventeen supports "
                    f"{context.primary_user_birth_year + 17}; this is not inferred from the transcript alone."
                ),
                confidence=0.96,
            )
            if context.primary_user_birth_year is not None
            else Provenance(
                kind="direct",
                sources=["transcript: age seventeen"],
                explanation="The age is direct, but no calendar year can be supported without stored context.",
                confidence=0.99,
            )
        )
        approximate_date = (
            str(context.primary_user_birth_year + 17) if context.primary_user_birth_year is not None else None
        )
        return ExtractedMemory(
            suggested_title="The day I left home",
            summary=(
                "At seventeen, Grandma left home by train with one suitcase and a red scarf her mother made. "
                "Her younger brother Ming accompanied her to the hometown station but could not board, and she "
                "still remembers him standing in the rain."
            ),
            people=[
                ExtractedPerson(
                    name="Ming", relationship="younger brother", confidence=0.99, provenance=direct
                ),
                ExtractedPerson(name="Mother", relationship="mother", confidence=0.96, provenance=direct),
            ],
            places=[
                ExtractedPlace(name="Hometown train station", confidence=0.72, provenance=place_provenance)
            ],
            events=[
                ExtractedEvent(
                    title="Left home by train at age seventeen",
                    description="Left home with one suitcase while Ming remained at the station.",
                    approximate_date=approximate_date,
                    confidence=0.96,
                    provenance=date_provenance,
                )
            ],
            emotional_themes=["departure", "family separation", "remembrance"],
            unresolved_questions=["What happened to Ming after that day?"],
            sensitivity_level="medium",
            notable_quotes=["I still remember Ming standing there in the rain."],
            provenance={"event_date": date_provenance, "story_details": direct},
        )
