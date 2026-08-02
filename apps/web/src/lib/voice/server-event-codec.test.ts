import { describe, expect, it } from "vitest";
import { parseServerEnvelope } from "./server-event-codec";

const base = {
  protocol_version: "1.0",
  session_id: "550e8400-e29b-41d4-a716-446655440000",
  turn_id: 2,
  sequence: 7,
  timestamp: "2026-08-01T18:00:00.000Z",
  correlation_id: "corr-1",
};

describe("parseServerEnvelope", () => {
  it("accepts a canonical nested audio event", () => {
    const result = parseServerEnvelope({
      ...base,
      type: "assistant.audio.chunk",
      payload: {
        segment_id: "segment-1",
        byte_length: 6400,
        audio_format: { encoding: "pcm_s16le", sample_rate_hz: 16000, channels: 1, content_type: "audio/L16" },
        final_for_segment: false,
      },
    });
    expect(result?.type).toBe("assistant.audio.chunk");
  });

  it.each([
    { ...base, type: "provider.secret.event", payload: {} },
    { ...base, protocol_version: "2.0", type: "session.state", payload: { state: "listening" } },
    { ...base, session_id: "not-a-uuid", type: "session.state", payload: { state: "listening" } },
    { ...base, type: "assistant.audio.chunk", payload: { segment_id: "s", byte_length: 90000, audio_format: { encoding: "pcm_s16le", sample_rate_hz: 16000, channels: 1, content_type: "audio/L16" }, final_for_segment: true } },
    { ...base, type: "error", payload: { code: "bad", message: "Bad", recoverable: true, secret: "never" } },
  ])("rejects malformed or unknown messages", (message) => {
    expect(parseServerEnvelope(message)).toBeNull();
  });
});
