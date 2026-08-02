"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowIcon, MicIcon, ShieldIcon, WifiIcon } from "./icons";
import { checkBackend } from "@/lib/archive/archive-client";
import { MicrophoneCapture, type MicrophonePermission } from "@/lib/voice";
import { useVoiceSession } from "@/hooks/use-voice-session";

const permissionLabels: Record<MicrophonePermission, string> = {
  prompt: "Asked when you begin",
  granted: "Microphone available",
  denied: "Microphone blocked — demo still works",
  unsupported: "No microphone — demo still works",
};

export function HomeScreen() {
  const voice = useVoiceSession();
  const [consent, setConsent] = useState(false);
  const [permission, setPermission] = useState<MicrophonePermission>("prompt");
  const [backend, setBackend] = useState<"checking" | "online" | "offline">("checking");
  const [announcement, setAnnouncement] = useState("");
  const [dialOn, setDialOn] = useState(false);
  const [dialBusy, setDialBusy] = useState(false);
  const liveVoiceSelected = process.env.NEXT_PUBLIC_VOICE_PROVIDER === "backend";

  useEffect(() => {
    const microphone = new MicrophoneCapture();
    void microphone.permission().then(setPermission);
    void checkBackend().then(setBackend);
  }, []);

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
    <main id="main-content" className="home-page">
      <div className="home-ambient" aria-hidden="true"><span /><span /><span /></div>
      <section className="home-hero" aria-labelledby="home-heading">
        <div className="hero-copy">
          <p className="eyebrow"><span /> A listening room for family stories</p>
          <h1 id="home-heading">Some stories only arrive <em>once.</em></h1>
          <p className="hero-lede">Share a memory. We will help you keep it.</p>
          <p className="hero-support">Linger listens for the people, places, and small details worth passing on—then asks one thoughtful question at a time.</p>
          <div className="home-trust-line">
            <ShieldIcon width="22" height="22" />
            <p>Your voice and story will only be saved when you choose to save them.</p>
          </div>
        </div>

        <div className={`start-panel radio-cabinet ${dialOn ? "is-on" : "is-off"}`} aria-label="Voice session radio">
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
          <p id="start-help" className="start-help">Turn the dial on to begin. Turn it off to stop without saving.</p>
          {voice.error ? <p className="radio-error" role="alert">{voice.error.message}</p> : null}
        </div>
      </section>

      <section className="home-settings" aria-labelledby="ready-heading">
        <div className="settings-intro">
          <p className="section-kicker">Before we begin</p>
          <h2 id="ready-heading">You are always in control.</h2>
        </div>
        <div className="consent-box">
          <label className="consent-check" htmlFor="recording-consent">
            <input id="recording-consent" type="checkbox" checked={consent} disabled={dialOn || dialBusy} onChange={(event) => setConsent(event.target.checked)} />
            <span aria-hidden="true" />
            <strong>I am ready for Linger to listen while the radio is on.</strong>
          </label>
          <p>Audio is not kept by default. You can pause or end at any moment, and you will review every memory before it is saved.</p>
          <div className="language-row">
            <label htmlFor="language">Conversation language</label>
            <select id="language" value="en-US" disabled aria-describedby="language-support">
              <option value="en-US">English (US) · verified</option>
            </select>
            <small id="language-support">Additional languages require a configured voice provider.</small>
          </div>
        </div>
        <div className="readiness-list" aria-label="System readiness">
          <div><MicIcon width="24" height="24" /><span><strong>Microphone</strong><small>{permissionLabels[permission]}</small></span></div>
          <div><WifiIcon width="24" height="24" /><span><strong>Conversation service</strong><small>{liveVoiceSelected ? backend === "checking" ? "Checking backend and authentication mode…" : backend === "online" ? "Development backend reachable · identity mode shown when you start" : "Backend offline · guided demo available" : "Local mock voice · mock identity · no application sign-in"}</small></span></div>
          <Link href="/demo"><span><strong>No microphone?</strong><small>Try the guided demonstration</small></span><ArrowIcon width="21" height="21" /></Link>
        </div>
      </section>
      <p className="sr-announcement" aria-live="assertive">{announcement}</p>
    </main>
  );
}
