import { TypedEmitter } from "./emitter";
import type {
  AssistantTextEvent,
  AudioEvent,
  ScriptedVoiceProvider,
  StateChangeEvent,
  TranscriptEvent,
  VoiceDiagnostics,
  VoiceError,
  VoiceSessionConfig,
} from "./types";

type ScriptStep = { user: string; assistant: string | null };

export const DEMO_SCRIPT: readonly ScriptStep[] = [
  { user: "The rain today reminds me of the day I left home.", assistant: "Who was with you?" },
  {
    user: "My younger brother Ming came with me to the station, but he was not allowed to board the train.",
    assistant: "How old were you then?",
  },
  {
    user: "Seventeen. I had one suitcase and a red scarf my mother made.",
    assistant: "Did you ever see that station again?",
  },
  { user: "No. But I still remember Ming standing there in the rain.", assistant: null },
] as const;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Cancelled", "AbortError"));
      },
      { once: true },
    );
  });
}

function partials(text: string): string[] {
  const words = text.split(" ");
  const sizes = [Math.min(4, words.length), Math.min(9, words.length), words.length];
  return [...new Set(sizes)].map((size) => words.slice(0, size).join(" "));
}

export class MockRealtimeVoiceProvider implements ScriptedVoiceProvider {
  private transcriptEmitter = new TypedEmitter<TranscriptEvent>();
  private textEmitter = new TypedEmitter<AssistantTextEvent>();
  private audioEmitter = new TypedEmitter<AudioEvent>();
  private stateEmitter = new TypedEmitter<StateChangeEvent>();
  private diagnosticsEmitter = new TypedEmitter<VoiceDiagnostics>();
  private errorEmitter = new TypedEmitter<VoiceError>();
  private config: VoiceSessionConfig | null = null;
  private sequence = 0;
  private turnId = 0;
  private step = 0;
  private controller = new AbortController();
  private connected = false;
  private paused = false;
  private muted = false;
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

  async connect(): Promise<void> {
    this.emitState("connecting", "Opening a private local session");
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    this.connected = true;
    this.emitState("ready", "Local demo is ready");
  }

  async disconnect(): Promise<void> {
    this.controller.abort();
    this.connected = false;
    this.emitState("disconnected", "Session disconnected");
  }

  async startSession(config: VoiceSessionConfig): Promise<void> {
    if (!this.connected) await this.connect();
    this.config = config;
    this.controller.abort();
    this.controller = new AbortController();
    this.turnId = 0;
    this.sequence = 0;
    this.step = 0;
    this.diagnostics = { ...this.diagnostics, correlationId: crypto.randomUUID() };
    this.emitDiagnostics();
    this.emitState("listening", "Local scripted listening; microphone is off");
  }

  async sendAudio(): Promise<void> {
    if (!this.config || this.paused) return;
    this.diagnostics = { ...this.diagnostics, uploadLatencyMs: 4 };
    this.emitDiagnostics();
  }

  async advanceScript(): Promise<{ complete: boolean; step: number }> {
    if (!this.config) throw new Error("Start the session before advancing the demo.");
    if (this.paused) throw new Error("Resume the conversation before continuing.");
    const scripted = DEMO_SCRIPT[this.step];
    if (!scripted) return { complete: true, step: this.step };
    this.controller.abort();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const startedAt = performance.now();
    this.turnId = this.step + 1;
    this.emitState("listening", "Following Mei’s scripted line; microphone is off");
    try {
      for (const [index, text] of partials(scripted.user).entries()) {
        await wait(index === 0 ? 80 : 150, signal);
        this.transcriptEmitter.emit({
          sessionId: this.config.sessionId,
          turnId: this.turnId,
          sequence: this.nextSequence(),
          text,
          isFinal: index === partials(scripted.user).length - 1,
          speaker: "user",
        });
        if (index === 0) {
          this.diagnostics = { ...this.diagnostics, firstPartialMs: Math.round(performance.now() - startedAt) };
        }
      }
      this.diagnostics = {
        ...this.diagnostics,
        finalTranscriptMs: Math.round(performance.now() - startedAt),
      };
      this.emitDiagnostics();
      if (scripted.assistant) {
        this.emitState("thinking", "Choosing one concrete follow-up");
        await wait(260, signal);
        const firstTokenAt = performance.now();
        this.emitState("speaking", "Asking one short question");
        const answerParts = scripted.assistant.match(/.{1,10}(?:\s|$)/g) ?? [scripted.assistant];
        let assembled = "";
        for (const [index, delta] of answerParts.entries()) {
          await wait(65, signal);
          assembled += delta;
          this.textEmitter.emit({
            sessionId: this.config.sessionId,
            turnId: this.turnId,
            sequence: this.nextSequence(),
            text: assembled.trim(),
            isFinal: index === answerParts.length - 1,
            delivered: index === answerParts.length - 1,
          });
        }
        this.diagnostics = {
          ...this.diagnostics,
          firstTokenMs: Math.round(firstTokenAt - startedAt),
          firstAudioMs: null,
          speechToSpeechMs: Math.round(performance.now() - startedAt),
        };
        this.emitDiagnostics();
        this.speakAsEnhancement(scripted.assistant);
        this.emitState("listening", "Listening; long pauses are welcome");
      } else {
        this.emitState("listening", "The story is ready to review");
      }
      this.step += 1;
      return { complete: this.step >= DEMO_SCRIPT.length, step: this.step };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return { complete: false, step: this.step };
      }
      this.errorEmitter.emit({ code: "mock_step_failed", message: "The scripted turn could not finish.", recoverable: true });
      throw error;
    }
  }

  async interrupt(): Promise<void> {
    const startedAt = performance.now();
    this.controller.abort();
    globalThis.speechSynthesis?.cancel();
    this.turnId += 1;
    this.emitState("interrupted", "Assistant audio stopped");
    this.diagnostics = { ...this.diagnostics, cancellationMs: Math.max(1, Math.round(performance.now() - startedAt)) };
    this.emitDiagnostics();
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    this.emitState("listening", "Listening again");
  }

  setPlaybackMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) globalThis.speechSynthesis?.cancel();
  }

  async pause(): Promise<void> {
    this.paused = true;
    this.controller.abort();
    globalThis.speechSynthesis?.cancel();
    this.emitState("paused", "Recording is paused");
  }

  async resume(): Promise<void> {
    this.paused = false;
    this.controller = new AbortController();
    this.emitState("listening", "Recording resumed");
  }

  async stop(): Promise<void> {
    this.controller.abort();
    globalThis.speechSynthesis?.cancel();
    this.emitState("ended", "Conversation ended");
  }

  getStep(): number {
    return this.step;
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

  private emitState(state: StateChangeEvent["state"], detail: string): void {
    this.stateEmitter.emit({ sessionId: this.config?.sessionId ?? null, state, detail, turnId: this.turnId, authMode: "mock" });
  }

  private nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  private emitDiagnostics(): void {
    this.diagnosticsEmitter.emit(this.diagnostics);
  }

  private speakAsEnhancement(text: string): void {
    if (this.muted || !this.config?.speechSynthesis || !globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) return;
    globalThis.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.88;
    utterance.pitch = 0.95;
    globalThis.speechSynthesis.speak(utterance);
  }
}
