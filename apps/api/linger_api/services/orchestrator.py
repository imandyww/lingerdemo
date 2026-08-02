from __future__ import annotations

import asyncio
import contextlib
import logging
import re
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from time import monotonic
from typing import Any, Literal

from fastapi import WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..config import Settings
from ..models import ConversationSession
from ..observability import log_session_event
from ..protocol import (
    AssistantCancelMessage,
    AudioAppendMessage,
    AudioCommitMessage,
    PlaybackAckMessage,
    ProtocolViolation,
    SequenceGuard,
    ServerEnvelope,
    SessionStartMessage,
    SessionStopMessage,
    TurnGuard,
    parse_client_message,
    validation_error_summary,
)
from ..providers.base import (
    LLMChunk,
    ProviderError,
    StreamingLLMProvider,
    StreamingSTTProvider,
    StreamingTTSProvider,
)
from ..security import SlidingWindowRateLimiter
from ..seed import DEMO_USER_ID
from .context import truncate_conversation
from .segmenter import (
    SpeechSegment,
    StreamingDisplayFilter,
    StreamingTextSegmenter,
    split_display_and_speech,
)

OutboundItem = tuple[dict[str, Any], bytes | None]
logger = logging.getLogger("linger.voice")
URGENT_SAFETY_RESPONSE = (
    "Linger isn\u2019t an emergency service. Please contact a trusted person nearby or the appropriate "
    "emergency service now."
)
URGENT_SAFETY_PATTERNS = (
    re.compile(
        r"\b(?:i|we|he|she|they|someone)\s+(?:am|is|are|'m|'s|'re)\s+"
        r"(?:having|suffering from)\s+(?:a\s+)?(?:heart attack|stroke|medical emergency)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:i|we|he|she|they|someone)\s+(?:can't|cannot|can not|isn't|is not|aren't|are not)\s+"
        r"(?:breathe|breathing)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:i\s+am|i'm|im)\s+(?:going to|about to|planning to)\s+"
        r"(?:kill|hurt|harm)\s+myself\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:need emergency help|need an ambulance|call 911|call an ambulance|in immediate danger)\b",
        re.IGNORECASE,
    ),
)
TURN_LATENCY_METRICS = (
    "time_to_first_partial_ms",
    "time_to_final_transcript_ms",
    "time_to_first_token_ms",
    "time_to_first_tts_audio_ms",
    "end_to_end_ms",
    "interrupt_cancellation_ms",
    "generation_duration_ms",
    "generated_tokens",
    "tokens_per_second",
    "queue_time_ms",
)


def is_urgent_safety_intent(text: str) -> bool:
    normalized = text.replace("\u2019", "'")
    return any(pattern.search(normalized) for pattern in URGENT_SAFETY_PATTERNS)


async def _next_llm_chunk(stream: AsyncIterator[LLMChunk]) -> LLMChunk:
    return await stream.__anext__()


@dataclass(slots=True)
class DeliverySegment:
    turn_id: int
    text: str
    emitted_sequences: list[int] = field(default_factory=list)
    final_sequence: int | None = None
    acknowledged_through: int = -1

    @property
    def fully_delivered(self) -> bool:
        return self.final_sequence is not None and self.acknowledged_through >= self.final_sequence


class SessionRegistry:
    def __init__(self, maximum: int) -> None:
        self.maximum = maximum
        self._active: set[str] = set()
        self._lock = asyncio.Lock()

    @property
    def active_count(self) -> int:
        return len(self._active)

    async def acquire(self, session_id: str) -> bool:
        async with self._lock:
            if session_id in self._active or len(self._active) >= self.maximum:
                return False
            self._active.add(session_id)
            return True

    async def release(self, session_id: str) -> None:
        async with self._lock:
            self._active.discard(session_id)


class VoiceSessionOrchestrator:
    def __init__(
        self,
        *,
        settings: Settings,
        stt: StreamingSTTProvider,
        llm: StreamingLLMProvider,
        tts: StreamingTTSProvider,
        session_factory: async_sessionmaker[AsyncSession],
        registry: SessionRegistry,
        expected_session_id: str | None = None,
    ) -> None:
        self.settings = settings
        self.stt = stt
        self.llm = llm
        self.tts = tts
        self.session_factory = session_factory
        self.registry = registry
        self.expected_session_id = expected_session_id
        self.session_id: uuid.UUID | None = None
        self.correlation_id = "uninitialized"
        self.turn_guard: TurnGuard | None = None
        self.client_sequence = SequenceGuard()
        self.server_sequence = 0
        self.rate_limiter = SlidingWindowRateLimiter(settings.max_messages_per_second)
        self.outbound: asyncio.Queue[OutboundItem | None] = asyncio.Queue(settings.outbound_queue_size)
        self.pending_audio: AudioAppendMessage | None = None
        self.pipeline_task: asyncio.Task[None] | None = None
        self.stt_listener_task: asyncio.Task[None] | None = None
        self.cancel_event = asyncio.Event()
        self.segmenter = StreamingTextSegmenter()
        self.display_filter = StreamingDisplayFilter()
        self.history: list[dict[str, str]] = []
        self.transcript: list[dict[str, Any]] = []
        self.delivery_segments: dict[str, DeliverySegment] = {}
        self.started = False
        self.stopping = False
        self.raw_audio_retained = False
        self.metrics: dict[str, float | int | None] = {
            "audio_bytes_uploaded": 0,
            "audio_bytes_downloaded": 0,
            "time_to_first_partial_ms": None,
            "time_to_final_transcript_ms": None,
            "time_to_first_token_ms": None,
            "time_to_first_tts_audio_ms": None,
            "end_to_end_ms": None,
            "interrupt_cancellation_ms": None,
            "dropped_events": 0,
            "queue_depth": 0,
            "active_sessions": 0,
            "errors_total": 0,
            "stt_reconnects": 0,
            "tts_reconnects": 0,
            "generation_duration_ms": None,
            "generated_tokens": None,
            "tokens_per_second": None,
            "queue_time_ms": None,
        }
        self._commit_started_at: float | None = None
        self._metric_turn_id: int | None = None
        self._barge_in_candidate_turn: int | None = None
        self._acquired = False
        self.input_audio_format: Any | None = None

    @property
    def current_turn(self) -> int:
        return self.turn_guard.turn_id if self.turn_guard is not None else 0

    async def run(self, websocket: WebSocket) -> None:
        await websocket.accept()
        sender = asyncio.create_task(self._sender(websocket), name="linger-ws-sender")
        try:
            while not self.stopping:
                try:
                    received = await asyncio.wait_for(
                        websocket.receive(), timeout=self.settings.session_idle_timeout_seconds
                    )
                except TimeoutError:
                    await self._error(
                        "session_idle_timeout", "The voice session expired after inactivity.", False
                    )
                    break
                kind = received.get("type")
                if kind == "websocket.disconnect":
                    break
                try:
                    if not self.rate_limiter.allow():
                        raise ProtocolViolation("rate_limit_exceeded", "Too many WebSocket messages.")
                    text = received.get("text")
                    data = received.get("bytes")
                    if text is not None:
                        await self._handle_text(text)
                    elif data is not None:
                        await self._handle_binary(data)
                    else:
                        raise ProtocolViolation("unsupported_frame", "Unsupported WebSocket frame.")
                except ProtocolViolation as exc:
                    await self._error(exc.code, exc.message, exc.recoverable)
                    if exc.recoverable:
                        continue
                    break
        except WebSocketDisconnect:
            pass
        except ProtocolViolation as exc:
            await self._error(exc.code, exc.message, exc.recoverable)
        except Exception as exc:
            await self._error("session_error", f"Voice session ended safely ({type(exc).__name__}).", False)
        finally:
            await self._cleanup()
            await self.outbound.put(None)
            with contextlib.suppress(Exception):
                await asyncio.wait_for(sender, timeout=2)
            with contextlib.suppress(Exception):
                await websocket.close(code=1000)

    async def _sender(self, websocket: WebSocket) -> None:
        while True:
            item = await self.outbound.get()
            if item is None:
                return
            message, binary = item
            await websocket.send_json(message)
            if binary is not None:
                await websocket.send_bytes(binary)
            self.outbound.task_done()

    async def _handle_text(self, text: str) -> None:
        try:
            message = parse_client_message(text, max_bytes=self.settings.max_control_message_bytes)
        except ValidationError as exc:
            raise ProtocolViolation("invalid_message", validation_error_summary(exc)) from exc
        except ValueError as exc:
            raise ProtocolViolation("invalid_message", str(exc)) from exc

        if not self.client_sequence.accept(message.sequence):
            raise ProtocolViolation("out_of_order", "Sequence numbers must be strictly increasing.")
        if self.expected_session_id and str(message.session_id) != self.expected_session_id:
            raise ProtocolViolation(
                "session_mismatch", "The message session_id does not match the WebSocket path."
            )
        if not self.started:
            if not isinstance(message, SessionStartMessage):
                raise ProtocolViolation("session_not_started", "session.start must be the first message.")
            await self._start(message)
            return
        if self.session_id != message.session_id:
            raise ProtocolViolation("session_mismatch", "The message belongs to another session.")
        if isinstance(message, PlaybackAckMessage):
            self._accept_playback_ack(message)
            return
        if message.turn_id != self.current_turn:
            raise ProtocolViolation(
                "stale_turn", "The message turn_id is not the active turn.", recoverable=True
            )
        if isinstance(message, AudioAppendMessage):
            if message.payload.byte_length > self.settings.max_audio_frame_bytes:
                raise ProtocolViolation("audio_frame_too_large", "Audio frame exceeds the configured limit.")
            if self.pending_audio is not None:
                raise ProtocolViolation(
                    "missing_audio_frame", "The previous audio.append has no binary frame."
                )
            self.pending_audio = message
        elif isinstance(message, AudioCommitMessage):
            if self.pending_audio is not None:
                raise ProtocolViolation(
                    "missing_audio_frame", "audio.commit arrived before its binary frame."
                )
            await self._commit_turn()
        elif isinstance(message, AssistantCancelMessage):
            await self._interrupt(message.payload.reason)
        elif isinstance(message, SessionStopMessage):
            await self._stop(save_transcript=message.payload.save_transcript)
        elif message.type == "ping":
            await self._emit(
                "pong",
                {
                    "client_timestamp": message.payload.client_timestamp.isoformat(),
                    "server_timestamp": datetime.now(UTC).isoformat(),
                },
            )
        elif isinstance(message, SessionStartMessage):
            raise ProtocolViolation("duplicate_session_start", "The session has already started.")

    async def _handle_binary(self, data: bytes) -> None:
        pending, self.pending_audio = self.pending_audio, None
        if pending is None:
            raise ProtocolViolation(
                "orphan_audio_frame", "Binary audio requires a preceding audio.append message."
            )
        if len(data) != pending.payload.byte_length:
            raise ProtocolViolation(
                "audio_length_mismatch", "Binary audio length does not match audio.append."
            )
        if len(data) > self.settings.max_audio_frame_bytes:
            raise ProtocolViolation("audio_frame_too_large", "Audio frame exceeds the configured limit.")
        if pending.turn_id != self.current_turn:
            raise ProtocolViolation(
                "stale_audio", "Late audio from a previous turn was discarded.", recoverable=True
            )
        if self.input_audio_format is None:
            self.input_audio_format = pending.payload.audio_format
        elif pending.payload.audio_format != self.input_audio_format:
            raise ProtocolViolation("audio_format_changed", "Audio format cannot change during a session.")
        self._begin_turn_metrics(self.current_turn)
        try:
            await self.stt.append_audio(data, turn_id=self.current_turn)
        except ProviderError as exc:
            if await self._handle_stt_operation_error(exc):
                return
            raise ProtocolViolation(exc.code, exc.message) from exc
        self.metrics["audio_bytes_uploaded"] = int(self.metrics["audio_bytes_uploaded"] or 0) + len(data)

    async def _start(self, message: SessionStartMessage) -> None:
        if message.turn_id != 0:
            raise ProtocolViolation("invalid_initial_turn", "A new session must start at turn 0.")
        session_id = str(message.session_id)
        if not await self.registry.acquire(session_id):
            raise ProtocolViolation("session_limit", "The session is duplicate or the server is at capacity.")
        self._acquired = True
        self.session_id = message.session_id
        self.correlation_id = message.correlation_id
        self.turn_guard = TurnGuard(message.session_id)
        self.raw_audio_retained = False
        await self.stt.connect(language=message.payload.language, audio_format=message.payload.audio_format)
        self.input_audio_format = message.payload.audio_format or getattr(self.stt, "audio_format", None)
        prompt_path = self.settings.prompts_dir / "oral_history_voice.md"
        system_prompt = prompt_path.read_text(encoding="utf-8")
        self.history = [{"role": "system", "content": system_prompt}]
        async with self.session_factory() as session:
            existing = await session.get(ConversationSession, session_id)
            if existing is not None:
                raise ProtocolViolation("duplicate_session", "This session_id has already been used.")
            session.add(
                ConversationSession(
                    id=session_id,
                    user_id=DEMO_USER_ID,
                    provider=f"{self.stt.name}/{self.llm.name}/{self.tts.name}",
                    recording_consent=True,
                    retain_audio_consent=message.payload.retain_audio,
                    correlation_id=self.correlation_id,
                )
            )
            await session.commit()
        self.started = True
        self.metrics["active_sessions"] = self.registry.active_count
        log_session_event(
            logger,
            "session.started",
            correlation_id=self.correlation_id,
            session_id=str(self.session_id),
            turn_id=self.current_turn,
            subsystem="orchestrator",
        )
        self.stt_listener_task = asyncio.create_task(self._listen_stt(), name="linger-stt-listener")
        ready_payload: dict[str, Any] = {
            "provider": f"{self.stt.name}/{self.llm.name}/{self.tts.name}",
            "raw_audio_retained": False,
            "auth_mode": self.settings.auth_mode,
        }
        if self.input_audio_format is not None:
            ready_payload["audio_format"] = self.input_audio_format.model_dump(mode="json")
        await self._emit("session.ready", ready_payload)
        await self._state("listening")

    async def _commit_turn(self) -> None:
        if self.pipeline_task and not self.pipeline_task.done():
            raise ProtocolViolation(
                "turn_busy", "The current turn is already being processed.", recoverable=True
            )
        self.cancel_event = asyncio.Event()
        self.segmenter.reset()
        turn_id = self.current_turn
        self._begin_turn_metrics(turn_id)
        try:
            await self.stt.commit(turn_id=turn_id)
        except ProviderError as exc:
            if await self._handle_stt_operation_error(exc):
                return
            raise ProtocolViolation(exc.code, exc.message) from exc

    async def _listen_stt(self) -> None:
        try:
            async for transcript in self.stt.events():
                turn_id = transcript.turn_id
                if transcript.signal == "speech_started":
                    if self.pipeline_task and not self.pipeline_task.done() and self._is_current(turn_id):
                        # A raw VAD edge can be speaker echo or a brief noise. Keep the
                        # response running until STT confirms actual words.
                        self._barge_in_candidate_turn = turn_id
                    elif self._is_current(turn_id):
                        self._begin_turn_metrics(turn_id)
                    continue
                if transcript.signal != "transcript" or not self._is_current(turn_id):
                    continue
                if (
                    self._barge_in_candidate_turn == turn_id
                    and self.pipeline_task
                    and not self.pipeline_task.done()
                ):
                    if not transcript.text.strip():
                        continue
                    self._barge_in_candidate_turn = None
                    await self._interrupt("barge_in", preserve_stt=True)
                    # The confirming partial belongs to the newly advanced input turn.
                    turn_id = self.current_turn
                self._begin_turn_metrics(turn_id)
                elapsed = self._elapsed_commit_ms()
                if transcript.is_final:
                    self.metrics["time_to_final_transcript_ms"] = elapsed
                    event_type = "transcript.final"
                else:
                    if self.metrics["time_to_first_partial_ms"] is None:
                        self.metrics["time_to_first_partial_ms"] = elapsed
                    event_type = "transcript.partial"
                await self._emit(
                    event_type,
                    {
                        "text": transcript.text,
                        "is_final": transcript.is_final,
                        "confidence": transcript.confidence,
                    },
                    turn_id=turn_id,
                )
                if transcript.is_final:
                    if self.pipeline_task and not self.pipeline_task.done():
                        continue
                    self.pipeline_task = asyncio.create_task(
                        self._respond_to_final(transcript.text, turn_id), name=f"linger-turn-{turn_id}"
                    )
        except asyncio.CancelledError:
            raise
        except ProviderError as exc:
            await self._error(exc.code, exc.message, exc.recoverable)
            if exc.recoverable and not self.stopping:
                await asyncio.sleep(0.1)
                self.stt_listener_task = asyncio.create_task(
                    self._listen_stt(), name="linger-stt-listener-reconnect"
                )
        except Exception as exc:
            await self._error(
                "stt_listener_failed", f"Speech recognition stopped ({type(exc).__name__}).", True
            )

    async def _respond_to_final(self, final_text: str, turn_id: int) -> None:
        if not self._is_current(turn_id):
            return
        # Automatic provider EOT reaches here without a client audio.commit. Initialize all turn-local state.
        self.cancel_event = asyncio.Event()
        self.segmenter.reset()
        self.display_filter.reset()
        self._begin_turn_metrics(turn_id)
        self.transcript.append({"role": "user", "text": final_text, "turn_id": turn_id})
        self.history.append({"role": "user", "content": final_text})
        try:
            if is_urgent_safety_intent(final_text):
                await self._generate_fixed_response(URGENT_SAFETY_RESPONSE, turn_id)
            else:
                await self._generate_response(turn_id)
        except asyncio.CancelledError:
            raise
        except ProviderError as exc:
            await self._error(exc.code, exc.message, exc.recoverable, turn_id=turn_id)
            if self._is_current(turn_id) and self.turn_guard is not None:
                self.turn_guard.advance()
                await self._state("listening")
        except Exception as exc:
            await self._error(
                "llm_failed",
                f"I'm sorry, I can't respond right now ({type(exc).__name__}).",
                True,
                turn_id=turn_id,
            )
            if self._is_current(turn_id) and self.turn_guard is not None:
                self.turn_guard.advance()
                await self._state("listening")

    async def _generate_response(self, turn_id: int) -> None:
        await self._state("thinking", turn_id=turn_id)
        messages = truncate_conversation(
            self.history,
            max_tokens=self.settings.llm_max_context_tokens,
            reserve_response_tokens=512,
        )
        tts_queue: asyncio.Queue[SpeechSegment | None] = asyncio.Queue(self.settings.tts_queue_size)
        tts_worker = asyncio.create_task(self._tts_worker(tts_queue, turn_id), name=f"linger-tts-{turn_id}")
        full_text = ""
        first_token = True
        generation_started_at = monotonic()
        generated_tokens: int | None = None
        stream = self.llm.stream(messages, turn_id=turn_id, cancellation=self.cancel_event)
        next_chunk: asyncio.Task[LLMChunk] | None = asyncio.create_task(_next_llm_chunk(stream))
        try:
            while next_chunk is not None:
                done, _ = await asyncio.wait({next_chunk}, timeout=self.segmenter.max_wait_seconds)
                if not done:
                    for segment in self.segmenter.flush_due():
                        await tts_queue.put(segment)
                    continue
                try:
                    chunk = next_chunk.result()
                except StopAsyncIteration:
                    next_chunk = None
                    break
                next_chunk = asyncio.create_task(_next_llm_chunk(stream))
                if not self._is_current(turn_id) or self.cancel_event.is_set():
                    return
                if chunk.generated_tokens is not None:
                    generated_tokens = chunk.generated_tokens
                if not chunk.text:
                    continue
                if first_token:
                    self.metrics["time_to_first_token_ms"] = self._elapsed_commit_ms()
                    first_token = False
                full_text += chunk.text
                display_delta = self.display_filter.feed(chunk.text)
                await self._emit(
                    "assistant.text.delta",
                    {"text": chunk.text, "display_text": display_delta},
                    turn_id=turn_id,
                )
                for segment in self.segmenter.feed(chunk.text):
                    await tts_queue.put(segment)
            generation_duration_ms = (monotonic() - generation_started_at) * 1000
            self.metrics["generation_duration_ms"] = generation_duration_ms
            self.metrics["generated_tokens"] = generated_tokens
            self.metrics["tokens_per_second"] = (
                generated_tokens / (generation_duration_ms / 1000)
                if generated_tokens is not None and generation_duration_ms > 0
                else None
            )
            for segment in self.segmenter.finish():
                await tts_queue.put(segment)
            display_tail = self.display_filter.finish()
            if display_tail:
                await self._emit(
                    "assistant.text.delta",
                    {"text": "", "display_text": display_tail},
                    turn_id=turn_id,
                )
            await tts_queue.put(None)
            await tts_worker
            if not self._is_current(turn_id) or self.cancel_event.is_set():
                return
            # Recompute from the full response as a final defensive pass over all paragraphs/tags.
            display_text = split_display_and_speech(full_text).display_text
            await self._emit(
                "assistant.text.final",
                {"text": full_text, "display_text": display_text},
                turn_id=turn_id,
            )
            self.transcript.append({"role": "assistant", "text": display_text, "turn_id": turn_id})
            self.history.append({"role": "assistant", "content": full_text})
            self.metrics["end_to_end_ms"] = self._elapsed_commit_ms()
            await self._emit_metrics(turn_id)
            if self.turn_guard is not None:
                self.turn_guard.advance()
            self._prune_delivery_state()
            await self._state("listening")
        finally:
            if next_chunk is not None and not next_chunk.done():
                next_chunk.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await next_chunk
            if not tts_worker.done():
                tts_worker.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await tts_worker

    async def _generate_fixed_response(self, response: str, turn_id: int) -> None:
        await self._state("thinking", turn_id=turn_id)
        await self._emit(
            "assistant.text.delta",
            {"text": response, "display_text": response},
            turn_id=turn_id,
        )
        tts_queue: asyncio.Queue[SpeechSegment | None] = asyncio.Queue(self.settings.tts_queue_size)
        tts_worker = asyncio.create_task(self._tts_worker(tts_queue, turn_id), name=f"linger-tts-{turn_id}")
        try:
            await tts_queue.put(split_display_and_speech(response))
            await tts_queue.put(None)
            await tts_worker
            if not self._is_current(turn_id) or self.cancel_event.is_set():
                return
            await self._emit(
                "assistant.text.final",
                {"text": response, "display_text": response},
                turn_id=turn_id,
            )
            self.transcript.append({"role": "assistant", "text": response, "turn_id": turn_id})
            self.history.append({"role": "assistant", "content": response})
            self.metrics["end_to_end_ms"] = self._elapsed_commit_ms()
            await self._emit_metrics(turn_id)
            if self.turn_guard is not None:
                self.turn_guard.advance()
            self._prune_delivery_state()
            await self._state("listening")
        finally:
            if not tts_worker.done():
                tts_worker.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await tts_worker

    async def _tts_worker(self, queue: asyncio.Queue[SpeechSegment | None], turn_id: int) -> None:
        first_audio = True
        emitted_speaking = False
        while True:
            segment = await queue.get()
            self.metrics["queue_depth"] = queue.qsize()
            if segment is None:
                queue.task_done()
                return
            if not self._is_current(turn_id) or self.cancel_event.is_set():
                queue.task_done()
                continue
            if not emitted_speaking:
                await self._state("speaking", turn_id=turn_id)
                emitted_speaking = True
            segment_id = str(uuid.uuid4())
            delivery = DeliverySegment(turn_id=turn_id, text=segment.display_text)
            self.delivery_segments[segment_id] = delivery
            try:
                async for audio in self.tts.synthesize(
                    segment.speech_text,
                    segment_id=segment_id,
                    turn_id=turn_id,
                    cancellation=self.cancel_event,
                ):
                    if not self._is_current(turn_id) or self.cancel_event.is_set():
                        break
                    if first_audio:
                        self.metrics["time_to_first_tts_audio_ms"] = self._elapsed_commit_ms()
                        first_audio = False
                    self.metrics["audio_bytes_downloaded"] = int(
                        self.metrics["audio_bytes_downloaded"] or 0
                    ) + len(audio.data)
                    emitted_sequence = await self._emit(
                        "assistant.audio.chunk",
                        {
                            "segment_id": segment_id,
                            "byte_length": len(audio.data),
                            "audio_format": audio.audio_format.model_dump(mode="json"),
                            "final_for_segment": audio.final_for_segment,
                        },
                        binary=audio.data,
                        turn_id=turn_id,
                    )
                    delivery.emitted_sequences.append(emitted_sequence)
                    if audio.final_for_segment:
                        delivery.final_sequence = emitted_sequence
            except Exception as exc:
                await self._emit(
                    "warning",
                    {
                        "code": "tts_failed",
                        "message": f"Audio playback is unavailable; the response remains visible ({type(exc).__name__}).",
                        "recoverable": True,
                    },
                    turn_id=turn_id,
                )
            finally:
                queue.task_done()

    async def _interrupt(self, reason: Literal["barge_in", "manual"], *, preserve_stt: bool = False) -> None:
        turn_id = self.current_turn
        started = monotonic()
        self._barge_in_candidate_turn = None
        self.cancel_event.set()
        self.segmenter.cancel()
        self.display_filter.reset()
        pipeline, self.pipeline_task = self.pipeline_task, None
        if pipeline and not pipeline.done():
            pipeline.cancel()
        cancellations = [self.llm.cancel(), self.tts.cancel()]
        if not preserve_stt:
            cancellations.append(self.stt.cancel())
        await asyncio.gather(*cancellations, return_exceptions=True)
        if pipeline:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await pipeline
        latency = (monotonic() - started) * 1000
        self.metrics["interrupt_cancellation_ms"] = latency
        log_session_event(
            logger,
            "assistant.interrupted",
            correlation_id=self.correlation_id,
            session_id=str(self.session_id) if self.session_id else None,
            turn_id=turn_id,
            subsystem="orchestrator",
            metrics={"cancellation_latency_ms": latency},
        )
        interrupted_segments = [
            segment for segment in self.delivery_segments.values() if segment.turn_id == turn_id
        ]
        delivered = " ".join(segment.text for segment in interrupted_segments if segment.fully_delivered)
        await self._emit(
            "assistant.interrupted",
            {
                "delivered_text": delivered,
                "delivery_uncertain": any(
                    segment.emitted_sequences and not segment.fully_delivered
                    for segment in interrupted_segments
                ),
                "cancellation_latency_ms": latency,
                "reason": reason,
            },
            turn_id=turn_id,
        )
        await self._state("interrupted", turn_id=turn_id)
        if self.turn_guard is not None:
            self.turn_guard.advance()
        if preserve_stt:
            await self.stt.reassign_turn(turn_id, self.current_turn)
        self._prune_delivery_state()
        await self._state("listening")

    def _accept_playback_ack(self, message: PlaybackAckMessage) -> None:
        segment = self.delivery_segments.get(message.payload.segment_id)
        if segment is None:
            raise ProtocolViolation(
                "unknown_playback_segment",
                "Playback acknowledgement refers to an unknown or expired segment.",
                recoverable=True,
            )
        if message.turn_id not in {segment.turn_id, self.current_turn}:
            raise ProtocolViolation(
                "playback_turn_mismatch",
                "Playback acknowledgement does not match the segment or active input turn.",
                recoverable=True,
            )
        maximum_emitted = max(segment.emitted_sequences, default=-1)
        if message.payload.delivered_through_sequence > maximum_emitted:
            raise ProtocolViolation(
                "invalid_playback_ack",
                "Playback acknowledgement exceeds the latest emitted audio sequence.",
                recoverable=True,
            )
        segment.acknowledged_through = max(
            segment.acknowledged_through, message.payload.delivered_through_sequence
        )
        self._prune_delivery_state()

    def _prune_delivery_state(self) -> None:
        minimum_turn = max(0, self.current_turn - 4)
        expired = [
            segment_id
            for segment_id, segment in self.delivery_segments.items()
            if segment.turn_id < minimum_turn
        ]
        for segment_id in expired:
            del self.delivery_segments[segment_id]
        while len(self.delivery_segments) > 256:
            oldest = next(iter(self.delivery_segments))
            del self.delivery_segments[oldest]

    async def _stop(self, *, save_transcript: bool) -> None:
        if self.pipeline_task and not self.pipeline_task.done():
            await self._interrupt("manual")
        if save_transcript:
            await self._emit(
                "warning",
                {
                    "code": "archive_confirmation_required",
                    "message": (
                        "Session transcripts are not persisted from the voice socket; use the explicit "
                        "archive confirmation flow to save a memory."
                    ),
                    "recoverable": True,
                },
            )
        async with self.session_factory() as session:
            record = await session.get(ConversationSession, str(self.session_id))
            if record is not None:
                record.ended_at = datetime.now(UTC)
                record.status = "ended"
                record.transcript = []
                await session.commit()
        await self._state("ended")
        log_session_event(
            logger,
            "session.ended",
            correlation_id=self.correlation_id,
            session_id=str(self.session_id) if self.session_id else None,
            turn_id=self.current_turn,
            subsystem="orchestrator",
        )
        self.stopping = True

    async def _cleanup(self) -> None:
        self.cancel_event.set()
        if self.pipeline_task and not self.pipeline_task.done():
            self.pipeline_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self.pipeline_task
        await asyncio.gather(self.stt.close(), self.llm.close(), self.tts.close(), return_exceptions=True)
        if self.started and self.session_id is not None:
            try:
                async with self.session_factory() as session:
                    record = await session.get(ConversationSession, str(self.session_id))
                    if record is not None and record.status == "active":
                        record.status = "disconnected"
                        record.ended_at = datetime.now(UTC)
                        # An abrupt disconnect never implicitly opts into transcript persistence.
                        record.transcript = []
                        await session.commit()
            except Exception:
                log_session_event(
                    logger,
                    "session.cleanup_failed",
                    correlation_id=self.correlation_id,
                    session_id=str(self.session_id),
                    turn_id=self.current_turn,
                    subsystem="database",
                    error_code="session_cleanup_failed",
                )
        if self.stt_listener_task and not self.stt_listener_task.done():
            self.stt_listener_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self.stt_listener_task
        if self._acquired and self.session_id is not None:
            await self.registry.release(str(self.session_id))
            self._acquired = False

    def _is_current(self, turn_id: int) -> bool:
        return (
            self.session_id is not None
            and self.turn_guard is not None
            and self.turn_guard.is_current(self.session_id, turn_id)
        )

    def _begin_turn_metrics(self, turn_id: int) -> None:
        if self._metric_turn_id == turn_id:
            return
        self._metric_turn_id = turn_id
        self._commit_started_at = monotonic()
        for key in TURN_LATENCY_METRICS:
            self.metrics[key] = None

    def _elapsed_commit_ms(self) -> float | None:
        return (monotonic() - self._commit_started_at) * 1000 if self._commit_started_at else None

    async def _handle_stt_operation_error(self, error: ProviderError) -> bool:
        await self._error(error.code, error.message, error.recoverable)
        if not error.recoverable:
            return False
        await self._state("listening")
        return True

    async def _state(self, state: str, *, turn_id: int | None = None) -> None:
        await self._emit("session.state", {"state": state}, turn_id=turn_id)

    async def _emit_metrics(self, turn_id: int) -> None:
        self.metrics["active_sessions"] = self.registry.active_count
        self.metrics["stt_reconnects"] = int(getattr(self.stt, "reconnect_count", 0))
        self.metrics["tts_reconnects"] = int(getattr(self.tts, "reconnect_count", 0))
        await self._emit("metrics.update", {"metrics": self.metrics}, turn_id=turn_id)

    async def _error(
        self,
        code: str,
        message: str,
        recoverable: bool,
        *,
        turn_id: int | None = None,
    ) -> None:
        if self.session_id is None:
            return
        self.metrics["errors_total"] = int(self.metrics["errors_total"] or 0) + 1
        log_session_event(
            logger,
            "session.error",
            correlation_id=self.correlation_id,
            session_id=str(self.session_id),
            turn_id=self.current_turn if turn_id is None else turn_id,
            subsystem="orchestrator",
            error_code=code,
        )
        await self._emit(
            "error",
            {"code": code, "message": message, "recoverable": recoverable},
            turn_id=turn_id,
        )

    async def _emit(
        self,
        event_type: str,
        payload: dict[str, Any],
        *,
        binary: bytes | None = None,
        turn_id: int | None = None,
    ) -> int:
        if self.session_id is None:
            return -1
        emitted_sequence = self.server_sequence
        envelope = ServerEnvelope(
            type=event_type,  # type: ignore[arg-type]
            session_id=self.session_id,
            turn_id=self.current_turn if turn_id is None else turn_id,
            sequence=self.server_sequence,
            timestamp=datetime.now(UTC),
            correlation_id=self.correlation_id,
            payload=payload,
        )
        self.server_sequence += 1
        try:
            await asyncio.wait_for(self.outbound.put((envelope.model_dump(mode="json"), binary)), timeout=2)
            return emitted_sequence
        except TimeoutError as exc:
            self.metrics["dropped_events"] = int(self.metrics["dropped_events"] or 0) + 1
            raise ProtocolViolation(
                "client_backpressure", "The client is not reading events fast enough."
            ) from exc
