/** Optional mock-mode speech enhancement. The visual flow never depends on this API. */
export function speakOnceThen(text: string, onComplete: () => void): () => void {
  let active = true;
  let timeout = 0;
  const finish = () => {
    if (!active) return;
    active = false;
    window.clearTimeout(timeout);
    onComplete();
  };
  const estimatedMs = Math.min(12_000, Math.max(1_800, text.trim().split(/\s+/).length * 430));
  if (globalThis.speechSynthesis && globalThis.SpeechSynthesisUtterance) {
    globalThis.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.88;
    utterance.onend = finish;
    utterance.onerror = finish;
    globalThis.speechSynthesis.speak(utterance);
    timeout = window.setTimeout(finish, estimatedMs + 4_000);
  } else {
    timeout = window.setTimeout(finish, 900);
  }
  return () => {
    active = false;
    window.clearTimeout(timeout);
    globalThis.speechSynthesis?.cancel();
  };
}
