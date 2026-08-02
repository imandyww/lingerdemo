"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useArchive } from "@/hooks/use-archive";
import { nextDemoPrompt } from "@/lib/archive/local-repository";
import type { GatheringPrompt } from "@/lib/archive/types";
import { speakOnceThen } from "@/lib/voice";
import { Dialog } from "./dialog";
import { ArrowIcon, MicIcon, PauseIcon, SparkIcon, StoryIcon, UsersIcon } from "./icons";

type GatheringState = "choosing" | "introducing" | "quiet";

export function GatheringScreen() {
  const router = useRouter();
  const { archive, warning } = useArchive({ preferBackend: true });
  const [promptId, setPromptId] = useState<string | null>(null);
  const [state, setState] = useState<GatheringState>("choosing");
  const [consentOpen, setConsentOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const stopSpeech = useRef<(() => void) | null>(null);

  useEffect(() => () => stopSpeech.current?.(), []);

  const prompt: GatheringPrompt | null = archive.gatheringPrompts.find((item) => item.id === promptId)
    ?? archive.gatheringPrompts[0]
    ?? null;

  function anotherQuestion() {
    setPromptId(nextDemoPrompt(archive, prompt?.id ?? null).id);
  }

  function startConversation() {
    setState("introducing");
    stopSpeech.current?.();
    stopSpeech.current = speakOnceThen(prompt?.prompt ?? "", () => setState("quiet"));
  }

  function preserveMemory() {
    if (!consent) return;
    window.sessionStorage.setItem("linger:recording-consent", "true");
    window.sessionStorage.setItem("linger:start-requested", "true");
    setConsentOpen(false);
    router.push("/conversation");
  }

  if (state === "introducing" || state === "quiet") {
    return (
      <main id="main-content" className="quiet-mode-page">
        <div className="quiet-field" aria-hidden="true"><span /><span /><span /></div>
        <header className="quiet-header">
          <div className="quiet-brand"><UsersIcon width="24" height="24" /><span>Family Gathering</span></div>
          <div className="recording-off" role="status"><span aria-hidden="true" /><strong>Recording is off</strong><small>Linger is not listening</small></div>
        </header>
        <section className="quiet-question" aria-live="polite">
          <p className="section-kicker">{state === "introducing" ? "Linger asks" : "Now it is your conversation"}</p>
          <h1>{prompt?.prompt}</h1>
          {state === "introducing" ? <div className="speaking-line"><i /><i /><i /><i /><i /></div> : <><div className="quiet-mark"><PauseIcon width="31" height="31" /></div><p>Linger is quiet now. Take your time with one another.</p></>}
        </section>
        <footer className="quiet-actions">
          <button className="button button-secondary" type="button" onClick={() => { stopSpeech.current?.(); setState("choosing"); }}>Resume AI</button>
          <button className="button button-primary" type="button" onClick={() => setConsentOpen(true)}><MicIcon width="22" height="22" /> Begin preserving a new memory</button>
        </footer>
        <Dialog open={consentOpen} title="Begin a new recording?" description="Linger is currently quiet and is not listening. Recording begins only after you confirm." onClose={() => setConsentOpen(false)}>
          <label className="consent-check" htmlFor="gathering-consent"><input id="gathering-consent" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span aria-hidden="true" /><strong>I consent to recording this new memory.</strong></label>
          <p className="privacy-note">Your voice and story will only be saved when you choose to save them.</p>
          <div className="dialog-actions"><button className="button button-secondary" type="button" onClick={() => setConsentOpen(false)}>Stay quiet</button><button className="button button-primary" type="button" disabled={!consent} onClick={preserveMemory}>Begin recording</button></div>
        </Dialog>
      </main>
    );
  }

  return (
    <main id="main-content" className="gathering-page">
      <header className="page-header gathering-header">
        <div><p className="eyebrow"><span /> Family Gathering mode</p><h1>One good question can open a room.</h1><p>Linger finds a thread from your family archive, introduces it once, then becomes quiet so the family can talk.</p></div>
        <div className="gathering-principle"><span className="principle-orbit"><i /><i /></span><p><strong>AI starts the conversation,</strong><br />then gets out of the way.</p></div>
      </header>
      {warning ? <div className="notice notice-offline compact-notice"><strong>Using questions saved on this device.</strong><p>{warning}</p></div> : null}
      {prompt ? (
        <div className="prompt-stage">
          <div className="prompt-stack" aria-hidden="true"><span /><span /></div>
          <article className="gathering-card">
            <header><span><SparkIcon width="20" height="20" />Suggested from your archive</span><span className={`sensitivity sensitivity-${prompt.sensitivityLevel}`}>{prompt.sensitivityLevel} sensitivity</span></header>
            <div className="prompt-quote"><span aria-hidden="true">“</span><h2>{prompt.prompt}</h2></div>
            <div className="prompt-context">
              <section><p className="section-kicker">Why it may matter</p><p>{prompt.rationale}</p></section>
              <section><p className="section-kicker">Source story</p><p><StoryIcon width="18" height="18" />{prompt.sourceStoryTitle}</p></section>
              {prompt.caution ? <section className="prompt-caution"><p className="section-kicker">A gentle caution</p><p>{prompt.caution}</p></section> : null}
            </div>
            <footer><button className="button button-secondary" type="button" onClick={anotherQuestion}><SparkIcon width="20" height="20" />Give us another question</button><button className="button button-primary" type="button" onClick={startConversation}>Start a family conversation <ArrowIcon width="21" height="21" /></button></footer>
          </article>
          <p className="recording-reminder"><span aria-hidden="true" /> Recording will remain off when the family conversation begins.</p>
        </div>
      ) : (
        <div className="empty-state gathering-empty"><UsersIcon width="42" height="42" /><h2>Save a story to make a family question.</h2><p>Questions are grounded in real memories, never invented family facts.</p><Link className="button button-primary" href="/conversation">Start a conversation</Link></div>
      )}
    </main>
  );
}
