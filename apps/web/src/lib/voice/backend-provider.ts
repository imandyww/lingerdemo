import { StreamingAudioPlayer } from "./audio-player";
import { TypedEmitter } from "./emitter";
import { TurnGate } from "./turn-gate";
import { MICROPHONE_AUDIO_FORMAT } from "./microphone";
import { parseServerEnvelope } from "./server-event-codec";
import type {
  AssistantTextEvent,
  AudioEvent,
  RealtimeVoiceProvider,
  StateChangeEvent,
  TranscriptEvent,
  VoiceDiagnostics,
  VoiceError,
  VoiceSessionConfig,
  VoiceSessionState,
} from "./types";

function websocketUrl(sessionId?: string): string {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured) return sessionId ? `${configured.replace(/\/$/, "")}/${sessionId}` : configured;
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  const base = api.replace(/^http/, "ws").replace(/\/$/, "");
  return sessionId ? `${base}/ws/voice/${sessionId}` : `${base}/ws/voice`;
}

export class BackendWebSocketVoiceProvider implements RealtimeVoiceProvider {
  private socket: WebSocket | null = null;
  private config: VoiceSessionConfig | null = null;
  private sequence = 0;
  private reconnectCount = 0;
  private manuallyClosing = false;
  private playbackMuted = false;
  private reconnectTimer: number | null = null;
  private stopWaiter: { timer: number; resolve: () => void } | null = null;
  private gate = new TurnGate();
  private audioPlayer = new StreamingAudioPlayer();
  private pendingAudioMetadata: Omit<AudioEvent, "audio"> | null = null;
  private assistantTextByTurn = new Map<number, string>();
  private transcriptEmitter = new TypedEmitter<TranscriptEvent>();
  private textEmitter = new TypedEmitter<AssistantTextEvent>();
  private audioEmitter = new TypedEmitter<AudioEvent>();
  private stateEmitter = new TypedEmitter<StateChangeEvent>();
  private diagnosticsEmitter = new TypedEmitter<VoiceDiagnostics>();
  private errorEmitter = new TypedEmitter<VoiceError>();
  private diagnostics: VoiceDiagnostics = {
    correlationId: "not-started",
    uploadLatencyMs: null,
    firstPartialMs: null,
    finalTranscriptMs: null,
    firstTokenMs: null,
    firstAudioMs: null,
    speechToSpeechMs: null,
    cancellationMs: null,
    queueDepth: 0,
    droppedEvents: 0,
    reconnects: 0,
  };

  constructor() {
    this.audioPlayer.onFailure((message) => {
      this.errorEmitter.emit({ code: "audio_playback_failed", message, recoverable: true });
    });
    this.audioPlayer.onDelivered((event) => {
      this.sendControl("assistant.playback.ack", {
        segment_id: event.segmentId,
        delivered_through_sequence: event.sequence,
        playback_ms: 0,
      });
    });
  }

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    this.manuallyClosing = false;
    this.emitState("connecting", "Connecting to the private voice service");
    await this.openSocket();
  }

  async disconnect(): Promise<void> {
    this.manuallyClosing = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close(1000, "client disconnect");
    this.socket = null;
    await this.audioPlayer.close();
    this.emitState("disconnected", "Voice service disconnected");
  }

  async startSession(config: VoiceSessionConfig): Promise<void> {
    this.config = config;
    this.gate.start(config.sessionId, 0);
    this.audioPlayer.setActiveTurn(config.sessionId, 0);
    this.diagnostics = { ...this.diagnostics, correlationId: crypto.randomUUID() };
    await this.connect();
    this.sendControl("session.start", {
      language: config.language,
      consent_to_record: config.consentToRecord,
      retain_audio: config.retainAudio,
      client_mode: config.mode,
      audio_format: {
        encoding: MICROPHONE_AUDIO_FORMAT.encoding,
        sample_rate_hz: MICROPHONE_AUDIO_FORMAT.sampleRateHz,
        channels: 1,
        content_type: MICROPHONE_AUDIO_FORMAT.contentType,
      },
    });
  }

  async sendAudio(chunk: ArrayBuffer): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 1_048_576) {
      throw new Error("Audio connection is not ready. Pause and retry the session.");
    }
    if (chunk.byteLength === 0 || chunk.byteLength > 65_536) {
      throw new Error("Audio frame is outside the supported size.");
    }
    const startedAt = performance.now();
    this.sendControl("audio.append", {
      byte_length: chunk.byteLength,
      audio_format: {
        encoding: MICROPHONE_AUDIO_FORMAT.encoding,
        sample_rate_hz: MICROPHONE_AUDIO_FORMAT.sampleRateHz,
        channels: MICROPHONE_AUDIO_FORMAT.channels,
        content_type: MICROPHONE_AUDIO_FORMAT.contentType,
      },
    });
    socket.send(chunk);
    this.diagnostics = { ...this.diagnostics, uploadLatencyMs: Math.max(0, Math.round(performance.now() - startedAt)) };
    this.emitDiagnostics();
  }

  async interrupt(): Promise<void> {
    const startedAt = performance.now();
    this.audioPlayer.cancel();
    this.sendControl("assistant.cancel", { reason: "manual" });
    const nextTurn = this.gate.cancelAndAdvance();
    if (this.config) this.audioPlayer.setActiveTurn(this.config.sessionId, nextTurn);
    this.emitState("interrupted", "Assistant audio stopped");
    this.diagnostics = { ...this.diagnostics, cancellationMs: Math.max(1, Math.round(performance.now() - startedAt)) };
    this.emitDiagnostics();
  }

  setPlaybackMuted(muted: boolean): void {
    this.playbackMuted = muted;
    if (muted) this.audioPlayer.cancel();
  }

  async pause(): Promise<void> {
    this.sendControl("audio.commit", { reason: "manual" });
    this.emitState("paused", "Microphone paused");
  }

  async resume(): Promise<void> {
    this.emitState("listening", "Microphone resumed");
  }

  async stop(options: { saveTranscript?: boolean } = {}): Promise<void> {
    this.manuallyClosing = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    const waitForEnd = socket?.readyState === WebSocket.OPEN && this.config
      ? new Promise<void>((resolve) => {
          const timer = window.setTimeout(() => this.resolveStopWaiter(), 750);
          this.stopWaiter = { timer, resolve };
        })
      : Promise.resolve();
    this.sendControl("session.stop", { save_transcript: options.saveTranscript ?? false });
    this.audioPlayer.cancel();
    await waitForEnd;
    this.emitState("ended", "Conversation ended");
    this.config = null;
    this.pendingAudioMetadata = null;
    this.assistantTextByTurn.clear();
    if (socket?.readyState === WebSocket.OPEN) socket.close(1000, "session ended by user");
    this.socket = null;
  }

  onTranscript(callback: (event: TranscriptEvent) => void): () => void {
    return this.transcriptEmitter.subscribe(callback);
  }

  onAssistantText(callback: (event: AssistantTextEvent) => void): () => void {
    return this.textEmitter.subscribe(callback);
  }

  onAudio(callback: (event: AudioEvent) => void): () => void {
    return this.audioEmitter.subscribe(callback);
  }

  onStateChange(callback: (event: StateChangeEvent) => void): () => void {
    return this.stateEmitter.subscribe(callback);
  }

  onDiagnostics(callback: (metrics: VoiceDiagnostics) => void): () => void {
    return this.diagnosticsEmitter.subscribe(callback);
  }

  onError(callback: (error: VoiceError) => void): () => void {
    return this.errorEmitter.subscribe(callback);
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(websocketUrl(this.config?.sessionId));
      socket.binaryType = "arraybuffer";
      const timeout = window.setTimeout(() => {
        socket.close();
        reject(new Error("Voice service connection timed out."));
      }, 5000);
      socket.onopen = () => {
        window.clearTimeout(timeout);
        this.socket = socket;
        this.emitState("ready", "Voice service is ready");
        resolve();
      };
      socket.onmessage = (message) => this.handleMessage(message.data);
      socket.onerror = () => {
        window.clearTimeout(timeout);
        this.errorEmitter.emit({
          code: "voice_connection_failed",
          message: "The voice service could not be reached. The local demo remains available.",
          recoverable: true,
        });
        reject(new Error("Voice service connection failed."));
      };
      socket.onclose = () => {
        this.resolveStopWaiter();
        this.socket = null;
        if (!this.manuallyClosing && this.config) this.scheduleReconnect();
      };
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectCount >= 3 || this.reconnectTimer !== null) {
      if (this.reconnectCount >= 3) this.emitState("error", "Voice service is unavailable after three retries");
      return;
    }
    const delay = Math.min(8000, 500 * 2 ** this.reconnectCount) + Math.round(Math.random() * 180);
    this.reconnectCount += 1;
    this.diagnostics = { ...this.diagnostics, reconnects: this.reconnectCount };
    this.emitDiagnostics();
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      const previous = this.config;
      if (!previous) return;
      const replacement = createReplacementSessionConfig(previous);
      this.config = replacement;
      this.sequence = 0;
      this.pendingAudioMetadata = null;
      this.assistantTextByTurn.clear();
      this.gate.start(replacement.sessionId, 0);
      this.audioPlayer.setActiveTurn(replacement.sessionId, 0);
      this.diagnostics = { ...this.diagnostics, correlationId: crypto.randomUUID() };
      this.emitState("connecting", "The connection was replaced with a new private session");
      void this.connect().then(() => this.startSession(replacement));
    }, delay);
  }

  private handleMessage(data: unknown): void {
    if (data instanceof ArrayBuffer) {
      const metadata = this.pendingAudioMetadata;
      this.pendingAudioMetadata = null;
      if (!metadata) return;
      const event: AudioEvent = { ...metadata, audio: data };
      if (!this.gate.accept(event)) {
        this.syncDropped();
        return;
      }
      this.audioEmitter.emit(event);
      this.audioPlayer.setActiveTurn(event.sessionId, event.turnId, { cancelPending: false });
      if (!this.playbackMuted) this.audioPlayer.enqueue(event);
      this.diagnostics = { ...this.diagnostics, queueDepth: this.audioPlayer.queueDepth };
      this.emitDiagnostics();
      return;
    }
    if (typeof data !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      this.errorEmitter.emit({ code: "malformed_event", message: "The voice service sent an invalid event.", recoverable: true });
      return;
    }
    const event = parseServerEnvelope(parsed);
    if (!event) {
      this.errorEmitter.emit({ code: "invalid_server_event", message: "The voice service sent an event that failed protocol validation.", recoverable: true });
      return;
    }
    if (event.turn_id > this.gate.turnId) {
      this.gate.moveToTurn(event.turn_id);
    }
    if (event.type === "assistant.audio.chunk") {
      const audioFormat = event.payload.audio_format && typeof event.payload.audio_format === "object"
        ? event.payload.audio_format as Record<string, unknown>
        : event.payload;
      this.pendingAudioMetadata = {
        sessionId: event.session_id,
        turnId: event.turn_id,
        sequence: event.sequence,
        segmentId: String(event.payload.segment_id ?? "segment"),
        format: {
          encoding: (audioFormat.encoding as AudioEvent["format"]["encoding"]) ?? "provider_native",
          sampleRateHz: Number(audioFormat.sample_rate_hz ?? 24_000),
          channels: audioFormat.channels === 2 ? 2 : 1,
          contentType: String(audioFormat.content_type ?? "audio/wav"),
        },
        finalForSegment: Boolean(event.payload.final_for_segment),
      };
      return;
    }
    if (!this.gate.accept({ sessionId: event.session_id, turnId: event.turn_id, sequence: event.sequence })) {
      this.syncDropped();
      return;
    }
    switch (event.type) {
      case "session.ready":
        this.emitState(
          "ready",
          `Voice provider ready: ${String(event.payload.provider)}`,
          event.payload.auth_mode === "mock" || event.payload.auth_mode === "unconfigured" ? event.payload.auth_mode : undefined,
        );
        break;
      case "session.state":
        this.emitState(String(event.payload.state) as VoiceSessionState, String(event.payload.detail ?? ""));
        if (event.payload.state === "ended") this.resolveStopWaiter();
        break;
      case "transcript.partial":
      case "transcript.final":
        this.transcriptEmitter.emit({
          sessionId: event.session_id,
          turnId: event.turn_id,
          sequence: event.sequence,
          text: String(event.payload.text ?? ""),
          isFinal: event.type === "transcript.final",
          speaker: "user",
        });
        break;
      case "assistant.text.delta":
      case "assistant.text.final": {
        const delta = String(event.payload.display_text ?? event.payload.text ?? "");
        const previous = this.assistantTextByTurn.get(event.turn_id) ?? "";
        const displayText = event.type === "assistant.text.final"
          ? delta
          : previous + delta;
        if (event.type === "assistant.text.final") this.assistantTextByTurn.delete(event.turn_id);
        else this.assistantTextByTurn.set(event.turn_id, displayText);
        this.textEmitter.emit({
          sessionId: event.session_id,
          turnId: event.turn_id,
          sequence: event.sequence,
          text: displayText,
          isFinal: event.type === "assistant.text.final",
          delivered: event.type === "assistant.text.final",
        });
        break;
      }
      case "assistant.interrupted":
        this.audioPlayer.cancel();
        this.assistantTextByTurn.delete(event.turn_id);
        this.emitState("interrupted", "Assistant audio stopped");
        break;
      case "metrics.update":
        this.applyMetrics(event.payload.metrics);
        break;
      case "error":
      case "warning":
        this.errorEmitter.emit({
          code: String(event.payload.code ?? "voice_service_notice"),
          message: String(event.payload.message ?? "The voice service reported a problem."),
          recoverable: Boolean(event.payload.recoverable),
        });
        break;
    }
  }

  private sendControl(type: string, payload: Record<string, unknown>): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.config) return;
    this.sequence += 1;
    socket.send(
      JSON.stringify({
        type,
        protocol_version: "1.0",
        session_id: this.config.sessionId,
        turn_id: this.gate.turnId,
        sequence: this.sequence,
        timestamp: new Date().toISOString(),
        correlation_id: this.diagnostics.correlationId,
        payload,
      }),
    );
  }

  private emitState(state: VoiceSessionState, detail: string, authMode?: "mock" | "unconfigured"): void {
    const event = { sessionId: this.config?.sessionId ?? null, state, detail, turnId: this.gate.turnId };
    this.stateEmitter.emit(authMode ? { ...event, authMode } : event);
  }

  private emitDiagnostics(): void {
    this.diagnosticsEmitter.emit(this.diagnostics);
  }

  private resolveStopWaiter(): void {
    const waiter = this.stopWaiter;
    if (!waiter) return;
    window.clearTimeout(waiter.timer);
    this.stopWaiter = null;
    waiter.resolve();
  }

  private syncDropped(): void {
    this.diagnostics = { ...this.diagnostics, droppedEvents: this.gate.droppedEvents };
    this.emitDiagnostics();
  }

  private applyMetrics(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const metrics = value as Record<string, unknown>;
    const numeric = (key: string): number | null => (typeof metrics[key] === "number" ? metrics[key] : null);
    this.diagnostics = {
      ...this.diagnostics,
      uploadLatencyMs: numeric("microphone_to_backend_ms") ?? this.diagnostics.uploadLatencyMs,
      firstPartialMs: numeric("time_to_first_partial_ms") ?? numeric("first_partial_ms") ?? this.diagnostics.firstPartialMs,
      finalTranscriptMs: numeric("time_to_final_transcript_ms") ?? numeric("final_transcript_ms") ?? this.diagnostics.finalTranscriptMs,
      firstTokenMs: numeric("time_to_first_token_ms") ?? numeric("first_token_ms") ?? this.diagnostics.firstTokenMs,
      firstAudioMs: numeric("time_to_first_tts_audio_ms") ?? numeric("first_audio_ms") ?? this.diagnostics.firstAudioMs,
      speechToSpeechMs: numeric("end_to_end_ms") ?? numeric("speech_to_speech_ms") ?? this.diagnostics.speechToSpeechMs,
      cancellationMs: numeric("interrupt_cancellation_ms") ?? numeric("cancellation_ms") ?? this.diagnostics.cancellationMs,
    };
    this.emitDiagnostics();
  }
}

export function createReplacementSessionConfig(previous: VoiceSessionConfig): VoiceSessionConfig {
  return { ...previous, sessionId: crypto.randomUUID() };
}
