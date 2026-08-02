import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import schema from "../schema/messages.schema.json";
import serverSchema from "../schema/server-events.schema.json";
import { PROTOCOL_VERSION, SequenceGuard, createEnvelope, isCurrentTurn } from "../src/index";

describe("protocol contract", () => {
  it("accepts a valid session start and rejects missing consent", () => {
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const valid = createEnvelope({
      type: "session.start",
      sessionId: "10000000-0000-4000-8000-000000000001",
      turnId: 0,
      sequence: 0,
      correlationId: "test",
      payload: { language: "en-US", consent_to_record: true as const, retain_audio: false, client_mode: "mock" as const },
    });
    expect(validate(valid)).toBe(true);
    expect(validate({ ...valid, payload: { ...valid.payload, consent_to_record: false } })).toBe(false);
    expect(valid.protocol_version).toBe(PROTOCOL_VERSION);
  });

  it("rejects out-of-order sequences", () => {
    const guard = new SequenceGuard();
    expect(guard.accept(1)).toBe(true);
    expect(guard.accept(1)).toBe(false);
    expect(guard.accept(0)).toBe(false);
    expect(guard.accept(2)).toBe(true);
  });

  it("filters late events from previous turns and sessions", () => {
    const event = { session_id: "a", turn_id: 4 };
    expect(isCurrentTurn(event, "a", 4)).toBe(true);
    expect(isCurrentTurn(event, "a", 5)).toBe(false);
    expect(isCurrentTurn(event, "b", 4)).toBe(false);
  });

  it("validates discriminated server payloads", () => {
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    const validate = ajv.compile(serverSchema);
    const event = createEnvelope({
      type: "assistant.audio.chunk",
      sessionId: "10000000-0000-4000-8000-000000000001",
      turnId: 2,
      sequence: 8,
      correlationId: "test-audio",
      payload: {
        segment_id: "segment-1",
        byte_length: 6400,
        audio_format: {
          encoding: "pcm_s16le",
          sample_rate_hz: 24000,
          channels: 1,
          content_type: "audio/L16",
        },
        final_for_segment: false,
      },
    });
    expect(validate(event)).toBe(true);
    expect(validate({ ...event, payload: { ...event.payload, invented_field: true } })).toBe(false);
  });
});
