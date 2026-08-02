import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmMemory, extractMemory } from "./archive-client";
import { loadLocalArchive, resetLocalArchive } from "./local-repository";
import { DEMO_TRANSCRIPT, createDemoExtraction } from "./seed";

afterEach(() => vi.unstubAllGlobals());

describe("live archive failure safety", () => {
  it("never injects the demo fixture when live extraction fails, even for the demo words", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(extractMemory(DEMO_TRANSCRIPT)).rejects.toThrow("remains unsaved");
    await expect(extractMemory("I remembered working at the library with Ana.")).rejects.toThrow("remains unsaved");
  });

  it("keeps a confirmed live draft unsaved when persistence fails", async () => {
    resetLocalArchive();
    const countBefore = loadLocalArchive().stories.length;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(confirmMemory({
      originalMemory: createDemoExtraction(),
      correctedMemory: createDemoExtraction(),
      transcript: DEMO_TRANSCRIPT,
      useBackend: true,
    })).rejects.toThrow("remains unsaved");
    expect(loadLocalArchive().stories).toHaveLength(countBefore);
  });
});
