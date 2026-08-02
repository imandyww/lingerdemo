import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendWebSocketVoiceProvider, createReplacementSessionConfig } from "./backend-provider";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("backend reconnect", () => {
  it("always replaces the globally unique session id while preserving consent", () => {
    const previous = {
      sessionId: "550e8400-e29b-41d4-a716-446655440000",
      language: "en-US",
      consentToRecord: true as const,
      retainAudio: false,
      mode: "backend" as const,
    };
    const replacement = createReplacementSessionConfig(previous);
    expect(replacement.sessionId).not.toBe(previous.sessionId);
    expect(replacement.consentToRecord).toBe(true);
    expect(replacement.retainAudio).toBe(false);
  });

  it("cannot reconnect after the user explicitly ends the session", async () => {
    vi.useFakeTimers();
    class FakeWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      static instances: FakeWebSocket[] = [];
      readyState = FakeWebSocket.CONNECTING;
      bufferedAmount = 0;
      binaryType = "blob";
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      sent: unknown[] = [];
      constructor(public readonly url: string) { FakeWebSocket.instances.push(this); }
      send(value: unknown) { this.sent.push(value); }
      open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
      close() { this.readyState = FakeWebSocket.CLOSED; this.onclose?.(); }
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const provider = new BackendWebSocketVoiceProvider();
    const starting = provider.startSession({
      sessionId: crypto.randomUUID(), language: "en-US", consentToRecord: true, retainAudio: false, mode: "backend",
    });
    FakeWebSocket.instances[0]?.open();
    await starting;
    const stopping = provider.stop({ saveTranscript: false });
    expect(FakeWebSocket.instances[0]?.readyState).toBe(FakeWebSocket.OPEN);
    await vi.runAllTimersAsync();
    await stopping;
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]?.readyState).toBe(FakeWebSocket.CLOSED);
    expect(FakeWebSocket.instances[0]?.sent.some((value) => typeof value === "string" && value.includes("session.stop"))).toBe(true);
  });
});
