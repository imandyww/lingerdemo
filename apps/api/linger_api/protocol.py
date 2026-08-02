from __future__ import annotations

import json
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    ValidationError,
    field_validator,
    model_validator,
)

PROTOCOL_VERSION = "1.0"
VoiceSessionState = Literal[
    "connecting",
    "ready",
    "listening",
    "thinking",
    "speaking",
    "saving",
    "paused",
    "interrupted",
    "ended",
    "error",
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class AudioFormat(StrictModel):
    encoding: Literal["pcm_s16le", "webm_opus", "provider_native"]
    sample_rate_hz: int = Field(ge=8_000, le=192_000)
    channels: Literal[1, 2]
    content_type: str = Field(min_length=3, max_length=100)


class SessionStartPayload(StrictModel):
    language: str = Field(min_length=2, max_length=35)
    consent_to_record: Literal[True]
    retain_audio: bool
    client_mode: Literal["mock", "backend", "demo"]
    audio_format: AudioFormat | None = None


class AudioAppendPayload(StrictModel):
    byte_length: int = Field(ge=1, le=65_536)
    audio_format: AudioFormat


class AudioCommitPayload(StrictModel):
    reason: Literal["manual", "silence"]


class AssistantCancelPayload(StrictModel):
    reason: Literal["barge_in", "manual"]


class PlaybackAckPayload(StrictModel):
    segment_id: str = Field(min_length=1, max_length=128)
    delivered_through_sequence: int = Field(ge=0)
    playback_ms: int = Field(ge=0, le=3_600_000)


class SessionStopPayload(StrictModel):
    save_transcript: bool


class PingPayload(StrictModel):
    client_timestamp: datetime


class ClientEnvelope(StrictModel):
    protocol_version: Literal["1.0"]
    session_id: UUID
    turn_id: int = Field(ge=0)
    sequence: int = Field(ge=0)
    timestamp: datetime
    correlation_id: str = Field(min_length=1, max_length=128)


class SessionStartMessage(ClientEnvelope):
    type: Literal["session.start"]
    payload: SessionStartPayload


class AudioAppendMessage(ClientEnvelope):
    type: Literal["audio.append"]
    payload: AudioAppendPayload


class AudioCommitMessage(ClientEnvelope):
    type: Literal["audio.commit"]
    payload: AudioCommitPayload


class AssistantCancelMessage(ClientEnvelope):
    type: Literal["assistant.cancel"]
    payload: AssistantCancelPayload


class PlaybackAckMessage(ClientEnvelope):
    type: Literal["assistant.playback.ack"]
    payload: PlaybackAckPayload


class SessionStopMessage(ClientEnvelope):
    type: Literal["session.stop"]
    payload: SessionStopPayload


class PingMessage(ClientEnvelope):
    type: Literal["ping"]
    payload: PingPayload


ClientMessage = Annotated[
    SessionStartMessage
    | AudioAppendMessage
    | AudioCommitMessage
    | AssistantCancelMessage
    | PlaybackAckMessage
    | SessionStopMessage
    | PingMessage,
    Field(discriminator="type"),
]
CLIENT_MESSAGE_ADAPTER: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)


def parse_client_message(raw: str | bytes, *, max_bytes: int = 32_768) -> ClientMessage:
    encoded = raw.encode("utf-8") if isinstance(raw, str) else raw
    if len(encoded) > max_bytes:
        raise ValueError("control message exceeds configured size limit")
    try:
        return CLIENT_MESSAGE_ADAPTER.validate_json(encoded)
    except UnicodeDecodeError as exc:
        raise ValueError("control message is not valid UTF-8 JSON") from exc


class SequenceGuard:
    def __init__(self) -> None:
        self._last = -1

    @property
    def last(self) -> int:
        return self._last

    def accept(self, sequence: int) -> bool:
        if sequence <= self._last:
            return False
        self._last = sequence
        return True

    def reset(self) -> None:
        self._last = -1


class TurnGuard:
    def __init__(self, session_id: UUID, turn_id: int = 0) -> None:
        self.session_id = session_id
        self.turn_id = turn_id

    def is_current(self, session_id: UUID | str, turn_id: int) -> bool:
        return str(session_id) == str(self.session_id) and turn_id == self.turn_id

    def advance(self) -> int:
        self.turn_id += 1
        return self.turn_id


class ServerEnvelope(StrictModel):
    type: Literal[
        "session.ready",
        "session.state",
        "transcript.partial",
        "transcript.final",
        "assistant.text.delta",
        "assistant.text.final",
        "assistant.audio.chunk",
        "assistant.interrupted",
        "archive.extraction.ready",
        "archive.updated",
        "metrics.update",
        "warning",
        "error",
        "pong",
    ]
    protocol_version: Literal["1.0"] = "1.0"
    session_id: UUID
    turn_id: int = Field(ge=0)
    sequence: int = Field(ge=0)
    timestamp: datetime
    correlation_id: str = Field(min_length=1, max_length=128)
    payload: dict[str, Any]

    @field_validator("payload")
    @classmethod
    def JSON_payload_only(cls, value: dict[str, Any]) -> dict[str, Any]:
        try:
            json.dumps(value)
        except (TypeError, ValueError) as exc:
            raise ValueError("server payload must be JSON serializable") from exc
        return value

    @model_validator(mode="after")
    def validate_typed_payload(self) -> ServerEnvelope:
        SERVER_PAYLOAD_TYPES[self.type].model_validate(self.payload)
        return self


class SessionReadyPayload(StrictModel):
    provider: str = Field(min_length=1, max_length=160)
    audio_format: AudioFormat | None = None
    raw_audio_retained: bool
    auth_mode: Literal["mock", "unconfigured"] | None = None


class SessionStatePayload(StrictModel):
    state: VoiceSessionState
    detail: str | None = Field(default=None, max_length=500)


class TranscriptPayload(StrictModel):
    text: str = Field(max_length=100_000)
    is_final: bool
    confidence: float | None = Field(default=None, ge=0, le=1)


class AssistantTextPayload(StrictModel):
    text: str = Field(max_length=100_000)
    display_text: str = Field(max_length=100_000)
    segment_id: str | None = Field(default=None, max_length=128)


class AssistantAudioPayload(StrictModel):
    segment_id: str = Field(min_length=1, max_length=128)
    byte_length: int = Field(ge=1, le=65_536)
    audio_format: AudioFormat
    final_for_segment: bool


class AssistantInterruptedPayload(StrictModel):
    delivered_text: str = Field(max_length=100_000)
    delivery_uncertain: bool
    cancellation_latency_ms: float | None = Field(default=None, ge=0)
    reason: Literal["barge_in", "manual"] | None = None


class ArchiveExtractionReadyPayload(StrictModel):
    extraction_id: str = Field(min_length=1, max_length=128)


class ArchiveUpdatedPayload(StrictModel):
    story_id: str = Field(min_length=1, max_length=128)
    life_event_ids: list[str] = Field(max_length=100)
    person_ids: list[str] = Field(max_length=100)
    prompt_ids: list[str] = Field(max_length=100)

    @field_validator("life_event_ids", "person_ids", "prompt_ids")
    @classmethod
    def validate_id_lengths(cls, values: list[str]) -> list[str]:
        if any(not value or len(value) > 128 for value in values):
            raise ValueError("event identifiers must contain 1 to 128 characters")
        return values


class MetricsPayload(StrictModel):
    metrics: dict[str, float | int | None]


class NoticePayload(StrictModel):
    code: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=1_000)
    recoverable: bool


class PongPayload(StrictModel):
    client_timestamp: str
    server_timestamp: str

    @field_validator("client_timestamp", "server_timestamp")
    @classmethod
    def validate_datetime(cls, value: str) -> str:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value


SERVER_PAYLOAD_TYPES: dict[str, type[StrictModel]] = {
    "session.ready": SessionReadyPayload,
    "session.state": SessionStatePayload,
    "transcript.partial": TranscriptPayload,
    "transcript.final": TranscriptPayload,
    "assistant.text.delta": AssistantTextPayload,
    "assistant.text.final": AssistantTextPayload,
    "assistant.audio.chunk": AssistantAudioPayload,
    "assistant.interrupted": AssistantInterruptedPayload,
    "archive.extraction.ready": ArchiveExtractionReadyPayload,
    "archive.updated": ArchiveUpdatedPayload,
    "metrics.update": MetricsPayload,
    "warning": NoticePayload,
    "error": NoticePayload,
    "pong": PongPayload,
}


class BinaryFrameHeader(StrictModel):
    session_id: UUID
    turn_id: int = Field(ge=0)
    sequence: int = Field(ge=0)
    segment_id: str = Field(min_length=1, max_length=128)
    byte_length: int = Field(ge=1, le=65_536)
    audio_format: AudioFormat
    final_for_segment: bool = False


class ProtocolViolation(ValueError):
    def __init__(self, code: str, message: str, *, recoverable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.recoverable = recoverable


def validation_error_summary(error: ValidationError) -> str:
    first = error.errors(include_url=False)[0]
    location = ".".join(str(part) for part in first["loc"])
    return f"{location}: {first['msg']}" if location else str(first["msg"])
