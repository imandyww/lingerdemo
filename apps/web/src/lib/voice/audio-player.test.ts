import { afterEach, describe, expect, it, vi } from "vitest";
import { StreamingAudioPlayer } from "./audio-player";
import type { AudioEvent } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
});

function pcmEvent(sequence: number, byteLength = 2_000): AudioEvent {
  return {
    sessionId: "session",
    turnId: 1,
    sequence,
    segmentId: "segment",
    format: {
      encoding: "pcm_s16le",
      sampleRateHz: 1_000,
      channels: 1,
      contentType: "audio/L16",
    },
    finalForSegment: false,
    audio: new ArrayBuffer(byteLength),
  };
}

function installAudioContext(starts: number[]): void {
  class FakeAudioContext {
    currentTime = 10;
    state: AudioContextState = "running";
    destination = {} as AudioDestinationNode;

    createBuffer(channels: number, frameCount: number, sampleRate: number): AudioBuffer {
      return {
        duration: frameCount / sampleRate,
        getChannelData: () => new Float32Array(frameCount),
      } as unknown as AudioBuffer;
    }

    createBufferSource(): AudioBufferSourceNode {
      return {
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        onended: null,
        start: (when = 0) => starts.push(when),
        stop: vi.fn(),
      } as unknown as AudioBufferSourceNode;
    }

    resume(): Promise<void> { return Promise.resolve(); }
    close(): Promise<void> { return Promise.resolve(); }
  }

  vi.stubGlobal("AudioContext", FakeAudioContext);
}

describe("StreamingAudioPlayer turn changes", () => {
  it("does not cancel queued old-turn playback for a normal next-turn state", () => {
    const player = new StreamingAudioPlayer();
    const cancel = vi.spyOn(player, "cancel");
    player.setActiveTurn("session", 1);
    expect(cancel).toHaveBeenCalledTimes(1);
    player.setActiveTurn("session", 2, { cancelPending: false });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("still cancels immediately on an explicit replacement", () => {
    const player = new StreamingAudioPlayer();
    const cancel = vi.spyOn(player, "cancel");
    player.setActiveTurn("session", 1);
    player.setActiveTurn("replacement", 0);
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("schedules consecutive PCM chunks on one continuous timeline", async () => {
    const starts: number[] = [];
    installAudioContext(starts);
    const player = new StreamingAudioPlayer();
    player.setActiveTurn("session", 1);

    expect(player.enqueue(pcmEvent(1))).toBe(true);
    expect(player.enqueue(pcmEvent(2))).toBe(true);
    await vi.waitFor(() => expect(starts).toHaveLength(2));

    expect(starts[1]! - starts[0]!).toBeCloseTo(1, 6);
    await player.close();
  });

  it("continues scheduling after a malformed PCM chunk", async () => {
    const starts: number[] = [];
    installAudioContext(starts);
    const player = new StreamingAudioPlayer();
    player.setActiveTurn("session", 1);

    expect(player.enqueue(pcmEvent(1, 1))).toBe(true);
    expect(player.enqueue(pcmEvent(2))).toBe(true);
    await vi.waitFor(() => expect(starts).toHaveLength(1));

    await player.close();
  });
});
