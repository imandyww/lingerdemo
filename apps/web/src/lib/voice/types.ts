export type VoiceSessionState =
  | "disconnected"
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

export type VoiceSessionConfig = {
  sessionId: string;
  language: string;
  consentToRecord: true;
  retainAudio: boolean;
  mode: "mock" | "backend" | "demo";
  speechSynthesis?: boolean;
};

export type TranscriptEvent = {
  sessionId: string;
  turnId: number;
  sequence: number;
  text: string;
  isFinal: boolean;
  speaker: "user";
};

export type AssistantTextEvent = {
  sessionId: string;
  turnId: number;
  sequence: number;
  text: string;
  isFinal: boolean;
  delivered: boolean;
};

export type AudioEvent = {
  sessionId: string;
  turnId: number;
  sequence: number;
  segmentId: string;
  audio: ArrayBuffer;
  format: {
    encoding: "pcm_s16le" | "webm_opus" | "provider_native";
    sampleRateHz: number;
    channels: 1 | 2;
    contentType: string;
  };
  finalForSegment: boolean;
};

export type StateChangeEvent = {
  sessionId: string | null;
  state: VoiceSessionState;
  detail: string;
  turnId: number;
  authMode?: "mock" | "unconfigured";
};

export type VoiceError = {
  code: string;
  message: string;
  recoverable: boolean;
};

export type VoiceDiagnostics = {
  correlationId: string;
  uploadLatencyMs: number | null;
  firstPartialMs: number | null;
  finalTranscriptMs: number | null;
  firstTokenMs: number | null;
  firstAudioMs: number | null;
  speechToSpeechMs: number | null;
  cancellationMs: number | null;
  queueDepth: number;
  droppedEvents: number;
  reconnects: number;
};

type Unsubscribe = () => void;

export interface RealtimeVoiceProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  startSession(config: VoiceSessionConfig): Promise<void>;
  sendAudio(chunk: ArrayBuffer): Promise<void>;
  interrupt(): Promise<void>;
  setPlaybackMuted(muted: boolean): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(options?: { saveTranscript?: boolean }): Promise<void>;
  onTranscript(callback: (event: TranscriptEvent) => void): Unsubscribe;
  onAssistantText(callback: (event: AssistantTextEvent) => void): Unsubscribe;
  onAudio(callback: (event: AudioEvent) => void): Unsubscribe;
  onStateChange(callback: (event: StateChangeEvent) => void): Unsubscribe;
  onDiagnostics(callback: (metrics: VoiceDiagnostics) => void): Unsubscribe;
  onError(callback: (error: VoiceError) => void): Unsubscribe;
}

export type ScriptedVoiceProvider = RealtimeVoiceProvider & {
  advanceScript(): Promise<{ complete: boolean; step: number }>;
  getStep(): number;
};
