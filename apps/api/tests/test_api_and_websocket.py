from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from fastapi.testclient import TestClient
from linger_api.main import app
from linger_api.seed import DEMO_FAMILY_ID


def message(
    message_type: str,
    session_id: str,
    *,
    turn_id: int,
    sequence: int,
    payload: dict[str, object],
) -> dict[str, object]:
    return {
        "type": message_type,
        "protocol_version": "1.0",
        "session_id": session_id,
        "turn_id": turn_id,
        "sequence": sequence,
        "timestamp": datetime.now(UTC).isoformat(),
        "correlation_id": f"test-{session_id}",
        "payload": payload,
    }


def receive_event(socket: object) -> dict[str, object]:
    while True:
        raw = socket.receive()  # type: ignore[attr-defined]
        if raw.get("text") is not None:
            return json.loads(raw["text"])


def test_health_readiness_and_seeded_archive() -> None:
    with TestClient(app) as client:
        assert client.get("/health").json()["status"] == "ok"
        ready = client.get("/ready")
        assert ready.status_code == 200
        archive = client.get(f"/api/families/{DEMO_FAMILY_ID}/archive").json()
        assert archive["family"]["id"] == DEMO_FAMILY_ID
        assert len(archive["people"]) == 6
        assert len(archive["stories"]) >= 5
        assert len(archive["unresolved_questions"]) >= 3


def test_mock_websocket_runs_final_stt_llm_segmented_tts_and_binary_audio() -> None:
    session_id = str(uuid.uuid4())
    with TestClient(app) as client:
        with client.websocket_connect(
            f"/ws/voice/{session_id}", headers={"origin": "http://localhost:3000"}
        ) as socket:
            socket.send_json(
                message(
                    "session.start",
                    session_id,
                    turn_id=0,
                    sequence=0,
                    payload={
                        "language": "en-US",
                        "consent_to_record": True,
                        "retain_audio": False,
                        "client_mode": "demo",
                    },
                )
            )
            assert receive_event(socket)["type"] == "session.ready"
            assert receive_event(socket)["payload"] == {"state": "listening"}
            socket.send_json(
                message(
                    "audio.commit",
                    session_id,
                    turn_id=0,
                    sequence=1,
                    payload={"reason": "manual"},
                )
            )
            event_types: list[str] = []
            final_state: dict[str, object] | None = None
            while final_state is None:
                event = receive_event(socket)
                event_types.append(str(event["type"]))
                if event["type"] == "session.state" and event["turn_id"] == 1:
                    final_state = event
            assert "transcript.partial" in event_types
            assert "transcript.final" in event_types
            assert "assistant.text.final" in event_types
            assert "assistant.audio.chunk" in event_types
            socket.send_json(
                message(
                    "session.stop",
                    session_id,
                    turn_id=1,
                    sequence=2,
                    payload={"save_transcript": True},
                )
            )
            warning = receive_event(socket)
            assert warning["type"] == "warning"
            assert warning["payload"]["code"] == "archive_confirmation_required"  # type: ignore[index]
            assert receive_event(socket)["payload"] == {"state": "ended"}


def test_recoverable_stale_turn_does_not_close_socket() -> None:
    session_id = str(uuid.uuid4())
    with TestClient(app) as client:
        with client.websocket_connect(
            f"/ws/voice/{session_id}", headers={"origin": "http://localhost:3000"}
        ) as socket:
            socket.send_json(
                message(
                    "session.start",
                    session_id,
                    turn_id=0,
                    sequence=0,
                    payload={
                        "language": "en-US",
                        "consent_to_record": True,
                        "retain_audio": False,
                        "client_mode": "backend",
                    },
                )
            )
            receive_event(socket)
            receive_event(socket)
            socket.send_json(
                message(
                    "audio.commit",
                    session_id,
                    turn_id=1,
                    sequence=1,
                    payload={"reason": "manual"},
                )
            )
            error = receive_event(socket)
            assert error["type"] == "error"
            assert error["payload"]["recoverable"] is True  # type: ignore[index]
            socket.send_json(
                message(
                    "ping",
                    session_id,
                    turn_id=0,
                    sequence=2,
                    payload={"client_timestamp": datetime.now(UTC).isoformat()},
                )
            )
            assert receive_event(socket)["type"] == "pong"


def test_orphan_binary_audio_is_rejected() -> None:
    session_id = str(uuid.uuid4())
    with TestClient(app) as client:
        with client.websocket_connect(
            f"/ws/voice/{session_id}", headers={"origin": "http://localhost:3000"}
        ) as socket:
            socket.send_json(
                message(
                    "session.start",
                    session_id,
                    turn_id=0,
                    sequence=0,
                    payload={
                        "language": "en-US",
                        "consent_to_record": True,
                        "retain_audio": False,
                        "client_mode": "backend",
                    },
                )
            )
            receive_event(socket)
            receive_event(socket)
            socket.send_bytes(b"orphan")
            error = receive_event(socket)
            assert error["type"] == "error"
            assert error["payload"]["code"] == "orphan_audio_frame"  # type: ignore[index]
