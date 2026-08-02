import type { VoiceSessionState } from "@/lib/voice";

const heights = [18, 31, 43, 25, 56, 37, 68, 45, 78, 53, 66, 39, 58, 29, 46, 22, 34, 18];

export function Waveform({ state, label = "Audio activity" }: { state: VoiceSessionState; label?: string }) {
  const active = state === "listening" || state === "speaking" || state === "thinking";
  return (
    <div className={`waveform waveform-${state}`} role="img" aria-label={`${label}: ${state}`}>
      {heights.map((height, index) => (
        <span
          key={`${height}-${index}`}
          style={{ "--bar-height": `${active ? height : 12}px`, "--bar-delay": `${index * -52}ms` } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
