import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_SCRIPT, MockRealtimeVoiceProvider } from "./mock-provider";

afterEach(() => vi.useRealTimers());

describe("MockRealtimeVoiceProvider", () => {
  it("emits realistic partials but exactly one final transcript for the first scripted turn", async () => {
    vi.useFakeTimers();
    const provider = new MockRealtimeVoiceProvider();
    const transcripts: { text: string; isFinal: boolean }[] = [];
    const responses: string[] = [];
    provider.onTranscript((event) => transcripts.push(event));
    provider.onAssistantText((event) => { if (event.isFinal) responses.push(event.text); });
    const start = provider.startSession({ sessionId: crypto.randomUUID(), language: "en-US", consentToRecord: true, retainAudio: false, mode: "demo" });
    await vi.runAllTimersAsync();
    await start;
    const advance = provider.advanceScript();
    await vi.runAllTimersAsync();
    await advance;
    expect(transcripts.filter((event) => event.isFinal)).toHaveLength(1);
    expect(transcripts.find((event) => event.isFinal)).toMatchObject({ text: DEMO_SCRIPT[0]?.user, isFinal: true });
    expect(transcripts.some((event) => !event.isFinal)).toBe(true);
    expect(responses).toEqual(["Who was with you?"]);
  });

  it("cancels a pending scripted callback on interruption", async () => {
    vi.useFakeTimers();
    const provider = new MockRealtimeVoiceProvider();
    const finals: string[] = [];
    provider.onTranscript((event) => { if (event.isFinal) finals.push(event.text); });
    const start = provider.startSession({ sessionId: crypto.randomUUID(), language: "en-US", consentToRecord: true, retainAudio: false, mode: "demo" });
    await vi.runAllTimersAsync();
    await start;
    const advancing = provider.advanceScript();
    const interrupting = provider.interrupt();
    await vi.runAllTimersAsync();
    await interrupting;
    await advancing;
    expect(finals).toEqual([]);
  });
});
