export const PROTOCOL_VERSION = "1.0" as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;
export type VoiceSessionState =
  | "connecting"
  | "ready"
  | "listening"
  | "thinking"
  | "speaking"
  | "saving"
  | "paused"
  | "interrupted"
  | "ended"
  | "error";

export type AudioFormat = {
  encoding: "pcm_s16le" | "webm_opus" | "provider_native";
  sample_rate_hz: number;
  channels: 1 | 2;
  content_type: string;
};

export type MessageEnvelope<TType extends string, TPayload = Record<string, never>> = {
  type: TType;
  protocol_version: ProtocolVersion;
  session_id: string;
  turn_id: number;
  sequence: number;
  timestamp: string;
  correlation_id: string;
  payload: TPayload;
};

export type SessionStartMessage = MessageEnvelope<
  "session.start",
  {
    language: string;
    consent_to_record: true;
    retain_audio: boolean;
    audio_format?: AudioFormat;
    client_mode: "mock" | "backend" | "demo";
  }
>;

export type AudioAppendMessage = MessageEnvelope<
  "audio.append",
  { byte_length: number; audio_format: AudioFormat }
>;
export type AudioCommitMessage = MessageEnvelope<"audio.commit", { reason: "manual" | "silence" }>;
export type AssistantCancelMessage = MessageEnvelope<"assistant.cancel", { reason: "barge_in" | "manual" }>;
export type PlaybackAckMessage = MessageEnvelope<
  "assistant.playback.ack",
  { segment_id: string; delivered_through_sequence: number; playback_ms: number }
>;
export type SessionStopMessage = MessageEnvelope<"session.stop", { save_transcript: boolean }>;
export type PingMessage = MessageEnvelope<"ping", { client_timestamp: string }>;

export type ClientControlMessage =
  | SessionStartMessage
  | AudioAppendMessage
  | AudioCommitMessage
  | AssistantCancelMessage
  | PlaybackAckMessage
  | SessionStopMessage
  | PingMessage;

export type SessionReadyEvent = MessageEnvelope<
  "session.ready",
  { provider: string; audio_format?: AudioFormat | null; raw_audio_retained: boolean; auth_mode?: "mock" | "unconfigured" }
>;
export type SessionStateEvent = MessageEnvelope<"session.state", { state: VoiceSessionState; detail?: string }>;
export type TranscriptEvent = MessageEnvelope<
  "transcript.partial" | "transcript.final",
  { text: string; is_final: boolean; confidence?: number }
>;
export type AssistantTextEvent = MessageEnvelope<
  "assistant.text.delta" | "assistant.text.final",
  { text: string; display_text: string; segment_id?: string }
>;
export type AssistantAudioEvent = MessageEnvelope<
  "assistant.audio.chunk",
  { segment_id: string; byte_length: number; audio_format: AudioFormat; final_for_segment: boolean }
>;
export type AssistantInterruptedEvent = MessageEnvelope<
  "assistant.interrupted",
  { delivered_text: string; delivery_uncertain: boolean; cancellation_latency_ms?: number; reason?: "barge_in" | "manual" }
>;
export type ArchiveExtractionReadyEvent = MessageEnvelope<"archive.extraction.ready", { extraction_id: string }>;
export type ArchiveUpdatedEvent = MessageEnvelope<
  "archive.updated",
  { story_id: string; life_event_ids: string[]; person_ids: string[]; prompt_ids: string[] }
>;
export type MetricsUpdateEvent = MessageEnvelope<"metrics.update", { metrics: Record<string, number | null> }>;
export type NoticeEvent = MessageEnvelope<
  "warning" | "error",
  { code: string; message: string; recoverable: boolean }
>;
export type PongEvent = MessageEnvelope<"pong", { client_timestamp: string; server_timestamp: string }>;

export type ServerEvent =
  | SessionReadyEvent
  | SessionStateEvent
  | TranscriptEvent
  | AssistantTextEvent
  | AssistantAudioEvent
  | AssistantInterruptedEvent
  | ArchiveExtractionReadyEvent
  | ArchiveUpdatedEvent
  | MetricsUpdateEvent
  | NoticeEvent
  | PongEvent;

export function isCurrentTurn(
  event: Pick<MessageEnvelope<string, unknown>, "session_id" | "turn_id">,
  sessionId: string,
  turnId: number,
): boolean {
  return event.session_id === sessionId && event.turn_id === turnId;
}

export class SequenceGuard {
  private lastSequence = -1;

  accept(sequence: number): boolean {
    if (!Number.isSafeInteger(sequence) || sequence <= this.lastSequence) return false;
    this.lastSequence = sequence;
    return true;
  }

  reset(): void {
    this.lastSequence = -1;
  }
}

export function createEnvelope<TType extends string, TPayload>(input: {
  type: TType;
  sessionId: string;
  turnId: number;
  sequence: number;
  correlationId: string;
  payload: TPayload;
}): MessageEnvelope<TType, TPayload> {
  return {
    type: input.type,
    protocol_version: PROTOCOL_VERSION,
    session_id: input.sessionId,
    turn_id: input.turnId,
    sequence: input.sequence,
    timestamp: new Date().toISOString(),
    correlation_id: input.correlationId,
    payload: input.payload,
  };
}
