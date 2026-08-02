"use client";

import { useMemo, useState } from "react";
import type { ArchiveSnapshot, Person, Story } from "@/lib/archive/types";
import { Dialog } from "./dialog";
import { CalendarIcon, DownloadIcon, PencilIcon, PlayIcon, StoryIcon, TrashIcon, TreeIcon, UsersIcon } from "./icons";

export type ArchiveTab = "stories" | "timeline" | "tree";

export function ArchiveView({
  archive,
  activeTab: controlledTab,
  onTabChange,
  onUpdateStory,
  onDeleteStory,
  emphasizeStoryId,
}: {
  archive: ArchiveSnapshot;
  activeTab?: ArchiveTab;
  onTabChange?: (tab: ArchiveTab) => void;
  onUpdateStory?: (story: Story) => void;
  onDeleteStory?: (storyId: string) => void;
  emphasizeStoryId?: string;
}) {
  const [internalTab, setInternalTab] = useState<ArchiveTab>("stories");
  const activeTab = controlledTab ?? internalTab;
  const setTab = (tab: ArchiveTab) => {
    setInternalTab(tab);
    onTabChange?.(tab);
  };
  const [selectedPersonId, setSelectedPersonId] = useState(archive.primaryUser.id);
  const [editStory, setEditStory] = useState<Story | null>(null);
  const [deleteStory, setDeleteStory] = useState<Story | null>(null);
  const selectedPerson = archive.people.find((person) => person.id === selectedPersonId) ?? archive.people[0];
  const relatedStories = archive.stories.filter((story) => selectedPerson?.relatedStoryIds.includes(story.id));

  function jumpToStory(storyId: string) {
    setTab("stories");
    window.setTimeout(() => document.getElementById(`story-${storyId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 30);
  }

  return (
    <div className="archive-view">
      <div className="archive-tabs" role="tablist" aria-label="Family archive views">
        <button type="button" role="tab" aria-selected={activeTab === "stories"} onClick={() => setTab("stories")}><StoryIcon width="22" height="22" /><span>Stories</span><small>{archive.stories.length}</small></button>
        <button type="button" role="tab" aria-selected={activeTab === "timeline"} onClick={() => setTab("timeline")}><CalendarIcon width="22" height="22" /><span>Timeline</span><small>{archive.lifeEvents.length}</small></button>
        <button type="button" role="tab" aria-selected={activeTab === "tree"} onClick={() => setTab("tree")}><TreeIcon width="22" height="22" /><span>Family tree</span><small>{archive.people.length}</small></button>
      </div>

      <section role="tabpanel" aria-label={`${activeTab} view`}>
        {activeTab === "stories" ? (
          archive.stories.length === 0 ? (
            <div className="empty-state archive-empty"><StoryIcon width="38" height="38" /><h2>No stories have been saved yet.</h2><p>Begin a conversation, then review a memory before adding it to this archive.</p></div>
          ) : (
            <div className="story-grid">
              {archive.stories.map((story, index) => (
                <StoryCard
                  key={story.id}
                  story={story}
                  index={archive.stories.length - index}
                  emphasized={story.id === emphasizeStoryId}
                  onEdit={onUpdateStory ? () => setEditStory(story) : undefined}
                  onDelete={onDeleteStory ? () => setDeleteStory(story) : undefined}
                  onChangeSharing={onUpdateStory ? (sharing) => onUpdateStory({ ...story, sharing }) : undefined}
                />
              ))}
            </div>
          )
        ) : null}

        {activeTab === "timeline" ? (
          <div className="timeline" aria-label="Family life events in chronological order">
            <div className="timeline-key"><span>Dates may be approximate</span><span><i /> Directly remembered</span><span><i className="derived" /> Derived with context</span></div>
            <ol>
              {[...archive.lifeEvents].sort((a, b) => a.sortYear - b.sortYear).map((event) => (
                <li key={event.id} className={event.storyId === emphasizeStoryId ? "timeline-new" : ""}>
                  <div className="timeline-year"><strong>{event.approximateDate}</strong><span>{Math.round(event.confidence * 100)}% confidence</span></div>
                  <div className="timeline-node" aria-hidden="true"><span /></div>
                  <article>
                    {event.storyId === emphasizeStoryId ? <p className="new-label">New from this conversation</p> : null}
                    <h3>{event.title}</h3>
                    <p>{event.description}</p>
                    <div className="story-meta"><span>{event.location}</span><button type="button" onClick={() => jumpToStory(event.storyId)}>Read source story</button></div>
                    {event.provenance.length > 0 ? <details className="provenance-detail"><summary>How this date was determined</summary><p>{event.provenance[0]?.evidence}</p></details> : null}
                  </article>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {activeTab === "tree" ? (
          <div className="tree-layout">
            <div className="family-graph-wrap">
              <p className="graph-help">Select a person to see the memories connected to them.</p>
              <FamilyGraph familyName={archive.family.familyName} people={archive.people} selectedId={selectedPerson?.id ?? ""} onSelect={setSelectedPersonId} />
              <div className="tree-mobile-list" aria-label="Family members">
                {archive.people.map((person) => <button key={person.id} type="button" aria-pressed={person.id === selectedPerson?.id} onClick={() => setSelectedPersonId(person.id)}><span>{person.name.slice(0, 1)}</span><strong>{person.name}</strong><small>{person.relationshipToPrimaryUser}</small></button>)}
              </div>
            </div>
            {selectedPerson ? (
              <aside className="person-dossier" aria-live="polite">
                <div className="person-monogram" aria-hidden="true">{selectedPerson.name.split(" ").map((name) => name[0]).join("").slice(0, 2)}</div>
                <p className="section-kicker">Family thread</p>
                <h2>{selectedPerson.name}</h2>
                <p className="person-relation">{selectedPerson.relationshipToPrimaryUser === "self" ? "Primary storyteller" : `Mei’s ${selectedPerson.relationshipToPrimaryUser}`}</p>
                {selectedPerson.notes ? <p>{selectedPerson.notes}</p> : null}
                <dl className="person-stats"><div><dt>Memories</dt><dd>{relatedStories.length}</dd></div><div><dt>Places</dt><dd>{selectedPerson.places.length}</dd></div><div><dt>Open questions</dt><dd>{selectedPerson.unresolvedQuestions.length}</dd></div></dl>
                {selectedPerson.quotes[0] ? <blockquote>“{selectedPerson.quotes[0]}”</blockquote> : null}
                {relatedStories.length > 0 ? <div className="person-memories"><h3>Related memories</h3>{relatedStories.slice(0, 3).map((story) => <button key={story.id} type="button" onClick={() => jumpToStory(story.id)}>{story.title}</button>)}</div> : <p className="quiet-note">No saved memories mention this person yet.</p>}
                {selectedPerson.unresolvedQuestions.length > 0 ? <div className="person-question"><span>Still to ask</span><p>{selectedPerson.unresolvedQuestions[0]}</p></div> : null}
              </aside>
            ) : null}
          </div>
        ) : null}
      </section>

      <Dialog open={Boolean(editStory)} title="Edit this family story" description="Adjust archive details without changing the original transcript." onClose={() => setEditStory(null)}>
        {editStory ? <StoryEditForm story={editStory} onCancel={() => setEditStory(null)} onSave={(story) => { onUpdateStory?.(story); setEditStory(null); }} /> : null}
      </Dialog>
      <Dialog open={Boolean(deleteStory)} title="Delete this story?" description="The story, its timeline event, and its gathering prompt will be removed from this device." onClose={() => setDeleteStory(null)}>
        <div className="dialog-actions"><button className="button button-secondary" type="button" onClick={() => setDeleteStory(null)}>Keep story</button><button className="button button-danger" type="button" onClick={() => { if (deleteStory) onDeleteStory?.(deleteStory.id); setDeleteStory(null); }}>Delete story</button></div>
      </Dialog>
    </div>
  );
}

function StoryCard({ story, index, emphasized, onEdit, onDelete, onChangeSharing }: { story: Story; index: number; emphasized: boolean; onEdit: (() => void) | undefined; onDelete: (() => void) | undefined; onChangeSharing: ((sharing: Story["sharing"]) => void) | undefined }) {
  const confirmedFacts = story.provenance.filter((fact) => fact.source === "confirmation");
  function exportStory() {
    const contents = `${story.title}\n\n${story.summary}\n\nSpeaker: ${story.speakerName}\nDate: ${story.approximateDate}\nPlace: ${story.location}\n\nTranscript\n${story.transcript}`;
    const url = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${story.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <article id={`story-${story.id}`} className={`story-card${emphasized ? " story-card-new" : ""}`}>
      <header>
        <div className="folio-number" aria-hidden="true">{String(index).padStart(2, "0")}</div>
        <div className="story-header-copy">
          <div className="story-labels">{emphasized ? <span className="new-label">New memory</span> : null}<span className={`sensitivity sensitivity-${story.sensitivityLevel}`}>{story.sensitivityLevel} sensitivity</span></div>
          <h2>{story.title}</h2>
          <p>{story.summary}</p>
        </div>
      </header>
      <div className="story-facts"><span><strong>{story.approximateDate}</strong>Approximate date</span><span><strong>{story.speakerName}</strong>Speaker</span><span><strong>{story.location}</strong>Place</span></div>
      <div className="story-people"><UsersIcon width="19" height="19" /><span>{story.people.map((person) => person.name).join(" · ") || "No people tagged"}</span></div>
      {story.notableQuotes[0] ? <blockquote>“{story.notableQuotes[0]}”</blockquote> : null}
      <details className="story-details">
        <summary>Open full story</summary>
        <div className="story-detail-body">
          <section><h3>Original transcript</h3><p className="story-transcript">{story.transcript}</p></section>
          <div className="story-detail-grid"><section><h3>Emotional themes</h3><p>{story.emotionalThemes.join(" · ")}</p></section><section><h3>Still unresolved</h3>{story.unresolvedQuestions.length ? story.unresolvedQuestions.map((question) => <p key={question}>{question}</p>) : <p>No open questions.</p>}</section></div>
          {confirmedFacts.length > 0 ? <section className="storyteller-review"><h3>Confirmed during storyteller review</h3><ul>{confirmedFacts.map((fact) => <li key={fact.field}><strong>{provenanceFieldLabel(fact.field)}</strong><span>{fact.evidence}</span></li>)}</ul></section> : null}
          <section className="audio-retention"><PlayIcon width="20" height="20" /><div><h3>{story.audioUrl ? "Listen to retained audio" : "Audio was not retained"}</h3><p>{story.audioUrl ? "Playback is available with the storyteller’s consent." : "Only the reviewed transcript is part of this archive."}</p></div>{story.audioUrl ? <audio controls src={story.audioUrl} /> : null}</section>
          <div className="sharing-row"><label htmlFor={story.sharing === "selected" ? undefined : `sharing-${story.id}`}>Family sharing</label>{story.sharing === "selected" ? <span className="managed-sharing">Restricted group · unsupported legacy metadata in this demo</span> : <select id={`sharing-${story.id}`} value={story.sharing} disabled={!onChangeSharing} onChange={(event) => onChangeSharing?.(event.target.value as "private" | "family")}><option value="private">Only me</option><option value="family">Shared with family</option></select>}</div>
        </div>
      </details>
      <footer className="story-actions">{onEdit ? <button type="button" onClick={onEdit}><PencilIcon width="18" height="18" />Edit</button> : null}<button type="button" onClick={exportStory}><DownloadIcon width="18" height="18" />Export</button>{onDelete ? <button className="danger-link" type="button" onClick={onDelete}><TrashIcon width="18" height="18" />Delete</button> : null}<span>Recorded {new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(story.createdAt))}</span></footer>
    </article>
  );
}

function provenanceFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    "story.title": "Story title",
    "story.summary": "Summary",
    "people[0].name": "First person’s name",
    "people[0].relationship": "First person’s relationship",
    "people[1].name": "Second person’s name",
    "people[1].relationship": "Second person’s relationship",
    "places[0].name": "Place",
    "events[0].approximateDate": "Approximate date",
    "unresolvedQuestions[0]": "Unresolved question",
    "story.sensitivityLevel": "Sensitivity",
  };
  return labels[field] ?? field;
}

function StoryEditForm({ story, onCancel, onSave }: { story: Story; onCancel: () => void; onSave: (story: Story) => void }) {
  const [draft, setDraft] = useState(story);
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
      <label className="field"><span>Story title</span><input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label className="field"><span>Summary</span><textarea required rows={4} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
      <div className="field-row"><label className="field"><span>Approximate date</span><input value={draft.approximateDate} onChange={(event) => setDraft({ ...draft, approximateDate: event.target.value })} /></label><label className="field"><span>Place</span><input value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} /></label></div>
      <label className="field"><span>Unresolved question</span><input value={draft.unresolvedQuestions[0] ?? ""} onChange={(event) => setDraft({ ...draft, unresolvedQuestions: event.target.value ? [event.target.value] : [] })} /></label>
      {draft.sharing === "selected" ? <div className="notice"><strong>Restricted group is unsupported legacy metadata.</strong><p>This demo has no recipient model and cannot safely change that value.</p></div> : <label className="field"><span>Family sharing</span><select value={draft.sharing} onChange={(event) => setDraft({ ...draft, sharing: event.target.value as "private" | "family" })}><option value="private">Only me</option><option value="family">Shared with family</option></select></label>}
      <div className="dialog-actions"><button className="button button-secondary" type="button" onClick={onCancel}>Cancel</button><button className="button button-primary" type="submit">Save changes</button></div>
    </form>
  );
}

function FamilyGraph({ familyName, people, selectedId, onSelect }: { familyName: string; people: Person[]; selectedId: string; onSelect: (id: string) => void }) {
  const positions = useMemo(() => layoutPeople(people), [people]);
  const visible = people.filter((person) => positions.has(person.id));
  const visibleIds = useMemo(() => new Set(visible.map((person) => person.id)), [visible]);
  const edges = useMemo(() => {
    const relationships: [string, string, "partner" | "parent"][] = [];
    for (const person of visible) {
      for (const partner of person.partnerIds) if (visibleIds.has(partner) && person.id < partner) relationships.push([person.id, partner, "partner"]);
      for (const parent of person.parentIds) if (visibleIds.has(parent)) relationships.push([parent, person.id, "parent"]);
    }
    return relationships;
  }, [visible, visibleIds]);
  return (
    <svg className="family-graph" viewBox="30 25 680 540" role="group" aria-label={`Simple ${familyName} relationship graph`}>
      <defs><filter id="node-shadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="5" stdDeviation="7" floodOpacity=".12" /></filter></defs>
      <g className="relationship-lines" aria-hidden="true">
        {edges.map(([fromId, toId, type]) => {
          const from = positions.get(fromId); const to = positions.get(toId);
          if (!from || !to) return null;
          return type === "partner" ? <line key={`${fromId}-${toId}`} x1={from.x + 45} y1={from.y} x2={to.x - 45} y2={to.y} /> : <path key={`${fromId}-${toId}`} d={`M ${from.x} ${from.y + 42} C ${from.x} ${from.y + 85}, ${to.x} ${to.y - 85}, ${to.x} ${to.y - 42}`} />;
        })}
      </g>
      {visible.map((person) => {
        const position = positions.get(person.id); if (!position) return null;
        const selected = person.id === selectedId;
        return (
          <g key={person.id} className={`person-node${selected ? " is-selected" : ""}`} role="button" tabIndex={0} aria-label={`${person.name}, ${person.relationshipToPrimaryUser}`} aria-pressed={selected} transform={`translate(${position.x} ${position.y})`} onClick={() => onSelect(person.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(person.id); } }}>
            <circle r="42" filter="url(#node-shadow)" /><text className="node-initials" textAnchor="middle" y="6">{person.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</text><text className="node-name" textAnchor="middle" y="62">{person.name}</text><text className="node-relation" textAnchor="middle" y="78">{person.relationshipToPrimaryUser}</text>{person.relatedStoryIds.includes("story-leaving-home-1968") ? <circle className="new-person-ring" r="50" /> : null}
          </g>
        );
      })}
    </svg>
  );
}

function layoutPeople(people: Person[]): Map<string, { x: number; y: number }> {
  const groups = new Map<number, Person[]>([[0, []], [1, []], [2, []], [3, []]]);
  for (const person of people) {
    const relationship = person.relationshipToPrimaryUser.toLowerCase();
    const level = ["mother", "father", "parent"].includes(relationship)
      ? 0
      : ["son", "daughter", "child"].includes(relationship)
        ? 2
        : ["granddaughter", "grandson", "grandchild"].includes(relationship)
          ? 3
          : 1;
    groups.get(level)?.push(person);
  }
  const result = new Map<string, { x: number; y: number }>();
  const yByLevel = [80, 220, 360, 500];
  for (const [level, members] of groups) {
    members.sort((left, right) => {
      const priority = (person: Person) => person.relationshipToPrimaryUser === "self" ? 0 : person.partnerIds.length > 0 ? 1 : 2;
      return priority(left) - priority(right) || left.name.localeCompare(right.name);
    });
    const step = 620 / (members.length + 1);
    members.forEach((person, index) => result.set(person.id, { x: 55 + step * (index + 1), y: yByLevel[level] ?? 220 }));
  }
  return result;
}
