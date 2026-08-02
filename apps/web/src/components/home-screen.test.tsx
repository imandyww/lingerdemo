import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeScreen } from "./home-screen";

const { voice } = vi.hoisted(() => ({
  voice: {
    useBackend: false,
    sessionId: null,
    authMode: "mock" as const,
    state: "disconnected" as const,
    stateDetail: "Nothing is recording",
    turns: [] as Array<{ sessionId: string; turnId: number; user: string; assistant: string; corrected: boolean }>,
    partial: "",
    currentResponse: "",
    diagnostics: { correlationId: "test", uploadLatencyMs: null, firstPartialMs: null, finalTranscriptMs: null, firstTokenMs: null, firstAudioMs: null, speechToSpeechMs: null, cancellationMs: null, queueDepth: 0, droppedEvents: 0, reconnects: 0 },
    error: null,
    permission: "prompt" as const,
    recording: false,
    capturePaused: false,
    muted: false,
    start: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    toggleMute: vi.fn(),
    addCorrection: vi.fn(),
    advanceScript: vi.fn(async () => ({ complete: false, step: 1 })),
  },
}));

vi.mock("@/hooks/use-voice-session", () => ({ useVoiceSession: () => voice }));

describe("HomeScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    voice.turns = [];
    voice.partial = "";
  });

  afterEach(cleanup);

  it("starts the voice session on the root screen after consent", async () => {
    render(<HomeScreen />);

    fireEvent.click(screen.getByRole("checkbox", { name: "I’m ready for Linger to listen while the radio is on." }));
    fireEvent.click(screen.getByRole("switch", { name: "Switch voice session on" }));

    await waitFor(() => expect(voice.start).toHaveBeenCalledWith("en-US"));
    expect(window.location.pathname).toBe("/");
    expect(await screen.findByRole("switch", { name: "Switch voice session off" })).toBeChecked();
    expect(screen.getByRole("heading", { name: "Take all the time you need." })).toBeVisible();
  });

  it("does not start without consent", () => {
    render(<HomeScreen />);
    fireEvent.click(screen.getByRole("switch", { name: "Switch voice session on" }));
    expect(screen.getByRole("checkbox")).toHaveFocus();
    expect(voice.start).not.toHaveBeenCalled();
  });

  it("opens the live transcript from the speaker grille", () => {
    voice.turns = [{ sessionId: "session-1", turnId: 1, user: "The rain reminded me of home.", assistant: "What happened next?", corrected: false }];
    render(<HomeScreen />);

    const speaker = screen.getByRole("button", { name: "Show live transcript" });
    fireEvent.click(speaker);
    expect(screen.getByRole("heading", { name: "Conversation transcript" })).toBeVisible();
    expect(screen.getByText("The rain reminded me of home.")).toBeVisible();
    expect(screen.getByText("What happened next?")).toBeVisible();
    expect(screen.getByRole("button", { name: "Hide live transcript" })).toHaveAttribute("aria-expanded", "true");
  });
});
