import type { AudioEvent } from "./types";

type AudioContextConstructor = typeof AudioContext;

export class StreamingAudioPlayer {
  private static readonly SCHEDULE_LEAD_SECONDS = 0.04;

  private context: AudioContext | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private queue: AudioEvent[] = [];
  private draining = false;
  private scheduledThrough = 0;
  private generation = 0;
  private activeSessionId: string | null = null;
  private activeTurnId = 0;
  private lastSequence = -1;
  private deliveredCallback: ((event: AudioEvent) => void) | null = null;
  private failureCallback: ((message: string) => void) | null = null;

  setActiveTurn(sessionId: string, turnId: number, options: { cancelPending?: boolean } = {}): void {
    if (sessionId !== this.activeSessionId || turnId !== this.activeTurnId) {
      if (options.cancelPending !== false) this.cancel();
      this.activeSessionId = sessionId;
      this.activeTurnId = turnId;
      this.lastSequence = -1;
    }
  }

  onDelivered(callback: (event: AudioEvent) => void): void {
    this.deliveredCallback = callback;
  }

  onFailure(callback: (message: string) => void): void {
    this.failureCallback = callback;
  }

  enqueue(event: AudioEvent): boolean {
    if (
      event.sessionId !== this.activeSessionId ||
      event.turnId !== this.activeTurnId ||
      event.sequence <= this.lastSequence ||
      event.audio.byteLength === 0
    ) {
      return false;
    }
    this.lastSequence = event.sequence;
    this.queue.push(event);
    this.queue.sort((left, right) => left.sequence - right.sequence);
    void this.drain(this.generation);
    return true;
  }

  cancel(): void {
    this.generation += 1;
    this.queue = [];
    this.draining = false;
    this.scheduledThrough = 0;
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
      source.disconnect();
    }
    this.sources.clear();
  }

  async close(): Promise<void> {
    this.cancel();
    if (this.context) await this.context.close();
    this.context = null;
  }

  get queueDepth(): number {
    return this.queue.length;
  }

  private getContext(): AudioContext {
    if (this.context) return this.context;
    const Constructor = globalThis.AudioContext ??
      (globalThis as typeof globalThis & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
    if (!Constructor) throw new Error("This browser cannot play streamed audio.");
    this.context = new Constructor({ latencyHint: "interactive" });
    return this.context;
  }

  private async decode(event: AudioEvent): Promise<AudioBuffer> {
    const context = this.getContext();
    if (event.format.encoding !== "pcm_s16le") {
      return context.decodeAudioData(event.audio.slice(0));
    }
    const samples = new Int16Array(event.audio);
    const frameCount = Math.floor(samples.length / event.format.channels);
    if (frameCount === 0) throw new Error("The voice service sent an empty audio chunk.");
    const buffer = context.createBuffer(event.format.channels, frameCount, event.format.sampleRateHz);
    for (let channel = 0; channel < event.format.channels; channel += 1) {
      const channelData = buffer.getChannelData(channel);
      for (let frame = 0; frame < frameCount; frame += 1) {
        channelData[frame] = (samples[frame * event.format.channels + channel] ?? 0) / 32768;
      }
    }
    return buffer;
  }

  private async drain(generation: number): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0 && generation === this.generation) {
        const event = this.queue.shift();
        if (!event) break;
        try {
          const context = this.getContext();
          if (context.state === "suspended") await context.resume();
          const buffer = await this.decode(event);
          if (generation !== this.generation) return;
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(context.destination);
          const startsAt = Math.max(
            context.currentTime + StreamingAudioPlayer.SCHEDULE_LEAD_SECONDS,
            this.scheduledThrough,
          );
          this.scheduledThrough = startsAt + buffer.duration;
          this.sources.add(source);
          source.onended = () => {
            this.sources.delete(source);
            source.disconnect();
            if (generation === this.generation) this.deliveredCallback?.(event);
          };
          source.start(startsAt);
        } catch (error) {
          // A malformed chunk should not strand valid audio that is already queued behind it.
          this.failureCallback?.(error instanceof Error ? error.message : "Audio playback failed");
        }
      }
    } finally {
      if (generation === this.generation) {
        this.draining = false;
        if (this.queue.length > 0) void this.drain(generation);
      }
    }
  }
}
