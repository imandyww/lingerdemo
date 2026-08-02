from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import pytest
from linger_api.protocol import SequenceGuard, ServerEnvelope, TurnGuard, parse_client_message
from pydantic import ValidationError


def envelope(message_type: str, payload: dict[str, object], *, sequence: int = 0) -> str:
    return json.dumps(
        {
            "type": message_type,
            "protocol_version": "1.0",
            "session_id": "12345678-1234-4234-8234-123456789abc",
            "turn_id": 0,
            "sequence": sequence,
            "timestamp": "2026-08-01T12:00:00Z",
            "correlation_id": "test-correlation",
            "payload": payload,
        }
    )


def test_strict_client_message_validation() -> None:
    message = parse_client_message(
        envelope(
            "session.start",
            {
                "language": "en-US",
                "consent_to_record": True,
                "retain_audio": False,
                "client_mode": "demo",
            },
        )
    )
    assert message.type == "session.start"
    with pytest.raises(ValidationError):
        parse_client_message(
            envelope(
                "audio.commit",
                {"reason": "manual", "unexpected": True},
            )
        )


def test_audio_frame_metadata_bounds() -> None:
    with pytest.raises(ValidationError):
        parse_client_message(
            envelope(
                "audio.append",
                {
                    "byte_length": 65_537,
                    "audio_format": {
                        "encoding": "pcm_s16le",
                        "sample_rate_hz": 16_000,
                        "channels": 1,
                        "content_type": "audio/L16",
                    },
                },
            )
        )


def test_sequence_and_turn_guards_reject_late_events() -> None:
    sequence = SequenceGuard()
    assert sequence.accept(0)
    assert not sequence.accept(0)
    assert sequence.accept(2)
    assert not sequence.accept(1)
    session_id = uuid.UUID("12345678-1234-4234-8234-123456789abc")
    turns = TurnGuard(session_id)
    assert turns.is_current(session_id, 0)
    turns.advance()
    assert not turns.is_current(session_id, 0)
    assert turns.is_current(session_id, 1)


def test_server_payload_is_discriminated_and_strict() -> None:
    base = {
        "type": "session.state",
        "session_id": uuid.UUID("12345678-1234-4234-8234-123456789abc"),
        "turn_id": 0,
        "sequence": 0,
        "timestamp": datetime.now(UTC),
        "correlation_id": "test",
    }
    assert ServerEnvelope(**base, payload={"state": "listening"}).payload["state"] == "listening"
    with pytest.raises(ValidationError):
        ServerEnvelope(**base, payload={"state": "listening", "unknown": True})


def test_oversized_control_message_is_rejected_before_parsing() -> None:
    with pytest.raises(ValueError, match="size limit"):
        parse_client_message("{" + " " * 100 + "}", max_bytes=16)
