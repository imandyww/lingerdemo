"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackendWebSocketVoiceProvider,
  MicrophoneCapture,
  MockRealtimeVoiceProvider,
  type AssistantTextEvent,
  type MicrophonePermission,
  type RealtimeVoiceProvider,
  type ScriptedVoiceProvider,
  type TranscriptEvent,
  type VoiceDiagnostics,
  type VoiceError,
  type VoiceSessionState,
} from "@/lib/voice";

export type ConversationTurn = {
  sessionId: string;
  turnId: number;
  user: string;
  assistant: string;
  corrected: boolean;
};

const emptyDiagnostics: VoiceDiagnostics = {
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

export function useVoiceSession(options: { forceMock?: boolean } = {}) {
  const useBackend = !options.forceMock && process.env.NEXT_PUBLIC_VOICE_PROVIDER === "backend";
  const provider = useMemo<RealtimeVoiceProvider>(
    () => (useBackend ? new BackendWebSocketVoiceProvider() : new MockRealtimeVoiceProvider()),
    [useBackend],
  );
  const microphone = useMemo(() => new MicrophoneCapture(), []);
  const [state, setState] = useState<VoiceSessionState>("disconnected");
  const [stateDetail, setStateDetail] = useState("Nothing is recording");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [partial, setPartial] = useState("");
  const [currentResponse, setCurrentResponse] = useState("");
  const [diagnostics, setDiagnostics] = useState(emptyDiagnostics);
  const [error, setError] = useState<VoiceError | null>(null);
  const [permission, setPermission] = useState<MicrophonePermission>("prompt");
  const [recording, setRecording] = useState(false);
  const [capturePaused, setCapturePaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"mock" | "unconfigured" | null>(useBackend ? null : "mock");
  const sessionRef = useRef<string | null>(null);
  const capturePausedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = [
      provider.onStateChange((event) => {
        if (event.sessionId && event.sessionId !== sessionRef.current) {
          if (sessionRef.current) {
            setPartial("");
            setCurrentResponse("");
            setError({
              code: "session_replaced",
              message: "The connection resumed in a new session. Earlier captions remain visible, but the live assistant no longer has that earlier context.",
              recoverable: true,
            });
          }
          sessionRef.current = event.sessionId;
          setSessionId(event.sessionId);
        }
        setState(event.state);
        setStateDetail(event.detail);
        if (event.authMode) setAuthMode(event.authMode);
        if (["paused", "ended", "error", "disconnected"].includes(event.state)) setRecording(false);
        if (event.state === "listening") setRecording(useBackend && !capturePausedRef.current);
      }),
      provider.onTranscript((event: TranscriptEvent) => {
        if (event.sessionId !== sessionRef.current) return;
        if (event.isFinal) {
          setPartial("");
          setTurns((current) => {
            const existing = current.find((turn) => turn.sessionId === event.sessionId && turn.turnId === event.turnId);
            if (existing) return current.map((turn) => (turn.sessionId === event.sessionId && turn.turnId === event.turnId ? { ...turn, user: event.text } : turn));
            return [...current, { sessionId: event.sessionId, turnId: event.turnId, user: event.text, assistant: "", corrected: false }];
          });
        } else {
          setPartial(event.text);
        }
      }),
      provider.onAssistantText((event: AssistantTextEvent) => {
        if (event.sessionId !== sessionRef.current) return;
        setCurrentResponse(event.text);
        setTurns((current) => {
          const exists = current.some((turn) => turn.sessionId === event.sessionId && turn.turnId === event.turnId);
          if (!exists) return [...current, { sessionId: event.sessionId, turnId: event.turnId, user: "", assistant: event.text, corrected: false }];
          return current.map((turn) => (turn.sessionId === event.sessionId && turn.turnId === event.turnId ? { ...turn, assistant: event.text } : turn));
        });
      }),
      provider.onDiagnostics(setDiagnostics),
      provider.onError(setError),
    ];
    return () => {
      for (const stop of unsubscribe) stop();
      microphone.stop();
      void provider.disconnect();
    };
  }, [microphone, provider, useBackend]);

  const start = useCallback(
    async (language = "en-US") => {
      const id = crypto.randomUUID();
      sessionRef.current = id;
      setSessionId(id);
      setError(null);
      capturePausedRef.current = false;
      setCapturePaused(false);
      await provider.startSession({
        sessionId: id,
        language,
        consentToRecord: true,
        retainAudio: false,
        mode: useBackend ? "backend" : "mock",
        speechSynthesis: false,
      });
      if (useBackend) {
        microphone.onChunk((chunk) => void provider.sendAudio(chunk).catch(() => {
          setError({ code: "audio_upload_failed", message: "Audio could not be sent. Pause and check the connection.", recoverable: true });
        }));
        const microphonePermission = await microphone.start();
        setPermission(microphonePermission);
        setRecording(microphonePermission === "granted");
        if (microphonePermission !== "granted") {
          setError({
            code: "microphone_unavailable",
            message: "Microphone access is unavailable. You can use the guided demo without it.",
            recoverable: true,
          });
        }
      } else {
        setPermission(await microphone.permission());
        setRecording(false);
      }
    },
    [microphone, provider, useBackend],
  );

  const advanceScript = useCallback(async () => {
    if (!(provider instanceof MockRealtimeVoiceProvider)) return { complete: false, step: 0 };
    return (provider as ScriptedVoiceProvider).advanceScript();
  }, [provider]);

  const pause = useCallback(async () => {
    capturePausedRef.current = true;
    setCapturePaused(true);
    microphone.pause();
    setRecording(false);
    await provider.pause();
  }, [microphone, provider]);

  const resume = useCallback(async () => {
    capturePausedRef.current = false;
    setCapturePaused(false);
    microphone.resume();
    setRecording(useBackend);
    await provider.resume();
  }, [microphone, provider, useBackend]);

  const interrupt = useCallback(async () => provider.interrupt(), [provider]);

  const stop = useCallback(
    async (saveTranscript = false) => {
      microphone.stop();
      capturePausedRef.current = false;
      setCapturePaused(false);
      setRecording(false);
      await provider.stop({ saveTranscript });
    },
    [microphone, provider],
  );

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      provider.setPlaybackMuted(!current);
      return !current;
    });
  }, [provider]);

  const addCorrection = useCallback((turnId: number, correction: string) => {
    setTurns((current) => current.map((turn, index) => (turn.turnId === turnId && index === current.length - 1 ? { ...turn, user: correction, corrected: true } : turn)));
  }, []);

  return {
    provider,
    useBackend,
    sessionId,
    authMode,
    state,
    stateDetail,
    turns,
    partial,
    currentResponse,
    diagnostics,
    error,
    permission,
    recording,
    capturePaused,
    muted,
    start,
    pause,
    resume,
    interrupt,
    stop,
    toggleMute,
    addCorrection,
    advanceScript,
  };
}
