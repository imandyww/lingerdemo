"use client";

import { useState } from "react";
import { useVoiceSession } from "@/hooks/use-voice-session";

export function HomeScreen() {
  const voice = useVoiceSession();
  const [consent, setConsent] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [dialOn, setDialOn] = useState(false);
  const [dialBusy, setDialBusy] = useState(false);

  async function toggleVoiceSession() {
    if (dialBusy) return;
    if (!dialOn && !consent) {
      setAnnouncement("Choose the listening consent checkbox before switching Linger on.");
      document.querySelector<HTMLInputElement>("#recording-consent")?.focus();
      return;
    }

    setDialBusy(true);
    setAnnouncement("");
    try {
      if (dialOn) {
        await voice.stop(false);
        setDialOn(false);
        setAnnouncement("Voice session off. Nothing was saved.");
      } else {
        window.sessionStorage.setItem("linger:recording-consent", "true");
        window.sessionStorage.setItem("linger:language", "en-US");
        await voice.start("en-US");
        setDialOn(true);
        setAnnouncement("Voice session on. Linger is listening.");
      }
    } catch (error) {
      setDialOn(false);
      setAnnouncement(error instanceof Error ? error.message : "The voice session could not be changed.");
    } finally {
      setDialBusy(false);
    }
  }

  const sessionStatus = dialBusy
    ? dialOn ? "Switching off…" : "Warming up…"
    : dialOn
      ? voice.recording ? "Listening now" : voice.useBackend ? voice.stateDetail : "Local voice session on"
      : "Voice session off";

  return (
    <main id="main-content" className={`one-screen-home ${dialOn ? "session-on" : "session-off"}`}>
      <div className="one-screen-glow" aria-hidden="true" />
      <section className="radio-stage" aria-label="Linger voice session">
        <h1 className="sr-only">Linger voice session</h1>
        <div className={`radio-cabinet ${dialOn ? "is-on" : "is-off"}`} aria-label="Voice session radio">
          <div className="radio-face">
            <div className="radio-display">
              <div>
                <span className="radio-brand">Linger</span>
                <span className="radio-instruction">Share a memory.<br />We’ll help you keep it.</span>
              </div>
              <div className="radio-signal" aria-hidden="true">
                {[8, 15, 24, 34, 42, 34, 24, 15, 8].map((height, index) => <i key={index} style={{ height }} />)}
              </div>
              <div className="radio-dial-wrap">
                <button
                  className="radio-dial"
                  type="button"
                  role="switch"
                  aria-checked={dialOn}
                  aria-label={dialOn ? "Switch voice session off" : "Switch voice session on"}
                  aria-describedby="radio-session-status start-help"
                  disabled={dialBusy}
                  onClick={() => void toggleVoiceSession()}
                >
                  <span className="radio-dial-notch" aria-hidden="true" />
                  <span className="sr-only">{dialOn ? "On" : "Off"}</span>
                </button>
                <span className="radio-off" aria-hidden="true">Off</span>
                <span className="radio-on" aria-hidden="true">On</span>
              </div>
            </div>
            <div className="radio-speaker" aria-hidden="true"><span className="radio-leaf">◇</span></div>
          </div>
          <div className="radio-state" id="radio-session-status" role="status">
            <span aria-hidden="true" />
            <strong>{sessionStatus}</strong>
          </div>
          <p id="start-help" className="start-help">Turn on to talk · turn off to stop</p>
          {voice.error ? <p className="radio-error" role="alert">{voice.error.message}</p> : null}
        </div>
        <label className="radio-consent" htmlFor="recording-consent">
            <input id="recording-consent" type="checkbox" checked={consent} disabled={dialOn || dialBusy} onChange={(event) => setConsent(event.target.checked)} />
            <span aria-hidden="true" />
            <strong>I’m ready for Linger to listen while the radio is on.</strong>
        </label>
        <p className="one-screen-privacy">Nothing is saved when you switch off.</p>
      </section>
      <p className="sr-announcement" aria-live="assertive">{announcement}</p>
    </main>
  );
}
