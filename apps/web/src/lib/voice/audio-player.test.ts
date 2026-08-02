import { describe, expect, it, vi } from "vitest";
import { StreamingAudioPlayer } from "./audio-player";

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
});
