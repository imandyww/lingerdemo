"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVoiceSession } from "@/hooks/use-voice-session";
import { mergeConfirmedMemory, persistLocalArchive, resetLocalArchive } from "@/lib/archive/local-repository";
import { DEMO_NEW_STORY_ID, DEMO_TRANSCRIPT, createDemoExtraction, getSeedArchive } from "@/lib/archive/seed";
import type { ArchiveSnapshot, ExtractedMemory } from "@/lib/archive/types";
import { speakOnceThen } from "@/lib/voice";
import { ArchiveView, type ArchiveTab } from "./archive-view";
import { ArrowIcon, CheckIcon, MicIcon, PauseIcon, SparkIcon, StoryIcon, TreeIcon, UsersIcon } from "./icons";
import { StatusPill } from "./status-pill";
import { Waveform } from "./waveform";

type DemoPhase =
  | "welcome"
  | "conversation"
  | "extracting"
  | "confirm"
  | "saving"
  | "saved"
  | "archive"
  | "timeline"
  | "tree"
  | "gathering"
  | "introducing"
  | "quiet";

const DEMO_STEPS = ["Start", "Conversation", "Extract", "Confirm", "Save", "Story", "Timeline", "Family tree", "Gathering", "Quiet"] as const;

function phaseStep(phase: DemoPhase): number {
  return {
    welcome: 1,
    conversation: 2,
    extracting: 3,
    confirm: 4,
    saving: 5,
    saved: 6,
    archive: 6,
    timeline: 7,
    tree: 8,
    gathering: 9,
    introducing: 10,
    quiet: 10,
  }[phase];
}

export function DemoExperience() {
  const voice = useVoiceSession({ forceMock: true });
  const [phase, setPhase] = useState<DemoPhase>("welcome");
  const [archive, setArchive] = useState<ArchiveSnapshot>(() => getSeedArchive());
  const [draft, setDraft] = useState<ExtractedMemory>(() => createDemoExtraction());
  const [busy, setBusy] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");
  const [quietRecordingConsent, setQuietRecordingConsent] = useState(false);
  const [demoSharing, setDemoSharing] = useState<"private" | "family">("private");
  const stopSpeech = useRef<(() => void) | null>(null);
  const phaseHeading = useRef<HTMLHeadingElement>(null);
  const previousPhase = useRef<DemoPhase>("welcome");
  const activeStep = phaseStep(phase);
  const newPrompt = archive.gatheringPrompts.find((prompt) => prompt.id === "prompt-ming");
  const conversationComplete = voice.turns.length >= 4;
  const dateWasCorrected = draft.events[0]?.approximateDate !== createDemoExtraction().events[0]?.approximateDate;
  const brotherName = draft.people.find((person) => person.relationship.toLowerCase().includes("brother"))?.name ?? draft.people[0]?.name ?? "the relative";
  const memoryDate = draft.events[0]?.approximateDate || "the new date";

  useEffect(() => () => stopSpeech.current?.(), []);
  useEffect(() => {
    if (previousPhase.current !== phase) {
      previousPhase.current = phase;
      phaseHeading.current?.focus({ preventScroll: true });
    }
  }, [phase]);

  const phaseAnnouncement = {
    welcome: "Demo ready. Start the conversation.",
    conversation: "Conversation step. Simulate each spoken line.",
    extracting: "Extracting the memory from the reviewed transcript.",
    confirm: "Confirmation step. Correct every extracted detail before saving.",
    saving: "Saving the confirmed memory.",
    saved: "Memory saved with consent.",
    archive: "Updated story archive.",
    timeline: "Updated family timeline.",
    tree: "Updated family tree.",
    gathering: "Generated Family Gathering question.",
    introducing: "Linger is introducing one family question.",
    quiet: "Linger is quiet and recording is off.",
  }[phase];

  const transcriptRows = useMemo(
    () => voice.turns.flatMap((turn) => [
      ...(turn.user ? [{ key: `${turn.turnId}-user`, speaker: "Mei", text: turn.user }] : []),
      ...(turn.assistant ? [{ key: `${turn.turnId}-assistant`, speaker: "Linger", text: turn.assistant }] : []),
    ]),
    [voice.turns],
  );

  async function startDemo() {
    setBusy(true);
    const fresh = resetLocalArchive();
    setArchive(fresh);
    setDraft(createDemoExtraction());
    setSaveNotice("");
    try {
      await voice.start("en-US");
      setPhase("conversation");
    } finally {
      setBusy(false);
    }
  }

  async function advanceConversation() {
    setBusy(true);
    try {
      await voice.advanceScript();
    } finally {
      setBusy(false);
    }
  }

  async function simulateExtraction() {
    setPhase("extracting");
    setBusy(true);
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    setDraft(createDemoExtraction());
    setBusy(false);
    setPhase("confirm");
  }

  async function saveMemory() {
    setPhase("saving");
    setBusy(true);
    const resultArchive = mergeConfirmedMemory(archive, draft, DEMO_TRANSCRIPT, demoSharing);
    persistLocalArchive(resultArchive);
    setSaveNotice("Saved locally for this credential-free demonstration.");
    setArchive(resultArchive);
    await new Promise((resolve) => window.setTimeout(resolve, 520));
    setBusy(false);
    setPhase("saved");
  }

  function showArchive(tab: ArchiveTab) {
    setPhase(tab === "stories" ? "archive" : tab);
  }

  function beginGathering() {
    setPhase("introducing");
    stopSpeech.current?.();
    stopSpeech.current = speakOnceThen(newPrompt?.prompt ?? "", () => setPhase("quiet"));
  }

  return (
    <main id="main-content" className={`demo-page demo-phase-${phase}`}>
      <header className="demo-header">
        <div><p className="eyebrow"><span /> Three-minute guided demonstration</p><h1>A story, caught before it disappears.</h1></div>
        <div className="demo-runtime"><span className="runtime-dot" /><strong>Credential-free demo · mock identity</strong><small>No application sign-in · deterministic local mode</small></div>
      </header>

      <nav className="demo-steps" aria-label="Demo progress">
        <ol>
          {DEMO_STEPS.map((step, index) => {
            const number = index + 1;
            return <li key={step} className={number < activeStep ? "is-complete" : number === activeStep ? "is-active" : ""} aria-current={number === activeStep ? "step" : undefined}><span>{number < activeStep ? <CheckIcon width="15" height="15" /> : number}</span><small>{step}</small></li>;
          })}
        </ol>
      </nav>
      <h2 ref={phaseHeading} className="sr-only" tabIndex={-1}>{phaseAnnouncement}</h2>
      <p className="sr-announcement" aria-live="polite">{phaseAnnouncement}</p>

      {phase === "welcome" ? (
        <section className="demo-welcome">
          <div className="demo-listening-object" aria-hidden="true"><span /><span /><span /><MicIcon width="42" height="42" /></div>
          <div className="demo-welcome-copy"><p className="section-kicker">Meet Mei Chen, age 75</p><h2>The rain has brought back a memory.</h2><p>This scripted path works without a microphone, speech synthesis, credentials, or internet access. It will add one grounded story to a believable, partially completed family archive.</p><ul><li><CheckIcon width="19" height="19" />No audio is recorded</li><li><CheckIcon width="19" height="19" />Every family fact has provenance</li><li><CheckIcon width="19" height="19" />Nothing is saved before review</li></ul><button className="button button-primary button-large" type="button" disabled={busy} onClick={() => void startDemo()}><MicIcon width="24" height="24" />{busy ? "Opening the listening room…" : "Start the conversation"}</button></div>
        </section>
      ) : null}

      {phase === "conversation" ? (
        <section className="demo-conversation">
          <div className="demo-stage">
            <StatusPill state={voice.state} detail={voice.stateDetail} />
            <div className={`demo-speaker demo-speaker-${voice.state}`}><span className="speaker-monogram">{voice.state === "speaking" ? "L" : "M"}</span><div><p>{voice.state === "speaking" ? "Linger" : voice.partial ? "Mei, live" : "Listening room"}</p><h2>{voice.state === "speaking" ? voice.currentResponse : voice.partial || (conversationComplete ? "The story is ready to review." : "Press below to simulate Mei’s next spoken line.")}</h2></div></div>
            <Waveform state={voice.state} label="Scripted conversation activity" />
            {!conversationComplete ? <button className="button button-primary button-large" data-testid="demo-next-turn" type="button" disabled={busy} onClick={() => void advanceConversation()}><MicIcon width="23" height="23" />{busy ? "Listening…" : `Simulate spoken line ${voice.turns.length + 1} of 4`}</button> : <div className="extraction-invitation"><SparkIcon width="25" height="25" /><div><strong>This memory may be worth keeping.</strong><p>Nothing has been saved. Review what Linger noticed first.</p></div><button className="button button-primary" data-testid="simulate-extraction" type="button" onClick={() => void simulateExtraction()}>Simulate memory extraction <ArrowIcon width="20" height="20" /></button></div>}
          </div>
          <aside className="demo-transcript"><div className="panel-heading"><div><p className="section-kicker">Exact script</p><h2>Live transcript</h2></div><span>{transcriptRows.length}/7 lines</span></div><ol>{transcriptRows.map((row) => <li key={row.key} className={row.speaker === "Linger" ? "assistant" : "user"}><span>{row.speaker}</span><p>{row.text}</p></li>)}{voice.partial ? <li className="user partial-entry"><span>Mei, live</span><p>{voice.partial}<i /></p></li> : null}</ol></aside>
        </section>
      ) : null}

      {phase === "extracting" ? (
        <section className="extracting-state" aria-live="polite"><div className="extraction-mark" aria-hidden="true"><i /><i /><i /></div><p className="section-kicker">Memory extraction</p><h2>Finding the people, place, and open thread.</h2><p>Comparing the transcript with one known family fact: Mei was born in 1951.</p><div className="extraction-progress"><span /></div></section>
      ) : null}

      {phase === "confirm" ? (
        <section className="confirmation-layout">
          <header className="confirmation-intro"><p className="section-kicker">Confirm before saving</p><h2>Is this the memory Mei meant?</h2><p>Correct names, relationships, dates, places, or the unresolved question. Nothing is in the archive yet.</p></header>
          <form className="extraction-form" onSubmit={(event) => { event.preventDefault(); void saveMemory(); }}>
            <div className="extraction-form-section"><div className="form-section-heading"><span>01</span><div><h3>Story</h3><p>A title and short account for the archive.</p></div></div><div className="form-fields"><label className="field"><span>Suggested title</span><input data-testid="extraction-title" required value={draft.suggestedTitle} onChange={(event) => setDraft({ ...draft, suggestedTitle: event.target.value })} /></label><label className="field"><span>Summary</span><textarea rows={5} required value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label></div></div>
            <div className="extraction-form-section"><div className="form-section-heading"><span>02</span><div><h3>People</h3><p>Names are never merged automatically here.</p></div></div><div className="form-fields people-fields">{draft.people.map((person, index) => <div className="field-row" key={`${person.name}-${index}`}><label className="field"><span>Person</span><input required aria-label={`Person ${index + 1} name`} value={person.name} onChange={(event) => setDraft({ ...draft, people: draft.people.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} /></label><label className="field"><span>Relationship to Mei</span><input required aria-label={`Person ${index + 1} relationship`} value={person.relationship} onChange={(event) => setDraft({ ...draft, people: draft.people.map((item, itemIndex) => itemIndex === index ? { ...item, relationship: event.target.value } : item) })} /></label><span className="confidence-tag">{Math.round(person.confidence * 100)}% confidence</span></div>)}</div></div>
            <div className="extraction-form-section"><div className="form-section-heading"><span>03</span><div><h3>Place & time</h3><p>{dateWasCorrected ? "The reviewed date will replace the derived suggestion." : "1968 is derived, not guessed."}</p></div></div><div className="form-fields"><div className="field-row"><label className="field"><span>Place</span><input required value={draft.places[0]?.name ?? ""} onChange={(event) => setDraft({ ...draft, places: [{ name: event.target.value, confidence: draft.places[0]?.confidence ?? 0.9 }] })} /></label><label className="field"><span>Approximate year</span><input required value={draft.events[0]?.approximateDate ?? ""} onChange={(event) => setDraft({ ...draft, events: draft.events.map((item, index) => index === 0 ? { ...item, approximateDate: event.target.value } : item) })} /></label></div><div className="provenance-callout"><span><CheckIcon width="18" height="18" /></span><div><strong>{dateWasCorrected ? "Confirmed during storyteller review · 100% confidence" : "Derived with family context · 92% confidence"}</strong><p>{dateWasCorrected ? `The storyteller corrected the suggested year to ${draft.events[0]?.approximateDate || "an unspecified date"}.` : "Known birth year 1951 + directly stated age seventeen = 1968."}</p></div></div></div></div>
            <div className="extraction-form-section"><div className="form-section-heading"><span>04</span><div><h3>Open thread</h3><p>A grounded question for a future family conversation.</p></div></div><div className="form-fields"><label className="field"><span>Unresolved question</span><input required value={draft.unresolvedQuestions[0] ?? ""} onChange={(event) => setDraft({ ...draft, unresolvedQuestions: [event.target.value] })} /></label><label className="field"><span>Sensitivity</span><select value={draft.sensitivityLevel} onChange={(event) => setDraft({ ...draft, sensitivityLevel: event.target.value as ExtractedMemory["sensitivityLevel"] })}><option value="low">Low</option><option value="medium">Medium — approach gently</option><option value="high">High — ask only with care</option></select></label></div></div>
            <footer className="confirmation-actions"><div><CheckIcon width="20" height="20" /><p><strong>Mei chooses what is saved.</strong><br />Audio will not be retained.</p></div><label className="compact-select"><span>Who can see it</span><select value={demoSharing} onChange={(event) => setDemoSharing(event.target.value as "private" | "family")}><option value="private">Only me (default)</option><option value="family">Share with family</option></select></label><button className="button button-primary button-large" data-testid="confirm-memory" type="submit">Confirm and save story <ArrowIcon width="21" height="21" /></button></footer>
          </form>
        </section>
      ) : null}

      {phase === "saving" ? <section className="saving-state" aria-live="polite"><span className="saving-seal"><StoryIcon width="38" height="38" /></span><p className="section-kicker">Saving memory</p><h2>Adding one story to the Chen family archive.</h2><ul><li className="done"><CheckIcon width="18" height="18" />Story reviewed</li><li><span className="mini-spinner" />Linking {draft.people.map((person) => person.name).join(" and ")}</li><li>Adding the {memoryDate} timeline event</li></ul></section> : null}

      {phase === "saved" ? <section className="saved-state"><span className="saved-check"><CheckIcon width="48" height="48" /></span><p className="section-kicker">Memory saved with consent</p><h2>{draft.suggestedTitle}</h2><p>The story, its reviewed date, and its unresolved family question are now connected across the archive.</p><div className="saved-changes"><span><StoryIcon width="24" height="24" /><strong>1 new story</strong></span><span><UsersIcon width="24" height="24" /><strong>{draft.people.length} people linked</strong></span><span><TreeIcon width="24" height="24" /><strong>1 timeline event</strong></span></div>{saveNotice ? <p className="save-notice">{saveNotice}</p> : null}<button className="button button-primary button-large" data-testid="view-saved-story" type="button" onClick={() => setPhase("archive")}>See it in the archive <ArrowIcon width="21" height="21" /></button></section> : null}

      {phase === "archive" || phase === "timeline" || phase === "tree" ? (
        <section className="demo-archive-section">
          <header><div><p className="section-kicker">The archive changed with the story</p><h2>{phase === "archive" ? "A new story is now first in the collection." : phase === "timeline" ? `${memoryDate} now has a reviewed life event.` : `${brotherName} now has a place in the family thread.`}</h2></div><div className="demo-next-actions">{phase === "archive" ? <button className="button button-primary" data-testid="view-timeline" type="button" onClick={() => showArchive("timeline")}>See timeline update <ArrowIcon width="20" height="20" /></button> : null}{phase === "timeline" ? <button className="button button-primary" data-testid="view-tree" type="button" onClick={() => showArchive("tree")}>See {brotherName} in the tree <ArrowIcon width="20" height="20" /></button> : null}{phase === "tree" ? <button className="button button-primary" data-testid="generate-prompt" type="button" onClick={() => setPhase("gathering")}>Generate family question <ArrowIcon width="20" height="20" /></button> : null}</div></header>
          <ArchiveView archive={archive} activeTab={phase === "archive" ? "stories" : phase} onTabChange={(tab) => showArchive(tab)} emphasizeStoryId={DEMO_NEW_STORY_ID} />
        </section>
      ) : null}

      {phase === "gathering" && newPrompt ? <section className="demo-gathering"><header><p className="section-kicker">Family Gathering prompt</p><h2>The open thread becomes an invitation.</h2><p>It stays linked to the source story and carries its sensitivity forward.</p></header><article className="gathering-card demo-prompt-card"><div className="prompt-quote"><span aria-hidden="true">“</span><h3>{newPrompt.prompt}</h3></div><div className="prompt-context"><section><p className="section-kicker">Why it may matter</p><p>{newPrompt.rationale}</p></section><section className="prompt-caution"><p className="section-kicker">A gentle caution</p><p>{newPrompt.caution}</p></section><section><p className="section-kicker">Source story</p><p>{newPrompt.sourceStoryTitle}</p></section></div><footer><span className="recording-reminder"><i /> Recording will remain off</span><button className="button button-primary button-large" data-testid="start-gathering" type="button" onClick={beginGathering}>Start the family conversation <ArrowIcon width="21" height="21" /></button></footer></article></section> : null}

      {phase === "introducing" || phase === "quiet" ? <section className="demo-quiet"><div className="demo-recording-off"><span /><strong>Recording is off</strong><small>Linger is not listening</small></div><div className="quiet-question"><p className="section-kicker">{phase === "introducing" ? "Linger asks exactly once" : "The family has the room"}</p><h2>{newPrompt?.prompt}</h2>{phase === "introducing" ? <div className="speaking-line"><i /><i /><i /><i /><i /></div> : <><div className="quiet-mark"><PauseIcon width="32" height="32" /></div><p>Linger is quiet. The question now belongs to the family.</p></>}</div>{phase === "quiet" ? <div className="demo-finish"><p><strong>Demo complete.</strong> Memory → Archive → Family conversation → New memory</p><div><button className="button button-secondary" type="button" onClick={() => { stopSpeech.current?.(); setQuietRecordingConsent(false); setPhase("welcome"); }}>Run demo again</button><button className="button button-primary" type="button" aria-pressed={quietRecordingConsent} onClick={() => setQuietRecordingConsent((current) => !current)}><MicIcon width="21" height="21" />{quietRecordingConsent ? "New-memory recording enabled" : "Begin preserving a new memory"}</button></div>{quietRecordingConsent ? <p className="explicit-recording-notice" role="status"><span /> Recording would now be active. This demo still captures no microphone audio.</p> : null}</div> : null}</section> : null}
    </main>
  );
}
