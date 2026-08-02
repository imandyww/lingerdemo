from __future__ import annotations

import asyncio
import base64
import json
from typing import Any

import pytest
from linger_api.config import Settings
from linger_api.protocol import AudioFormat
from linger_api.providers import inworld
from linger_api.providers.inworld import STT_AUDIO_FORMAT, InworldSTTProvider, InworldTTSProvider
from pydantic import ValidationError


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.incoming: asyncio.Queue[str] = asyncio.Queue()
        self.closed = False
        self.sent_event = asyncio.Event()

    async def send(self, raw: str) -> None:
        self.sent.append(json.loads(raw))
        self.sent_event.set()

    async def recv(self) -> str:
        return await self.incoming.get()

    async def close(self) -> None:
        self.closed = True


async def test_inworld_stt_streams_partials_before_manual_commit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    socket = FakeSocket()

    async def fake_connect(url: str, headers: dict[str, str]) -> FakeSocket:
        assert url == inworld.STT_WEBSOCKET_URL
        assert headers == {"Authorization": "Basic already-base64"}
        return socket

    monkeypatch.setattr(inworld, "_connect_with_backoff", fake_connect)
    provider = InworldSTTProvider(Settings(inworld_api_key="already-base64"))
    await provider.connect(language="en-US", audio_format=STT_AUDIO_FORMAT)
    await provider.append_audio(b"\x00\x00" * 10, turn_id=4)
    await socket.incoming.put(json.dumps({"result": {"speechStarted": {}}}))
    await socket.incoming.put(
        json.dumps({"result": {"transcription": {"text": "The rain", "isFinal": False}}})
    )
    await socket.incoming.put(
        json.dumps({"result": {"transcription": {"text": "The rain reminds me of home.", "isFinal": True}}})
    )
    events = provider.events()
    speech_started = await anext(events)
    partial = await anext(events)
    final = await anext(events)
    assert speech_started.signal == "speech_started"
    assert partial.text == "The rain" and not partial.is_final
    assert final.is_final and final.turn_id == 4
    await provider.commit(turn_id=4)
    assert socket.sent[0]["transcribeConfig"]["language"] == "en-US"
    assert socket.sent[-1] == {"endTurn": {}}
    await provider.close()


async def test_inworld_stt_rejects_unsupported_audio_without_connecting() -> None:
    provider = InworldSTTProvider(Settings(inworld_api_key="credential"))
    with pytest.raises(Exception, match="16 kHz mono"):
        await provider.connect(
            language="en-US",
            audio_format=AudioFormat(
                encoding="webm_opus", sample_rate_hz=48_000, channels=1, content_type="audio/webm"
            ),
        )


async def test_inworld_tts_filters_stale_context_and_emits_configured_pcm() -> None:
    settings = Settings(
        inworld_api_key="credential",
        inworld_voice_id="voice-id",
        inworld_language="en-US",
        inworld_tts_delivery_mode="STABLE",
        inworld_tts_sample_rate_hz=16_000,
    )
    provider = InworldTTSProvider(settings)
    socket = FakeSocket()
    provider.socket = socket  # type: ignore[assignment]

    async def populate() -> None:
        await socket.sent_event.wait()
        context_id = socket.sent[0]["contextId"]
        stale = base64.b64encode(b"stale").decode("ascii")
        current = base64.b64encode(b"current").decode("ascii")
        continuation = base64.b64encode(b"continuation").decode("ascii")
        await socket.incoming.put(
            json.dumps({"result": {"contextId": "older-context", "audioChunk": {"audioContent": stale}}})
        )
        await socket.incoming.put(
            json.dumps({"result": {"contextId": context_id, "audioChunk": {"audioContent": current}}})
        )
        await socket.incoming.put(
            json.dumps({"result": {"contextId": context_id, "audioChunk": {"audioContent": ""}}})
        )
        await socket.incoming.put(
            json.dumps(
                {
                    "result": {
                        "contextId": context_id,
                        "audioChunk": {"audioContent": continuation},
                    }
                }
            )
        )
        await socket.incoming.put(json.dumps({"result": {"contextId": context_id, "flushCompleted": {}}}))

    producer = asyncio.create_task(populate())
    chunks = [
        chunk
        async for chunk in provider.synthesize(
            "A short test.", segment_id="segment", turn_id=1, cancellation=asyncio.Event()
        )
    ]
    await producer
    assert [chunk.data for chunk in chunks] == [b"current", b"continuation"]
    assert [chunk.final_for_segment for chunk in chunks] == [False, True]
    assert chunks[0].audio_format.sample_rate_hz == 16_000
    create = socket.sent[0]["create"]
    assert create["deliveryMode"] == "STABLE"
    assert create["language"] == "en-US"
    assert create["audioConfig"] == {"audioEncoding": "PCM", "sampleRateHertz": 16_000}
    await provider.close()


def test_inworld_tts_configuration_is_validated() -> None:
    with pytest.raises(ValidationError):
        Settings(inworld_tts_delivery_mode="EXPRESSIVE")  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        Settings(inworld_tts_sample_rate_hz=96_000)


async def test_bounded_reconnect_counters_increment_only_after_reset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sockets = [FakeSocket(), FakeSocket(), FakeSocket(), FakeSocket()]

    async def fake_connect(url: str, headers: dict[str, str]) -> FakeSocket:
        return sockets.pop(0)

    monkeypatch.setattr(inworld, "_connect_with_backoff", fake_connect)
    settings = Settings(inworld_api_key="credential", inworld_voice_id="voice")
    stt = InworldSTTProvider(settings)
    await stt.connect(language="en-US", audio_format=STT_AUDIO_FORMAT)
    await stt.cancel()
    await stt.connect(language="en-US", audio_format=STT_AUDIO_FORMAT)
    assert stt.reconnect_count == 1
    await stt.close()
    tts = InworldTTSProvider(settings)
    await tts._ensure_connected()
    await tts.cancel()
    await tts._ensure_connected()
    assert tts.reconnect_count == 1
    await tts.close()
