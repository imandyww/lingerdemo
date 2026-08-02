from __future__ import annotations

import asyncio
import base64
import json
import random
import uuid
from collections.abc import AsyncIterator
from time import monotonic
from typing import Any

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed, InvalidHandshake

from ..config import Settings
from ..protocol import AudioFormat
from .base import (
    AudioChunk,
    ProviderError,
    ProviderHealth,
    ProviderUnavailableError,
    StreamingSTTProvider,
    StreamingTTSProvider,
    TranscriptChunk,
)

STT_WEBSOCKET_URL = "wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional"
TTS_WEBSOCKET_URL = "wss://api.inworld.ai/tts/v1/voice:streamBidirectional"
STT_AUDIO_FORMAT = AudioFormat(
    encoding="pcm_s16le", sample_rate_hz=16_000, channels=1, content_type="audio/L16"
)
TTS_AUDIO_FORMAT = AudioFormat(
    encoding="pcm_s16le", sample_rate_hz=24_000, channels=1, content_type="audio/L16"
)


def _authorization(settings: Settings) -> dict[str, str]:
    if not settings.inworld_api_key:
        raise ProviderUnavailableError(
            "inworld_credentials_missing",
            "INWORLD_API_KEY must contain the provider-issued Base64 credential for live Inworld mode.",
        )
    # The credential is already Base64. Do not combine or re-encode it with INWORLD_API_SECRET.
    return {"Authorization": f"Basic {settings.inworld_api_key}"}


async def _connect_with_backoff(url: str, headers: dict[str, str]) -> ClientConnection:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            return await connect(
                url,
                additional_headers=headers,
                open_timeout=8,
                close_timeout=3,
                ping_interval=20,
                ping_timeout=10,
                max_size=2 * 1024 * 1024,
                max_queue=16,
            )
        except (OSError, ConnectionClosed, InvalidHandshake, TimeoutError) as exc:
            last_error = exc
            if attempt < 2:
                await asyncio.sleep(min(2.0, 0.2 * (2**attempt)) + random.uniform(0, 0.1))
    raise ProviderError(
        "inworld_connect_failed",
        f"Inworld streaming connection failed ({type(last_error).__name__}).",
        recoverable=True,
    ) from last_error


def _decode_message(raw: str | bytes) -> dict[str, Any]:
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProviderError(
            "inworld_malformed_event", "Inworld returned a malformed streaming event."
        ) from exc
    if not isinstance(value, dict):
        raise ProviderError("inworld_malformed_event", "Inworld returned a non-object streaming event.")
    if "error" in value:
        raise ProviderError("inworld_provider_error", "Inworld rejected the streaming request.")
    return value


class InworldSTTProvider(StreamingSTTProvider):
    name = "inworld"
    audio_format = STT_AUDIO_FORMAT

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.socket: ClientConnection | None = None
        self._cancelled = False
        self.connection_latency_ms: float | None = None
        self.audio_bytes = 0
        self._events: asyncio.Queue[TranscriptChunk | ProviderError] = asyncio.Queue(64)
        self._receiver_task: asyncio.Task[None] | None = None
        self._active_turn: int | None = None
        self._provider_sequence = 0
        self._language = settings.inworld_language
        self._audio_format: AudioFormat | None = None
        self.reconnect_count = 0
        self._has_connected = False

    async def connect(self, *, language: str, audio_format: AudioFormat | None) -> None:
        selected_format = audio_format or STT_AUDIO_FORMAT
        if selected_format != STT_AUDIO_FORMAT:
            raise ProviderError(
                "unsupported_audio_format",
                "Live Inworld STT accepts raw signed little-endian 16-bit PCM at 16 kHz mono in this build.",
            )
        started = monotonic()
        self.socket = await _connect_with_backoff(STT_WEBSOCKET_URL, _authorization(self.settings))
        if self._has_connected:
            self.reconnect_count += 1
        self._has_connected = True
        self.connection_latency_ms = (monotonic() - started) * 1000
        self._language = language
        self._audio_format = selected_format
        model_id = self.settings.inworld_stt_model or "inworld/inworld-stt-1"
        provider_language = language
        await self.socket.send(
            json.dumps(
                {
                    "transcribeConfig": {
                        "modelId": model_id,
                        "audioEncoding": "LINEAR16",
                        "sampleRateHertz": 16000,
                        "numberOfChannels": 1,
                        "language": provider_language,
                    }
                },
                separators=(",", ":"),
            )
        )
        self._cancelled = False
        self._receiver_task = asyncio.create_task(self._receive_loop(), name="inworld-stt-receiver")

    async def _ensure_connected(self) -> None:
        if self.socket is None:
            await self.connect(language=self._language, audio_format=self._audio_format)

    async def append_audio(self, data: bytes, *, turn_id: int) -> None:
        if not data:
            return
        await self._ensure_connected()
        if self._active_turn is None:
            self._active_turn = turn_id
        elif self._active_turn != turn_id:
            raise ProviderError("stale_audio", "Audio cannot cross an active STT turn.")
        assert self.socket is not None
        try:
            await self.socket.send(
                json.dumps(
                    {"audioChunk": {"content": base64.b64encode(data).decode("ascii")}},
                    separators=(",", ":"),
                )
            )
            self.audio_bytes += len(data)
        except ConnectionClosed as exc:
            self.socket = None
            raise ProviderError("stt_disconnected", "Inworld STT disconnected.", recoverable=True) from exc

    async def commit(self, *, turn_id: int) -> None:
        await self._ensure_connected()
        assert self.socket is not None
        if self._active_turn is None:
            self._active_turn = turn_id
        elif self._active_turn != turn_id:
            raise ProviderError("stale_audio", "An STT turn is already active.")
        self._cancelled = False
        # Manual commit is a documented fallback and is safe with the default automatic end-of-turn mode.
        try:
            await self.socket.send('{"endTurn":{}}')
        except ConnectionClosed as exc:
            self.socket = None
            raise ProviderError("stt_disconnected", "Inworld STT disconnected.", recoverable=True) from exc

    async def _receive_loop(self) -> None:
        try:
            assert self.socket is not None
            while not self._cancelled:
                event = _decode_message(await self.socket.recv())
                result = event.get("result")
                if not isinstance(result, dict):
                    continue
                turn_id = self._active_turn
                if turn_id is None:
                    continue
                if "speechStarted" in result:
                    await self._events.put(
                        TranscriptChunk(
                            provider_sequence=self._provider_sequence,
                            turn_id=turn_id,
                            signal="speech_started",
                        )
                    )
                    self._provider_sequence += 1
                if "speechStopped" in result:
                    await self._events.put(
                        TranscriptChunk(
                            provider_sequence=self._provider_sequence,
                            turn_id=turn_id,
                            signal="speech_stopped",
                        )
                    )
                    self._provider_sequence += 1
                transcription = result.get("transcription")
                if not isinstance(transcription, dict):
                    continue
                text = transcription.get("text") or transcription.get("transcript")
                is_final = transcription.get("isFinal")
                if not isinstance(text, str) or not isinstance(is_final, bool):
                    raise ProviderError(
                        "inworld_malformed_transcript",
                        "Inworld returned a transcript event without documented text/finality fields.",
                    )
                confidence = transcription.get("confidence")
                await self._events.put(
                    TranscriptChunk(
                        text=text,
                        is_final=is_final,
                        confidence=float(confidence) if isinstance(confidence, int | float) else None,
                        provider_sequence=self._provider_sequence,
                        turn_id=turn_id,
                    )
                )
                self._provider_sequence += 1
                if is_final:
                    self._active_turn = None
        except ConnectionClosed:
            await self._events.put(
                ProviderError("stt_disconnected", "Inworld STT disconnected.", recoverable=True)
            )
            self.socket = None
        except ProviderError as exc:
            await self._events.put(exc)

    async def _event_stream(self) -> AsyncIterator[TranscriptChunk]:
        while True:
            event = await self._events.get()
            if isinstance(event, ProviderError):
                raise event
            yield event

    def events(self) -> AsyncIterator[TranscriptChunk]:
        return self._event_stream()

    async def cancel(self) -> None:
        self._cancelled = True
        receiver, self._receiver_task = self._receiver_task, None
        if receiver and not receiver.done():
            receiver.cancel()
            try:
                await receiver
            except asyncio.CancelledError:
                pass
        socket, self.socket = self.socket, None
        if socket is not None:
            await socket.close()
        self._active_turn = None
        while not self._events.empty():
            self._events.get_nowait()

    async def reassign_turn(self, old_turn_id: int, new_turn_id: int) -> None:
        if self._active_turn == old_turn_id:
            self._active_turn = new_turn_id

    async def close(self) -> None:
        receiver, self._receiver_task = self._receiver_task, None
        if receiver and not receiver.done():
            receiver.cancel()
            try:
                await receiver
            except asyncio.CancelledError:
                pass
        socket, self.socket = self.socket, None
        if socket is not None:
            try:
                await socket.send('{"closeStream":{}}')
            except ConnectionClosed:
                pass
            await socket.close()

    async def health(self) -> ProviderHealth:
        if not self.settings.inworld_api_key:
            return ProviderHealth(
                False,
                self.name,
                "INWORLD_API_KEY is missing.",
                {"credentials": "fail", "stream": "skipped"},
            )
        return ProviderHealth(
            True,
            self.name,
            "Credentials are configured; the streaming handshake is tested when a live session starts.",
            {"credentials": "pass", "stream": "skipped"},
        )


class InworldTTSProvider(StreamingTTSProvider):
    name = "inworld"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.socket: ClientConnection | None = None
        self._cancelled = False
        self._lock = asyncio.Lock()
        self.reconnect_count = 0
        self._has_connected = False
        self.audio_format = AudioFormat(
            encoding="pcm_s16le",
            sample_rate_hz=settings.inworld_tts_sample_rate_hz,
            channels=1,
            content_type="audio/L16",
        )

    async def _ensure_connected(self) -> ClientConnection:
        if self.socket is None:
            self.socket = await _connect_with_backoff(TTS_WEBSOCKET_URL, _authorization(self.settings))
            if self._has_connected:
                self.reconnect_count += 1
            self._has_connected = True
        return self.socket

    async def _synthesize(
        self,
        text: str,
        *,
        segment_id: str,
        turn_id: int,
        cancellation: asyncio.Event,
    ) -> AsyncIterator[AudioChunk]:
        if not self.settings.inworld_voice_id:
            raise ProviderUnavailableError(
                "inworld_voice_missing", "INWORLD_VOICE_ID is required for live TTS."
            )
        if len(text) > 1_000:
            raise ProviderError(
                "tts_segment_too_long", "Inworld TTS text segments must not exceed 1000 characters."
            )
        async with self._lock:
            socket = await self._ensure_connected()
            self._cancelled = False
            context_id = f"linger-{turn_id}-{uuid.uuid4().hex}"
            create_request = {
                "create": {
                    "voiceId": self.settings.inworld_voice_id,
                    "modelId": self.settings.inworld_tts_model or "inworld-tts-2",
                    "bufferCharThreshold": 100,
                    "autoMode": True,
                    "timestampType": "WORD",
                    "timestampTransportStrategy": "ASYNC",
                    "language": self.settings.inworld_language,
                    "deliveryMode": self.settings.inworld_tts_delivery_mode,
                    "audioConfig": {
                        "audioEncoding": "PCM",
                        "sampleRateHertz": self.settings.inworld_tts_sample_rate_hz,
                    },
                },
                "contextId": context_id,
            }
            try:
                await socket.send(json.dumps(create_request, separators=(",", ":")))
                await socket.send(
                    json.dumps(
                        {"send_text": {"text": text, "flush_context": {}}, "contextId": context_id},
                        separators=(",", ":"),
                    )
                )
                pending: bytes | None = None
                sequence = 0
                async with asyncio.timeout(30):
                    while not cancellation.is_set() and not self._cancelled:
                        event = _decode_message(await socket.recv())
                        result = event.get("result")
                        if not isinstance(result, dict):
                            continue
                        event_context = result.get("contextId")
                        # Context identity is required for turn filtering. Missing/old events are drained only.
                        if event_context != context_id:
                            continue
                        audio = result.get("audioChunk")
                        if isinstance(audio, dict):
                            encoded = audio.get("audioContent")
                            if not isinstance(encoded, str):
                                raise ProviderError(
                                    "inworld_malformed_audio",
                                    "Inworld returned an audio event without audioContent.",
                                )
                            try:
                                decoded = base64.b64decode(encoded, validate=True)
                            except (ValueError, TypeError) as exc:
                                raise ProviderError(
                                    "inworld_malformed_audio", "Inworld returned invalid Base64 audio."
                                ) from exc
                            # Inworld may emit empty audioContent events between real PCM chunks.
                            # They are transport keepalives, not playable audio, and forwarding them
                            # would violate Linger's non-empty audio-frame protocol.
                            if not decoded:
                                continue
                            if pending is not None:
                                yield AudioChunk(pending, self.audio_format, sequence, False)
                                sequence += 1
                            pending = decoded
                        if "flushCompleted" in result or "contextClosed" in result:
                            if pending is not None:
                                yield AudioChunk(pending, self.audio_format, sequence, True)
                            if "contextClosed" not in result:
                                await socket.send(
                                    json.dumps(
                                        {"close_context": {}, "contextId": context_id}, separators=(",", ":")
                                    )
                                )
                            return
            except TimeoutError as exc:
                raise ProviderError(
                    "tts_timeout", "Inworld TTS did not complete in time.", recoverable=True
                ) from exc
            except ConnectionClosed as exc:
                self.socket = None
                raise ProviderError(
                    "tts_disconnected", "Inworld TTS disconnected.", recoverable=True
                ) from exc

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
        self._cancelled = True
        # The official bidirectional API documents no cancellation event. Resetting the isolated connection is
        # the safe fallback so late chunks cannot cross a turn boundary.
        socket, self.socket = self.socket, None
        if socket is not None:
            await socket.close()

    async def close(self) -> None:
        await self.cancel()

    async def health(self) -> ProviderHealth:
        checks: dict[str, str] = {
            "credentials": "pass" if self.settings.inworld_api_key else "fail",
            "voice_id": "pass" if self.settings.inworld_voice_id else "fail",
            "stream": "skipped",
        }
        ready = bool(self.settings.inworld_api_key and self.settings.inworld_voice_id)
        return ProviderHealth(
            ready,
            self.name,
            "Configuration is present; the streaming handshake is tested on first synthesis."
            if ready
            else "INWORLD_API_KEY and INWORLD_VOICE_ID are required.",
            checks,  # type: ignore[arg-type]
        )
