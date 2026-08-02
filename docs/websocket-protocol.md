# WebSocket protocol

Protocol version: `1.0`. The canonical language-neutral contracts are [`packages/protocol/schema/messages.schema.json`](../packages/protocol/schema/messages.schema.json) for client control and [`packages/protocol/schema/server-events.schema.json`](../packages/protocol/schema/server-events.schema.json) for server events, with matching TypeScript and Pydantic types.

## Connection

Connect to `/ws/voice/{session_id}`. The server accepts only configured origins, UUID session IDs, and capacity-admissible sessions. The first control frame must be `session.start` with explicit recording consent. In non-local deployments, use `wss://` behind an authenticated TLS reverse proxy.

JSON messages share this envelope:

```json
{
  "type": "session.start",
  "protocol_version": "1.0",
  "session_id": "10000000-0000-4000-8000-000000000001",
  "turn_id": 0,
  "sequence": 0,
  "timestamp": "2026-08-01T12:00:00Z",
  "correlation_id": "browser-generated-id",
  "payload": {}
}
```

The server rejects unknown message types, extra envelope fields, malformed timestamps, mismatched path/session IDs, duplicate or decreasing sequence numbers, stale turns, oversized JSON, excessive message frequency, and audio larger than `MAX_AUDIO_FRAME_BYTES`.

## Client messages

| Type | Purpose |
| --- | --- |
| `session.start` | Start an intentional recording session; consent must be `true`. |
| `audio.append` | Announce metadata for the next binary audio frame. |
| `audio.commit` | Manually finalize buffered audio when supported. |
| `assistant.cancel` | Barge in or manually interrupt the active assistant turn. |
| `assistant.playback.ack` | Confirm how much of an audio segment was delivered. |
| `session.stop` | Stop capture. The current server never persists a session transcript; archive confirmation is the only transcript-save path. |
| `ping` | Measure liveness/clock latency without transcript content. |

## Server events

| Type | Purpose |
| --- | --- |
| `session.ready` | Provider/readiness and negotiated audio metadata. |
| `session.state` | Connecting, ready, listening, thinking, speaking, saving, paused, interrupted, ended, or error. |
| `transcript.partial` | Unstable display-only STT text. |
| `transcript.final` | Stable utterance eligible for LLM processing. |
| `assistant.text.delta` | Incremental assistant display text. |
| `assistant.text.final` | Complete assistant turn text. |
| `assistant.audio.chunk` | Metadata associated with the following binary audio frame. |
| `assistant.interrupted` | Delivered text and delivery uncertainty after cancellation. |
| `archive.extraction.ready` | A consent-gated extraction is ready to review. |
| `archive.updated` | Transactional archive update identifiers. |
| `metrics.update` | Development-safe numeric diagnostics. |
| `warning` / `error` | Stable code, user-safe message, recoverability. |
| `pong` | Liveness response with client/server timestamps. |

## Binary framing

Audio bytes use binary WebSocket frames; they are not base64-encoded. A JSON `audio.append` immediately precedes each client binary frame and declares its byte length and format. A JSON `assistant.audio.chunk` immediately precedes each server binary frame and declares its `turn_id`, `segment_id`, sequence, format, byte length, and whether it ends the segment. No other JSON or binary frame may be interleaved between metadata and its associated binary payload.

The receiver validates declared and actual lengths. Browser playback queues by `(session_id, turn_id, sequence)` and drops stale turns before decoding. It acknowledges delivered segment sequences so interrupted content can be classified as delivered, not delivered, or uncertain.

## Cancellation

`assistant.cancel` is idempotent for the active turn. The browser stops playback and clears its queue immediately; the backend cancels the task group, provider operations, buffered segments, and audio queue. The server emits `assistant.interrupted`, then accepts the next monotonically increasing turn. Any event from the cancelled turn is discarded at its final emission boundary.

## Errors

Errors contain a stable `code`, a plain `message`, and `recoverable`. They never contain credentials, raw audio, stack traces, or provider response bodies. A recoverable TTS error preserves generated text; a non-recoverable session error closes capture and keeps explicit retry/end choices visible.
