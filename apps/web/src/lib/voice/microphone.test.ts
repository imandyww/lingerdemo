import { describe, expect, it, vi } from "vitest";
import { encodePcm16, MICROPHONE_AUDIO_FORMAT, MicrophoneCapture } from "./microphone";

describe("PCM microphone encoding", () => {
  it("encodes clipped little-endian signed 16-bit samples", () => {
    const buffer = encodePcm16([-2, -1, 0, 1, 2]);
    const view = new DataView(buffer);
    expect([...Array(5)].map((_, index) => view.getInt16(index * 2, true))).toEqual([-32768, -32768, 0, 32767, 32767]);
    expect(MICROPHONE_AUDIO_FORMAT).toEqual({ encoding: "pcm_s16le", sampleRateHz: 16000, channels: 1, contentType: "audio/L16" });
  });

  it("disables the physical audio track while paused and re-enables it before resuming", () => {
    const track = { enabled: true };
    const suspend = vi.fn(async () => undefined);
    const resume = vi.fn(async () => {
      expect(track.enabled).toBe(true);
    });
    const microphone = new MicrophoneCapture();
    const internals = microphone as unknown as {
      stream: { getAudioTracks: () => Array<{ enabled: boolean }> };
      context: { suspend: () => Promise<void>; resume: () => Promise<void> };
    };
    internals.stream = { getAudioTracks: () => [track] };
    internals.context = { suspend, resume };

    microphone.pause();
    expect(track.enabled).toBe(false);
    expect(suspend).toHaveBeenCalledOnce();
    microphone.resume();
    expect(track.enabled).toBe(true);
    expect(resume).toHaveBeenCalledOnce();
  });
});
