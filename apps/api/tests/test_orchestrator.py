from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

import pytest
from linger_api.config import Settings
from linger_api.models import ConversationSession
from linger_api.protocol import AudioAppendMessage, PlaybackAckMessage, ProtocolViolation, TurnGuard
from linger_api.providers.base import ProviderError
from linger_api.providers.mock import MockLLMProvider, MockSTTProvider, MockTTSProvider
from linger_api.seed import DEMO_USER_ID, seed_demo_data
from linger_api.services.orchestrator import (
    URGENT_SAFETY_RESPONSE,
    DeliverySegment,
    SessionRegistry,
    VoiceSessionOrchestrator,
    is_urgent_safety_intent,
)
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


def make_orchestrator(
    session_factory: async_sessionmaker[AsyncSession],
) -> VoiceSessionOrchestrator:
    return VoiceSessionOrchestrator(
        settings=Settings(app_environment="test"),
        stt=MockSTTProvider(delay_seconds=0),
        llm=MockLLMProvider(delay_seconds=0),
        tts=MockTTSProvider(delay_seconds=0),
        session_factory=session_factory,
        registry=SessionRegistry(2),
    )


def audio_message(session_id: uuid.UUID, *, sequence: int) -> AudioAppendMessage:
    return AudioAppendMessage(
        type="audio.append",
        protocol_version="1.0",
        session_id=session_id,
        turn_id=0,
        sequence=sequence,
        timestamp=datetime.now(UTC),
        correlation_id="stt-recovery-test",
        payload={
            "byte_length": 2,
            "audio_format": {
                "encoding": "pcm_s16le",
                "sample_rate_hz": 16_000,
                "channels": 1,
                "content_type": "audio/L16",
            },
        },
    )


class FlakySTTProvider(MockSTTProvider):
    def __init__(self) -> None:
        super().__init__(delay_seconds=0)
        self.connected = True
        self.append_attempts = 0
        self.commit_attempts = 0

    async def append_audio(self, data: bytes, *, turn_id: int) -> None:
        self.append_attempts += 1
        if self.append_attempts == 1:
            raise ProviderError("stt_disconnected", "temporary append failure", recoverable=True)
        await super().append_audio(data, turn_id=turn_id)

    async def commit(self, *, turn_id: int) -> None:
        self.commit_attempts += 1
        if self.commit_attempts == 1:
            raise ProviderError("stt_disconnected", "temporary commit failure", recoverable=True)
        await super().commit(turn_id=turn_id)


async def test_cancellation_propagates_and_advances_turn(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    orchestrator = make_orchestrator(session_factory)
    session_id = uuid.uuid4()
    orchestrator.session_id = session_id
    orchestrator.turn_guard = TurnGuard(session_id)
    orchestrator.pipeline_task = asyncio.create_task(asyncio.sleep(60))
    await orchestrator._interrupt("manual")
    assert orchestrator.current_turn == 1
    assert orchestrator.cancel_event.is_set()
    assert orchestrator.llm.cancelled  # type: ignore[attr-defined]
    assert orchestrator.tts.cancelled  # type: ignore[attr-defined]
    event, binary = await orchestrator.outbound.get()
    assert event["type"] == "assistant.interrupted"
    assert binary is None


def test_playback_ack_is_bounded_by_known_segment_and_sequence(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    orchestrator = make_orchestrator(session_factory)
    session_id = uuid.uuid4()
    orchestrator.session_id = session_id
    orchestrator.turn_guard = TurnGuard(session_id, turn_id=1)
    orchestrator.delivery_segments["segment"] = DeliverySegment(
        turn_id=0,
        text="Delivered text.",
        emitted_sequences=[10, 11],
        final_sequence=11,
    )
    base = {
        "type": "assistant.playback.ack",
        "protocol_version": "1.0",
        "session_id": session_id,
        "turn_id": 1,
        "sequence": 4,
        "timestamp": datetime.now(UTC),
        "correlation_id": "ack-test",
    }
    ack = PlaybackAckMessage(
        **base,
        payload={"segment_id": "segment", "delivered_through_sequence": 11, "playback_ms": 100},
    )
    orchestrator._accept_playback_ack(ack)
    assert orchestrator.delivery_segments["segment"].fully_delivered
    bad = PlaybackAckMessage(
        **{**base, "sequence": 5},
        payload={"segment_id": "segment", "delivered_through_sequence": 12, "playback_ms": 100},
    )
    with pytest.raises(ProtocolViolation, match="exceeds"):
        orchestrator._accept_playback_ack(bad)


async def test_abrupt_cleanup_marks_session_disconnected_without_transcript_retention(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        await seed_demo_data(session)
        record = ConversationSession(
            user_id=DEMO_USER_ID,
            provider="mock/mock/mock",
            transcript=[{"role": "user", "text": "must be removed"}],
            recording_consent=True,
            retain_audio_consent=False,
            correlation_id="cleanup-test",
        )
        session.add(record)
        await session.commit()
        session_id = record.id
    orchestrator = make_orchestrator(session_factory)
    orchestrator.session_id = uuid.UUID(session_id)
    orchestrator.turn_guard = TurnGuard(orchestrator.session_id)
    orchestrator.started = True
    await orchestrator._cleanup()
    async with session_factory() as session:
        saved = await session.get(ConversationSession, session_id)
        assert saved is not None
        assert saved.status == "disconnected"
        assert saved.ended_at is not None
        assert saved.transcript == []


async def test_urgent_safety_response_bypasses_llm_without_false_positive(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    urgent = make_orchestrator(session_factory)
    urgent_session_id = uuid.uuid4()
    urgent.session_id = urgent_session_id
    urgent.turn_guard = TurnGuard(urgent_session_id)
    await urgent._respond_to_final("I am having a heart attack right now.", 0)
    assert urgent.llm.requests == []  # type: ignore[attr-defined]
    assert urgent.tts.synthesized == [URGENT_SAFETY_RESPONSE]  # type: ignore[attr-defined]
    emitted = []
    while not urgent.outbound.empty():
        event, _ = urgent.outbound.get_nowait()
        emitted.append(event)
    final = next(event for event in emitted if event["type"] == "assistant.text.final")
    assert final["payload"]["display_text"] == URGENT_SAFETY_RESPONSE

    ordinary = make_orchestrator(session_factory)
    ordinary_session_id = uuid.uuid4()
    ordinary.session_id = ordinary_session_id
    ordinary.turn_guard = TurnGuard(ordinary_session_id)
    ordinary_text = "I remember being afraid during the storm, but everyone was safe."
    assert not is_urgent_safety_intent(ordinary_text)
    await ordinary._respond_to_final(ordinary_text, 0)
    assert ordinary.llm.requests  # type: ignore[attr-defined]


async def test_automatic_second_turn_resets_turn_local_latency_metrics(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    orchestrator = make_orchestrator(session_factory)
    session_id = uuid.uuid4()
    orchestrator.session_id = session_id
    orchestrator.turn_guard = TurnGuard(session_id)
    orchestrator._begin_turn_metrics(0)
    first_started_at = orchestrator._commit_started_at
    orchestrator.metrics["time_to_first_partial_ms"] = 123.0
    orchestrator.metrics["time_to_final_transcript_ms"] = 456.0
    orchestrator.metrics["time_to_first_token_ms"] = 789.0
    orchestrator.turn_guard.advance()

    await orchestrator._respond_to_final("A second automatic end-of-turn memory.", 1)

    assert orchestrator._metric_turn_id == 1
    assert orchestrator._commit_started_at is not None
    assert first_started_at is not None
    assert orchestrator._commit_started_at >= first_started_at
    assert orchestrator.metrics["time_to_first_partial_ms"] is None
    assert orchestrator.metrics["time_to_final_transcript_ms"] is None
    assert orchestrator.metrics["time_to_first_token_ms"] is not None


async def test_recoverable_stt_append_and_commit_failures_do_not_end_session(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    provider = FlakySTTProvider()
    orchestrator = VoiceSessionOrchestrator(
        settings=Settings(app_environment="test"),
        stt=provider,
        llm=MockLLMProvider(delay_seconds=0),
        tts=MockTTSProvider(delay_seconds=0),
        session_factory=session_factory,
        registry=SessionRegistry(2),
    )
    session_id = uuid.uuid4()
    orchestrator.session_id = session_id
    orchestrator.turn_guard = TurnGuard(session_id)

    orchestrator.pending_audio = audio_message(session_id, sequence=0)
    await orchestrator._handle_binary(b"\x00\x00")
    assert not orchestrator.stopping
    first_error, _ = orchestrator.outbound.get_nowait()
    assert first_error["type"] == "error"
    assert first_error["payload"]["recoverable"] is True

    orchestrator.pending_audio = audio_message(session_id, sequence=1)
    await orchestrator._handle_binary(b"\x00\x00")
    assert provider.audio_bytes == 2

    await orchestrator._commit_turn()
    assert not orchestrator.stopping
    await orchestrator._commit_turn()
    assert provider.commit_attempts == 2
    await provider.close()


async def test_session_stop_never_persists_transcript_without_archive_confirmation(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        await seed_demo_data(session)
        record = ConversationSession(
            user_id=DEMO_USER_ID,
            provider="mock/mock/mock",
            transcript=[],
            recording_consent=True,
            retain_audio_consent=False,
            correlation_id="stop-consent-test",
        )
        session.add(record)
        await session.commit()
        session_id = record.id
    orchestrator = make_orchestrator(session_factory)
    orchestrator.session_id = uuid.UUID(session_id)
    orchestrator.turn_guard = TurnGuard(orchestrator.session_id)
    orchestrator.started = True
    orchestrator.transcript = [{"role": "user", "text": "do not persist", "turn_id": 0}]
    await orchestrator._stop(save_transcript=True)
    warning, _ = orchestrator.outbound.get_nowait()
    assert warning["type"] == "warning"
    assert warning["payload"]["code"] == "archive_confirmation_required"
    async with session_factory() as session:
        saved = await session.get(ConversationSession, session_id)
        assert saved is not None
        assert saved.status == "ended"
        assert saved.transcript == []
