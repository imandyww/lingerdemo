"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function HomeScreen() {
  const router = useRouter();
  const [consent, setConsent] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [dialOn, setDialOn] = useState(false);
  const [dialBusy, setDialBusy] = useState(false);

  function startVoiceSession() {
    if (dialBusy) return;
    if (!consent) {
      setAnnouncement("Choose the listening consent checkbox before switching Linger on.");
      document.querySelector<HTMLInputElement>("#recording-consent")?.focus();
      return;
    }

    setDialBusy(true);
    setDialOn(true);
    setAnnouncement("Opening the voice conversation.");
    window.sessionStorage.setItem("linger:recording-consent", "true");
    window.sessionStorage.setItem("linger:language", "en-US");
    window.sessionStorage.setItem("linger:start-requested", "true");
    router.push("/conversation");
  }

  const sessionStatus = dialBusy ? "Opening conversation…" : "Voice session off";

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
                  onClick={startVoiceSession}
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
