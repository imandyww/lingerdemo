import type { VoiceSessionState } from "@/lib/voice";

const labels: Record<VoiceSessionState, string> = {
  disconnected: "Not connected",
  connecting: "Connecting",
  ready: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  saving: "Saving memory",
  paused: "Paused",
  interrupted: "Interrupted",
  ended: "Ended",
  error: "Needs attention",
};

export function StatusPill({ state, detail, compact = false }: { state: VoiceSessionState; detail?: string; compact?: boolean }) {
  return (
    <div className={`status-pill status-${state}${compact ? " status-compact" : ""}`} role="status" aria-live="polite">
      <span className="status-dot" aria-hidden="true" />
      <span><strong>{labels[state]}</strong>{!compact && detail ? <small>{detail}</small> : null}</span>
    </div>
  );
}
