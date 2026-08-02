"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useVoiceSession } from "@/hooks/use-voice-session";
import { confirmMemory, extractMemory } from "@/lib/archive/archive-client";
import { normalizeReviewedMemory, setPrimaryEventDate } from "@/lib/archive/review-memory";
import type { ExtractedMemory } from "@/lib/archive/types";
import { Dialog } from "./dialog";
import { ArrowIcon, CheckIcon, MicIcon, PauseIcon, PencilIcon, PlayIcon, SparkIcon, StopIcon, VolumeOffIcon } from "./icons";
import { StatusPill } from "./status-pill";
import { Waveform } from "./waveform";

export function ConversationScreen() {
  const voice = useVoiceSession();
  const [hasConsent, setHasConsent] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [dialOn, setDialOn] = useState(false);
  const [dialBusy, setDialBusy] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [correctionTurn, setCorrectionTurn] = useState<number | null>(null);
  const [correction, setCorrection] = useState("");
  const [scriptBusy, setScriptBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewState, setReviewState] = useState<"extracting" | "review" | "saving" | "saved" | "error">("extracting");
  const [reviewOriginal, setReviewOriginal] = useState<ExtractedMemory | null>(null);
  const [reviewDraft, setReviewDraft] = useState<ExtractedMemory | null>(null);
  const [reviewTranscript, setReviewTranscript] = useState("");
  const [reviewNotice, setReviewNotice] = useState("");
  const [reviewSharing, setReviewSharing] = useState<"private" | "family">("private");
  const [draftKept, setDraftKept] = useState(false);
  const reviewRequestGeneration = useRef(0);

  async function begin() {
    if (dialBusy) return;
    if (!consentChecked) {
      setAnnouncement("Choose the listening consent checkbox before switching Linger on.");
      document.querySelector<HTMLInputElement>("#recording-consent")?.focus();
      return;
    }
    setDialBusy(true);
    window.sessionStorage.setItem("linger:recording-consent", "true");
    window.sessionStorage.setItem("linger:language", "en-US");
    try {
      await voice.start("en-US");
      setHasConsent(true);
      setDialOn(true);
      setAnnouncement("Linger is listening. Select the speaker grille to show live captions.");
    } catch (error) {
      setAnnouncement(error instanceof Error ? error.message : "The voice session could not start.");
    } finally {
      setDialBusy(false);
    }
  }

  async function switchOff() {
    if (dialBusy) return;
    setDialBusy(true);
    try {
      await voice.stop(false);
      setDialOn(false);
      setAnnouncement("Voice session off. The unsaved transcript remains visible until you leave this page.");
    } finally {
      setDialBusy(false);
    }
  }

  function toggleDial() {
    void (dialOn ? switchOff() : begin());
  }

  async function speakNext() {
    setScriptBusy(true);
    try {
      await voice.advanceScript();
    } finally {
      setScriptBusy(false);
    }
  }

  function openCorrection() {
    const latest = voice.turns.at(-1);
    if (!latest) return;
    setCorrectionTurn(latest.turnId);
    setCorrection(latest.user);
    setCorrectionOpen(true);
  }

  async function endAndReview() {
    const transcript = voice.turns
      .flatMap((turn) => [turn.user ? `Speaker: ${turn.user}` : "", turn.assistant ? `Linger: ${turn.assistant}` : ""])
      .filter(Boolean)
      .join("\n\n");
    await voice.stop(false);
    setDialOn(false);
    setEndOpen(false);
    setReviewOpen(true);
    setReviewState("extracting");
    setReviewOriginal(null);
    setReviewDraft(null);
    setDraftKept(false);
    setReviewSharing("private");
    setReviewTranscript(transcript);
    if (!transcript) {
      setReviewNotice("There is no finalized transcript to review. End without saving or begin a new conversation.");
      setReviewState("error");
      return;
    }
    await runExtraction(transcript);
  }

  async function runExtraction(transcript: string) {
    const generation = ++reviewRequestGeneration.current;
    setReviewState("extracting");
    try {
      const result = await extractMemory(transcript);
      if (generation !== reviewRequestGeneration.current) return;
      setReviewOriginal(structuredClone(result.value.memory));
      setReviewDraft(structuredClone(result.value.memory));
      setReviewNotice(result.warning ?? "");
      setReviewState("review");
    } catch (error) {
      if (generation !== reviewRequestGeneration.current) return;
      setReviewNotice(error instanceof Error ? error.message : "Memory extraction is unavailable. The transcript remains unsaved.");
      setReviewState("error");
    }
  }

  async function saveReviewedMemory() {
    if (!reviewDraft || !reviewOriginal) return;
    setReviewState("saving");
    try {
      const correctedMemory = normalizeReviewedMemory(reviewDraft);
      const result = await confirmMemory({
        originalMemory: reviewOriginal,
        correctedMemory,
        transcript: reviewTranscript,
        useBackend: true,
        sharing: reviewSharing,
      });
      setReviewNotice(result.warning ?? "Saved to the family archive.");
      setReviewState("saved");
    } catch (error) {
      setReviewNotice(error instanceof Error ? error.message : "The reviewed memory remains unsaved. Retry when connected.");
      setDraftKept(true);
      setReviewState("review");
    }
  }

  async function discardReview() {
    reviewRequestGeneration.current += 1;
    if (reviewState === "saved") {
      setReviewOpen(false);
      return;
    }
    setReviewOpen(false);
    setReviewOriginal(null);
    setReviewDraft(null);
    setReviewTranscript("");
    setDraftKept(false);
  }

  function exportReviewTranscript() {
    const url = URL.createObjectURL(new Blob([reviewTranscript], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "linger-unsaved-transcript.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  const sessionActive = dialOn && !["ended", "disconnected", "error"].includes(voice.state);
  const displayedState = voice.capturePaused ? "paused" : voice.state;
  const sessionStatus = dialBusy ? (dialOn ? "Switching off…" : "Opening conversation…") : dialOn ? voice.stateDetail : "Voice session off";
  return (
    <main id="main-content" className={`conversation-page radio-conversation-page ${dialOn ? "session-on" : "session-off"}`}>
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
                <button className="radio-dial" type="button" role="switch" aria-checked={dialOn} aria-label={dialOn ? "Switch voice session off" : "Switch voice session on"} aria-describedby="radio-session-status start-help" disabled={dialBusy} onClick={toggleDial}>
                  <span className="radio-dial-notch" aria-hidden="true" />
                  <span className="sr-only">{dialOn ? "On" : "Off"}</span>
                </button>
                <span className="radio-off" aria-hidden="true">Off</span>
                <span className="radio-on" aria-hidden="true">On</span>
              </div>
            </div>
            <button className="radio-speaker radio-transcript-toggle" type="button" aria-expanded={transcriptOpen} aria-controls="radio-transcript" onClick={() => setTranscriptOpen((open) => !open)}>
              <span className="sr-only">{transcriptOpen ? "Hide live transcript" : "Show live transcript"}</span>
              <span className="radio-speaker-hint" aria-hidden="true">{transcriptOpen ? "Hide captions" : "Press for captions"}</span>
              <span className="radio-leaf" aria-hidden="true">◇</span>
            </button>
          </div>
          <div className="radio-state" id="radio-session-status" role="status"><span aria-hidden="true" /><strong>{sessionStatus}</strong></div>
          <p id="start-help" className="start-help">Turn on to talk · press the speaker for captions</p>
        </div>
        <label className="radio-consent" htmlFor="recording-consent">
          <input id="recording-consent" type="checkbox" checked={consentChecked} disabled={dialOn || dialBusy} onChange={(event) => setConsentChecked(event.target.checked)} />
          <span aria-hidden="true" />
          <strong>I’m ready for Linger to listen while the radio is on.</strong>
        </label>
        <p className="one-screen-privacy">Nothing is saved when you switch off.</p>
      </section>

      {transcriptOpen ? <TranscriptPanel turns={voice.turns} partial={voice.partial} /> : null}

      {hasConsent ? <div className="root-conversation-workspace">
      <header className="conversation-header">
        <div>
          <p className="section-kicker">Conversation with Mei</p>
          <h1>Take all the time you need.</h1>
        </div>
        <div className={`recording-indicator ${voice.recording ? "is-recording" : ""}`} role="status">
          <span aria-hidden="true" />
          <strong>{voice.recording ? "Recording" : voice.useBackend ? "Not recording" : "Local simulation"}</strong>
          <small>{voice.useBackend ? "Audio is not retained" : "Microphone audio is not captured"}</small>
        </div>
      </header>
      <div className="mock-auth-banner" role="status">
        <span>{voice.useBackend ? "Backend identity" : "Local demo"}</span>
        <strong>{voice.authMode === "mock" ? "Mock family identity · no application sign-in" : voice.authMode === "unconfigured" ? "Authentication is not configured" : "Checking authentication mode…"}</strong>
        <small>{voice.useBackend ? "This development service is not a production family account." : "This scripted session captures no microphone audio and stays on this device."}</small>
      </div>

      {voice.error ? (
        <div className="notice notice-error" role="alert"><strong>{voice.error.code === "microphone_unavailable" ? "Microphone unavailable" : "Conversation needs attention"}</strong><p>{voice.error.message}</p><Link href="/demo">Open the no-microphone demo</Link></div>
      ) : null}
      {!reviewOpen && reviewDraft && draftKept && reviewState !== "saved" ? <div className="notice notice-offline" role="status"><SparkIcon width="22" height="22" /><div><strong>Unsaved memory draft</strong><p>You chose to keep this draft on the page. It is not in the family archive.</p></div><button type="button" onClick={() => setReviewOpen(true)}>Continue review</button></div> : null}

      <div className="conversation-layout">
        <section className="listening-stage" aria-labelledby="current-response-heading">
          <StatusPill state={displayedState} detail={voice.capturePaused ? "Microphone capture remains paused" : voice.stateDetail} />
          <div className={`listening-orb listening-${displayedState}`} aria-hidden="true"><span /><span /><span /><MicIcon width="44" height="44" /></div>
          <Waveform state={displayedState} />
          <div className="current-utterance" aria-live="polite">
            <p className="speaker-label">{voice.state === "speaking" ? "Linger" : voice.partial ? "You, live" : "Linger"}</p>
            <h2 id="current-response-heading">{voice.state === "speaking" && voice.currentResponse ? voice.currentResponse : voice.partial || voice.currentResponse || "I’m here. Begin wherever the memory begins."}</h2>
          </div>
          {!voice.useBackend && sessionActive ? (
            <button className="button button-primary mock-speak-button" type="button" disabled={scriptBusy || voice.state === "paused"} onClick={() => void speakNext()}>
              <MicIcon width="22" height="22" /> {scriptBusy ? "Listening…" : "Simulate next spoken line"}
            </button>
          ) : null}
          <div className="conversation-controls" aria-label="Conversation controls">
            <button type="button" onClick={() => void (voice.capturePaused ? voice.resume() : voice.pause())} disabled={!sessionActive}>
              {voice.capturePaused ? <PlayIcon width="23" height="23" /> : <PauseIcon width="23" height="23" />}
              <span>{voice.capturePaused ? "Resume" : "Pause"}</span>
            </button>
            <button type="button" onClick={() => void voice.interrupt()} disabled={!sessionActive || voice.state === "listening"}>
              <StopIcon width="23" height="23" /><span>Interrupt</span>
            </button>
            <button type="button" aria-pressed={voice.muted} onClick={voice.toggleMute}>
              <VolumeOffIcon width="23" height="23" /><span>{voice.muted ? "Unmute" : "Mute voice"}</span>
            </button>
            <button type="button" onClick={openCorrection} disabled={voice.turns.length === 0}>
              <PencilIcon width="23" height="23" /><span>Add correction</span>
            </button>
            <button className="end-control" type="button" onClick={() => setEndOpen(true)}>
              <StopIcon width="23" height="23" /><span>End</span>
            </button>
          </div>
        </section>

      </div>

      <Dialog open={correctionOpen} title="Correct what Linger heard" description="This local correction replaces the text used when you review and extract a memory. It does not rewrite an answer already sent to the live assistant." onClose={() => setCorrectionOpen(false)}>
        <label className="field"><span>What you said</span><textarea rows={5} value={correction} onChange={(event) => setCorrection(event.target.value)} /></label>
        <div className="dialog-actions"><button className="button button-secondary" type="button" onClick={() => setCorrectionOpen(false)}>Cancel</button><button className="button button-primary" type="button" onClick={() => { if (correctionTurn !== null) voice.addCorrection(correctionTurn, correction.trim()); setCorrectionOpen(false); }}>Save correction</button></div>
      </Dialog>

      <Dialog open={endOpen} title="End this conversation?" description="The microphone will stop immediately. Nothing becomes a family story unless you review and save it." onClose={() => setEndOpen(false)}>
        <div className="end-options"><button className="button button-danger" type="button" onClick={() => { void switchOff(); setEndOpen(false); }}>End without saving</button><button className="button button-primary" type="button" onClick={() => void endAndReview()}>End and review transcript</button></div>
      </Dialog>

      <Dialog open={reviewOpen} title={reviewState === "saved" ? "Memory saved" : "Review this memory"} description={reviewState === "saved" ? "The reviewed story is now available in the family archive." : "The extraction result exists only in this open page and is not a family story. Check every detail, then save, explicitly keep it on this page, or discard it."} onClose={() => void discardReview()}>
        {reviewState === "extracting" ? <div className="inline-review-state" aria-live="polite"><span className="mini-spinner" /><strong>Finding the people, place, and open thread…</strong><p>Only finalized and corrected transcript text is being reviewed.</p></div> : null}
        {reviewState === "error" ? <div><div className="notice notice-error" role="alert"><strong>Memory not extracted</strong><p>{reviewNotice}</p></div>{reviewTranscript ? <div className="dialog-actions"><button className="button button-secondary" type="button" onClick={exportReviewTranscript}>Export unsaved transcript</button><button className="button button-primary" type="button" onClick={() => void runExtraction(reviewTranscript)}>Retry extraction</button></div> : null}</div> : null}
        {(reviewState === "review" || reviewState === "saving") && reviewDraft ? (
          <form onSubmit={(event) => { event.preventDefault(); void saveReviewedMemory(); }}>
            {reviewNotice ? <div className="notice notice-offline compact-notice"><SparkIcon width="20" height="20" /><p>{reviewNotice}</p></div> : null}
            <label className="field"><span>Story title</span><input required value={reviewDraft.suggestedTitle} onChange={(event) => setReviewDraft({ ...reviewDraft, suggestedTitle: event.target.value })} /></label>
            <label className="field"><span>Summary</span><textarea required rows={4} value={reviewDraft.summary} onChange={(event) => setReviewDraft({ ...reviewDraft, summary: event.target.value })} /></label>
            {reviewDraft.people.map((person, index) => <div className="field-row" key={`${index}-${person.name}`}><label className="field"><span>Person {index + 1}</span><input value={person.name} onChange={(event) => setReviewDraft({ ...reviewDraft, people: reviewDraft.people.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} /></label><label className="field"><span>Relationship</span><input value={person.relationship} onChange={(event) => setReviewDraft({ ...reviewDraft, people: reviewDraft.people.map((item, itemIndex) => itemIndex === index ? { ...item, relationship: event.target.value } : item) })} /></label><button className="field-remove" type="button" onClick={() => setReviewDraft({ ...reviewDraft, people: reviewDraft.people.filter((_, itemIndex) => itemIndex !== index) })}>Remove person</button></div>)}
            <button className="field-add" type="button" onClick={() => setReviewDraft({ ...reviewDraft, people: [...reviewDraft.people, { name: "", relationship: "", aliases: [], confidence: 1 }] })}>+ Add a person</button>
            <div className="field-row"><label className="field"><span>Place <small>optional</small></span><input value={reviewDraft.places[0]?.name ?? ""} onChange={(event) => setReviewDraft({ ...reviewDraft, places: event.target.value ? [{ name: event.target.value, confidence: reviewDraft.places[0]?.confidence ?? 1 }] : [] })} /></label><label className="field"><span>Approximate date <small>optional</small></span><input value={reviewDraft.events[0]?.approximateDate ?? ""} onChange={(event) => setReviewDraft(setPrimaryEventDate(reviewDraft, event.target.value))} /></label></div>
            <label className="field"><span>Unresolved question <small>optional</small></span><input value={reviewDraft.unresolvedQuestions[0] ?? ""} onChange={(event) => setReviewDraft({ ...reviewDraft, unresolvedQuestions: event.target.value ? [event.target.value] : [] })} /></label>
            <label className="field"><span>Who can see the saved story</span><select value={reviewSharing} onChange={(event) => setReviewSharing(event.target.value as "private" | "family")}><option value="private">Only me (default)</option><option value="family">Share with family</option></select></label>
            <div className="review-consent"><CheckIcon width="21" height="21" /><p><strong>Saving is your explicit choice.</strong><br />Audio will not be retained; the story stays private unless you choose family sharing.</p></div>
            <div className="dialog-actions"><button className="button button-danger" type="button" onClick={() => void discardReview()}>Discard draft</button><button className="button button-secondary" type="button" onClick={() => { setDraftKept(true); setReviewOpen(false); }}>Keep unsaved on this page</button><button className="button button-primary" type="submit" disabled={reviewState === "saving"}>{reviewState === "saving" ? "Saving…" : "Confirm and save story"}</button></div>
          </form>
        ) : null}
        {reviewState === "saved" ? <div className="inline-saved-state"><span><CheckIcon width="33" height="33" /></span><p>{reviewNotice}</p><Link className="button button-primary" href="/archive" onClick={() => setReviewOpen(false)}>View family archive <ArrowIcon width="20" height="20" /></Link></div> : null}
      </Dialog>
      </div> : null}
      <p className="sr-announcement" aria-live="assertive">{announcement}</p>
    </main>
  );
}

function TranscriptPanel({ turns, partial }: { turns: ReturnType<typeof useVoiceSession>["turns"]; partial: string }) {
  return (
    <aside id="radio-transcript" className="transcript-panel radio-transcript-panel" aria-labelledby="transcript-heading">
      <div className="panel-heading"><div><p className="section-kicker">Captions</p><h2 id="transcript-heading">Conversation transcript</h2></div><span>{turns.length} turns</span></div>
      {turns.length === 0 && !partial ? <div className="empty-state compact"><MicIcon width="28" height="28" /><h3>Your words will appear here.</h3><p>Turn on the radio when you are ready. Live captions are not saved unless you review the memory.</p></div> : <ol className="transcript-list">{turns.map((turn) => <li key={`${turn.sessionId}-${turn.turnId}`}>{turn.user ? <div className="transcript-entry user-entry"><span>You</span><p>{turn.user}</p>{turn.corrected ? <small>Corrected</small> : null}</div> : null}{turn.assistant ? <div className="transcript-entry assistant-entry"><span>Linger</span><p>{turn.assistant}</p></div> : null}</li>)}{partial ? <li><div className="transcript-entry user-entry partial-entry"><span>You, live</span><p>{partial}<i aria-hidden="true" /></p></div></li> : null}</ol>}
    </aside>
  );
}
