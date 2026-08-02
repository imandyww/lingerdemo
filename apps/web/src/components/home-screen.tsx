"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowIcon, MicIcon, ShieldIcon, WifiIcon } from "./icons";
import { checkBackend } from "@/lib/archive/archive-client";
import { MicrophoneCapture, type MicrophonePermission } from "@/lib/voice";

const permissionLabels: Record<MicrophonePermission, string> = {
  prompt: "Asked when you begin",
  granted: "Microphone available",
  denied: "Microphone blocked — demo still works",
  unsupported: "No microphone — demo still works",
};

export function HomeScreen() {
  const router = useRouter();
  const [consent, setConsent] = useState(false);
  const [permission, setPermission] = useState<MicrophonePermission>("prompt");
  const [backend, setBackend] = useState<"checking" | "online" | "offline">("checking");
  const [announcement, setAnnouncement] = useState("");
  const liveVoiceSelected = process.env.NEXT_PUBLIC_VOICE_PROVIDER === "backend";

  useEffect(() => {
    const microphone = new MicrophoneCapture();
    void microphone.permission().then(setPermission);
    void checkBackend().then(setBackend);
  }, []);

  function startConversation() {
    if (!consent) {
      setAnnouncement("Choose the recording consent checkbox before starting.");
      document.querySelector<HTMLInputElement>("#recording-consent")?.focus();
      return;
    }
    window.sessionStorage.setItem("linger:recording-consent", "true");
    window.sessionStorage.setItem("linger:language", "en-US");
    window.sessionStorage.setItem("linger:start-requested", "true");
    router.push("/conversation");
  }

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

        <div className="start-panel" aria-label="Start a conversation">
          <button className="listening-button" type="button" onClick={startConversation} aria-describedby="start-help">
            <span className="listening-ring ring-one" aria-hidden="true" />
            <span className="listening-ring ring-two" aria-hidden="true" />
            <span className="listening-center"><MicIcon width="34" height="34" /><strong>Start talking</strong><small>Nothing begins until you press</small></span>
          </button>
          <p id="start-help" className="start-help">Take your time. Pauses are welcome.</p>
        </div>
      </section>

      <section className="home-settings" aria-labelledby="ready-heading">
        <div className="settings-intro">
          <p className="section-kicker">Before we begin</p>
          <h2 id="ready-heading">You are always in control.</h2>
        </div>
        <div className="consent-box">
          <label className="consent-check" htmlFor="recording-consent">
            <input id="recording-consent" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span aria-hidden="true" />
            <strong>I am ready for Linger to listen during this conversation.</strong>
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
