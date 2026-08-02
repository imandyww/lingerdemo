export type MicrophonePermission = "prompt" | "granted" | "denied" | "unsupported";

const TARGET_SAMPLE_RATE = 16_000;
const CHUNK_SAMPLES = 3_200;

class PcmResampler {
  private pending: number[] = [];
  private position = 0;
  private output: number[] = [];

  constructor(private readonly inputRate: number) {}

  push(input: Float32Array): ArrayBuffer[] {
    for (const sample of input) this.pending.push(sample);
    const ratio = this.inputRate / TARGET_SAMPLE_RATE;
    while (this.position + 1 < this.pending.length) {
      const left = Math.floor(this.position);
      const fraction = this.position - left;
      const sample = (this.pending[left] ?? 0) * (1 - fraction) + (this.pending[left + 1] ?? 0) * fraction;
      this.output.push(sample);
      this.position += ratio;
    }
    const consumed = Math.floor(this.position);
    if (consumed > 0) {
      this.pending.splice(0, consumed);
      this.position -= consumed;
    }
    const chunks: ArrayBuffer[] = [];
    while (this.output.length >= CHUNK_SAMPLES) {
      chunks.push(encodePcm16(this.output.splice(0, CHUNK_SAMPLES)));
    }
    return chunks;
  }
}

function encodePcm16(samples: ArrayLike<number>): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(index * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return buffer;
}

export class MicrophoneCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private fallback: ScriptProcessorNode | null = null;
  private silentGain: GainNode | null = null;
  private chunkCallback: ((chunk: ArrayBuffer) => void) | null = null;

  onChunk(callback: (chunk: ArrayBuffer) => void): void {
    this.chunkCallback = callback;
  }

  async permission(): Promise<MicrophonePermission> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return "unsupported";
    if (!navigator.permissions?.query) return "prompt";
    try {
      const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
      return result.state;
    } catch {
      return "prompt";
    }
  }

  async start(): Promise<MicrophonePermission> {
    const Context = globalThis.AudioContext ??
      (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || !Context) return "unsupported";
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      this.context = new Context({ latencyHint: "interactive" });
      this.source = this.context.createMediaStreamSource(this.stream);
      this.silentGain = this.context.createGain();
      this.silentGain.gain.value = 0;
      this.silentGain.connect(this.context.destination);

      if (this.context.audioWorklet && globalThis.AudioWorkletNode) {
        await this.context.audioWorklet.addModule("/pcm-capture-worklet.js");
        this.worklet = new AudioWorkletNode(this.context, "linger-pcm-capture", {
          channelCount: 1,
          channelCountMode: "explicit",
          processorOptions: { targetSampleRate: TARGET_SAMPLE_RATE, chunkSamples: CHUNK_SAMPLES },
        });
        this.worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          if (event.data.byteLength > 0 && event.data.byteLength <= 65_536) this.chunkCallback?.(event.data);
        };
        this.source.connect(this.worklet);
        this.worklet.connect(this.silentGain);
      } else {
        // ScriptProcessor is a compatibility fallback for browsers without AudioWorklet.
        const resampler = new PcmResampler(this.context.sampleRate);
        this.fallback = this.context.createScriptProcessor(4096, 1, 1);
        this.fallback.onaudioprocess = (event) => {
          const channel = event.inputBuffer.getChannelData(0);
          for (const chunk of resampler.push(channel)) this.chunkCallback?.(chunk);
        };
        this.source.connect(this.fallback);
        this.fallback.connect(this.silentGain);
      }
      await this.context.resume();
      return "granted";
    } catch (error) {
      this.stop();
      const name = error instanceof DOMException ? error.name : "";
      return name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unsupported";
    }
  }

  pause(): void {
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = false;
    void this.context?.suspend();
  }

  resume(): void {
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = true;
    void this.context?.resume();
  }

  stop(): void {
    this.worklet?.disconnect();
    this.fallback?.disconnect();
    this.source?.disconnect();
    this.silentGain?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    if (this.context && this.context.state !== "closed") void this.context.close();
    this.worklet = null;
    this.fallback = null;
    this.source = null;
    this.silentGain = null;
    this.context = null;
    this.stream = null;
  }
}

export const MICROPHONE_AUDIO_FORMAT = {
  encoding: "pcm_s16le",
  sampleRateHz: TARGET_SAMPLE_RATE,
  channels: 1,
  contentType: "audio/L16",
} as const;

export { encodePcm16 };
