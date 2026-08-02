import type { AudioEvent, VoiceSessionState } from "./types";

export const SERVER_EVENT_TYPES = [
  "session.ready", "session.state", "transcript.partial", "transcript.final",
  "assistant.text.delta", "assistant.text.final", "assistant.audio.chunk",
  "assistant.interrupted", "archive.extraction.ready", "archive.updated",
  "metrics.update", "warning", "error", "pong",
] as const;

export type ServerEventType = (typeof SERVER_EVENT_TYPES)[number];
export type ValidServerEnvelope = {
  type: ServerEventType;
  protocol_version: "1.0";
  session_id: string;
  turn_id: number;
  sequence: number;
  timestamp: string;
  correlation_id: string;
  payload: Record<string, unknown>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const states = new Set<VoiceSessionState>([
  "connecting", "ready", "listening", "thinking", "speaking", "saving", "paused", "interrupted", "ended", "error",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const permitted = new Set(allowed);
  return Object.keys(value).every((key) => permitted.has(key));
}

function text(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= max && (allowEmpty || value.length > 0);
}

function finiteNumber(value: unknown, minimum = -Infinity, maximum = Infinity): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function dateTime(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

function audioFormat(value: unknown): boolean {
  if (!isRecord(value) || !onlyKeys(value, ["encoding", "sample_rate_hz", "channels", "content_type"])) return false;
  const encoding = value.encoding as AudioEvent["format"]["encoding"];
  return (
    (encoding === "pcm_s16le" || encoding === "webm_opus" || encoding === "provider_native") &&
    integer(value.sample_rate_hz, 8_000, 192_000) &&
    (value.channels === 1 || value.channels === 2) &&
    text(value.content_type, 100)
  );
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 100 && value.every((item) => text(item, 128));
}

function validPayload(type: ServerEventType, payload: Record<string, unknown>): boolean {
  switch (type) {
    case "session.ready":
      return onlyKeys(payload, ["provider", "audio_format", "raw_audio_retained", "auth_mode"]) &&
        text(payload.provider, 160) && typeof payload.raw_audio_retained === "boolean" &&
        (payload.audio_format === undefined || payload.audio_format === null || audioFormat(payload.audio_format)) &&
        (payload.auth_mode === undefined || payload.auth_mode === "mock" || payload.auth_mode === "unconfigured");
    case "session.state":
      return onlyKeys(payload, ["state", "detail"]) && states.has(payload.state as VoiceSessionState) &&
        (payload.detail === undefined || text(payload.detail, 500, true));
    case "transcript.partial":
    case "transcript.final":
      return onlyKeys(payload, ["text", "is_final", "confidence"]) && text(payload.text, 100_000, true) &&
        typeof payload.is_final === "boolean" &&
        (payload.confidence === undefined || payload.confidence === null || finiteNumber(payload.confidence, 0, 1));
    case "assistant.text.delta":
    case "assistant.text.final":
      return onlyKeys(payload, ["text", "display_text", "segment_id"]) && text(payload.text, 100_000, true) &&
        text(payload.display_text, 100_000, true) && (payload.segment_id === undefined || text(payload.segment_id, 128));
    case "assistant.audio.chunk":
      return onlyKeys(payload, ["segment_id", "byte_length", "audio_format", "final_for_segment"]) &&
        text(payload.segment_id, 128) && integer(payload.byte_length, 1, 65_536) && audioFormat(payload.audio_format) &&
        typeof payload.final_for_segment === "boolean";
    case "assistant.interrupted":
      return onlyKeys(payload, ["delivered_text", "delivery_uncertain", "cancellation_latency_ms", "reason"]) &&
        text(payload.delivered_text, 100_000, true) && typeof payload.delivery_uncertain === "boolean" &&
        (payload.cancellation_latency_ms === undefined || finiteNumber(payload.cancellation_latency_ms, 0)) &&
        (payload.reason === undefined || payload.reason === "barge_in" || payload.reason === "manual");
    case "archive.extraction.ready":
      return onlyKeys(payload, ["extraction_id"]) && text(payload.extraction_id, 128);
    case "archive.updated":
      return onlyKeys(payload, ["story_id", "life_event_ids", "person_ids", "prompt_ids"]) &&
        text(payload.story_id, 128) && stringList(payload.life_event_ids) && stringList(payload.person_ids) && stringList(payload.prompt_ids);
    case "metrics.update":
      if (!onlyKeys(payload, ["metrics"]) || !isRecord(payload.metrics)) return false;
      return Object.values(payload.metrics).every((metric) => metric === null || finiteNumber(metric));
    case "warning":
    case "error":
      return onlyKeys(payload, ["code", "message", "recoverable"]) && text(payload.code, 128) &&
        text(payload.message, 1_000) && typeof payload.recoverable === "boolean";
    case "pong":
      return onlyKeys(payload, ["client_timestamp", "server_timestamp"]) && dateTime(payload.client_timestamp) && dateTime(payload.server_timestamp);
  }
}

export function parseServerEnvelope(value: unknown): ValidServerEnvelope | null {
  if (!isRecord(value) || !onlyKeys(value, ["type", "protocol_version", "session_id", "turn_id", "sequence", "timestamp", "correlation_id", "payload"])) return null;
  if (!(SERVER_EVENT_TYPES as readonly unknown[]).includes(value.type)) return null;
  if (
    value.protocol_version !== "1.0" || typeof value.session_id !== "string" || !UUID.test(value.session_id) ||
    !integer(value.turn_id) || !integer(value.sequence) || !dateTime(value.timestamp) ||
    !text(value.correlation_id, 128) || !isRecord(value.payload)
  ) return null;
  const type = value.type as ServerEventType;
  if (!validPayload(type, value.payload)) return null;
  return value as ValidServerEnvelope;
}
