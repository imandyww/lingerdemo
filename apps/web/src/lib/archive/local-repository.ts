import {
  DEMO_FAMILY_ID,
  DEMO_NEW_STORY_ID,
  PRIMARY_USER_ID,
  createDemoExtraction,
  getSeedArchive,
} from "./seed";
import type { ArchiveSnapshot, ExtractedMemory, GatheringPrompt, LifeEvent, Person, Story } from "./types";

export const ARCHIVE_STORAGE_KEY = "linger.demo.archive.v1";

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadLocalArchive(): ArchiveSnapshot {
  const storage = browserStorage();
  const raw = storage?.getItem(ARCHIVE_STORAGE_KEY);
  if (!raw) return getSeedArchive();
  try {
    return JSON.parse(raw) as ArchiveSnapshot;
  } catch {
    return getSeedArchive();
  }
}

export function persistLocalArchive(snapshot: ArchiveSnapshot): void {
  browserStorage()?.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(snapshot));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<ArchiveSnapshot>("linger:archive-updated", { detail: snapshot }));
  }
}

export function resetLocalArchive(): ArchiveSnapshot {
  const archive = getSeedArchive();
  persistLocalArchive(archive);
  return archive;
}

export function hasDemoMemory(snapshot: ArchiveSnapshot): boolean {
  return snapshot.stories.some((story) => story.id === DEMO_NEW_STORY_ID);
}

function requiredText(value: string | undefined, field: string): string {
  const text = value?.trim();
  if (!text) throw new Error(`${field} must be confirmed before this memory can be saved.`);
  return text;
}

function sameProvenanceScope(storedField: string, correctedField: string): boolean {
  if (correctedField.startsWith("people[")) return storedField.startsWith("people.") || storedField.startsWith("people[");
  if (correctedField === "places[0].name") return storedField.startsWith("places[0]");
  if (correctedField === "events[0].approximateDate") return storedField === "event.approximateDate" || storedField.startsWith("events[0].approximateDate");
  return storedField === correctedField;
}

export function mergeConfirmedMemory(
  current: ArchiveSnapshot,
  memory: ExtractedMemory,
  transcript: string,
  sharing: "private" | "family" = "private",
): ArchiveSnapshot {
  if (hasDemoMemory(current)) return current;

  const now = new Date().toISOString();
  const original = createDemoExtraction();
  const brotherDraft = memory.people[0];
  const motherDraft = memory.people[1];
  const eventDraft = memory.events[0];
  const title = requiredText(memory.suggestedTitle, "Story title");
  const summary = requiredText(memory.summary, "Story summary");
  const brotherName = requiredText(brotherDraft?.name, "First person name");
  const brotherRelationship = requiredText(brotherDraft?.relationship, "First person relationship");
  const motherName = requiredText(motherDraft?.name, "Second person name");
  const motherRelationship = requiredText(motherDraft?.relationship, "Second person relationship");
  const place = requiredText(memory.places[0]?.name, "Place");
  const approximateDate = requiredText(eventDraft?.approximateDate, "Approximate date");
  const eventTitle = requiredText(eventDraft?.title, "Event title");
  const eventDescription = requiredText(eventDraft?.description, "Event description");
  const unresolvedQuestion = requiredText(memory.unresolvedQuestions[0], "Unresolved question");
  const correctedFacts = [
    memory.suggestedTitle !== original.suggestedTitle ? "story.title" : null,
    memory.summary !== original.summary ? "story.summary" : null,
    brotherDraft?.name !== original.people[0]?.name ? "people[0].name" : null,
    brotherDraft?.relationship !== original.people[0]?.relationship ? "people[0].relationship" : null,
    motherDraft?.name !== original.people[1]?.name ? "people[1].name" : null,
    motherDraft?.relationship !== original.people[1]?.relationship ? "people[1].relationship" : null,
    memory.places[0]?.name !== original.places[0]?.name ? "places[0].name" : null,
    memory.events[0]?.approximateDate !== original.events[0]?.approximateDate ? "events[0].approximateDate" : null,
    memory.unresolvedQuestions[0] !== original.unresolvedQuestions[0] ? "unresolvedQuestions[0]" : null,
    memory.sensitivityLevel !== original.sensitivityLevel ? "story.sensitivityLevel" : null,
  ].filter((field): field is string => Boolean(field));
  const confirmedProvenance = correctedFacts.map((field) => ({
    field,
    source: "confirmation" as const,
    evidence: "Corrected or confirmed by the storyteller during the save review.",
    confidence: 1,
  }));
  const fullProvenance = [
    ...memory.provenance.filter((fact) => !correctedFacts.some((field) => sameProvenanceScope(fact.field, field))),
    ...confirmedProvenance,
  ];
  const ming: Person = {
    id: "person-ming",
    familyId: DEMO_FAMILY_ID,
    name: brotherName,
    aliases: [],
    relationshipToPrimaryUser: brotherRelationship,
    birthYear: null,
    deathYear: null,
    notes: `Mei remembers ${brotherName} standing at the station in the rain when she left home.`,
    relatedStoryIds: [DEMO_NEW_STORY_ID],
    quotes: memory.notableQuotes,
    places: [place],
    unresolvedQuestions: [unresolvedQuestion],
    parentIds: [],
    partnerIds: [],
    derivedFromStoryId: DEMO_NEW_STORY_ID,
  };
  const mother: Person = {
    id: "person-meis-mother",
    familyId: DEMO_FAMILY_ID,
    name: motherName,
    aliases: [],
    relationshipToPrimaryUser: motherRelationship,
    birthYear: null,
    deathYear: null,
    notes: "Made the red scarf Mei carried when she left home.",
    relatedStoryIds: [DEMO_NEW_STORY_ID],
    quotes: [],
    places: [],
    unresolvedQuestions: [],
    parentIds: [],
    partnerIds: [],
    derivedFromStoryId: DEMO_NEW_STORY_ID,
  };
  const storyPeople = [
    { id: "person-ming", name: ming.name, roleInStory: ming.relationshipToPrimaryUser },
    { id: "person-meis-mother", name: mother.name, roleInStory: mother.relationshipToPrimaryUser },
  ];
  const story: Story = {
    id: DEMO_NEW_STORY_ID,
    familyId: DEMO_FAMILY_ID,
    speakerId: PRIMARY_USER_ID,
    speakerName: "Mei Chen",
    title,
    summary,
    transcript,
    audioUrl: null,
    approximateDate,
    location: place,
    emotionalThemes: memory.emotionalThemes,
    sensitivityLevel: memory.sensitivityLevel,
    createdAt: now,
    people: storyPeople,
    unresolvedQuestions: memory.unresolvedQuestions,
    notableQuotes: memory.notableQuotes,
    sharing,
    provenance: fullProvenance,
  };
  const event: LifeEvent = {
    id: "event-leaving-home-1968",
    storyId: DEMO_NEW_STORY_ID,
    title: eventTitle,
    description: eventDescription,
    approximateDate,
    sortYear: Number(approximateDate.match(/\b(18|19|20)\d{2}\b/)?.[0] ?? 9999),
    location: place,
    confidence: eventDraft!.confidence,
    provenance: fullProvenance.filter((fact) => fact.field.includes("approximateDate")),
  };
  const defaultQuestion = original.unresolvedQuestions[0];
  const defaultBrother = original.people[0];
  const gatheringQuestion = unresolvedQuestion !== defaultQuestion
    ? `Ask Grandma: ${unresolvedQuestion}`
    : brotherDraft?.name !== defaultBrother?.name || brotherDraft?.relationship !== defaultBrother?.relationship
      ? `Ask Grandma what happened to her ${brotherRelationship} ${brotherName} after she left home.`
      : "Ask Grandma what happened to her younger brother Ming after she left home.";
  const prompt: GatheringPrompt = {
    id: "prompt-ming",
    sourceStoryId: DEMO_NEW_STORY_ID,
    sourceStoryTitle: title,
    prompt: gatheringQuestion,
    rationale: `${brotherName}'s life after the station is the new story's unresolved family question.`,
    sensitivityLevel: memory.sensitivityLevel,
    caution: memory.sensitivityLevel === "low" ? null : "Ask only if Grandma seems comfortable returning to this goodbye.",
  };
  const primary = current.people.find((person) => person.id === PRIMARY_USER_ID);
  const updatedPrimary = primary
    ? {
        ...primary,
        relatedStoryIds: [...primary.relatedStoryIds, DEMO_NEW_STORY_ID],
        unresolvedQuestions: [...primary.unresolvedQuestions, ...memory.unresolvedQuestions],
        parentIds: [
          ...new Set([
            ...primary.parentIds,
            ...(/^(mother|father|parent)$/i.test(motherRelationship) ? ["person-meis-mother"] : []),
          ]),
        ],
      }
    : null;
  return {
    ...current,
    updatedAt: now,
    stories: [story, ...current.stories],
    lifeEvents: [...current.lifeEvents, event].sort((a, b) => a.sortYear - b.sortYear),
    people: [
      ...current.people.map((person) => (updatedPrimary && person.id === PRIMARY_USER_ID ? updatedPrimary : person)),
      ming,
      mother,
    ],
    gatheringPrompts: [prompt, ...current.gatheringPrompts],
  };
}

export function removeStory(snapshot: ArchiveSnapshot, storyId: string): ArchiveSnapshot {
  const removedStory = snapshot.stories.find((story) => story.id === storyId);
  const stories = snapshot.stories.filter((story) => story.id !== storyId);
  const candidatePeople = snapshot.people.flatMap((person) => {
    const relatedStoryIds = person.relatedStoryIds.filter((id) => id !== storyId);
    if (person.derivedFromStoryId === storyId && relatedStoryIds.length === 0) return [];
    const relatedStories = stories.filter((story) => relatedStoryIds.includes(story.id));
    const locationStillSourced = removedStory
      ? relatedStories.some((story) => story.location === removedStory.location)
      : false;
    return [{
      ...person,
      relatedStoryIds,
      quotes: removedStory
        ? person.quotes.filter((quote) => !removedStory.notableQuotes.includes(quote))
        : person.quotes,
      places: removedStory && !locationStillSourced
        ? person.places.filter((place) => place !== removedStory.location)
        : person.places,
      unresolvedQuestions: removedStory
        ? person.unresolvedQuestions.filter((question) => !removedStory.unresolvedQuestions.includes(question))
        : person.unresolvedQuestions,
    }];
  });
  const retainedPersonIds = new Set(candidatePeople.map((person) => person.id));
  return {
    ...snapshot,
    updatedAt: new Date().toISOString(),
    stories,
    lifeEvents: snapshot.lifeEvents.filter((event) => event.storyId !== storyId),
    gatheringPrompts: snapshot.gatheringPrompts.filter((prompt) => prompt.sourceStoryId !== storyId),
    people: candidatePeople.map((person) => ({
      ...person,
      parentIds: person.parentIds.filter((id) => retainedPersonIds.has(id)),
      partnerIds: person.partnerIds.filter((id) => retainedPersonIds.has(id)),
    })),
  };
}

export function updateStory(snapshot: ArchiveSnapshot, story: Story): ArchiveSnapshot {
  const original = snapshot.stories.find((candidate) => candidate.id === story.id);
  const questionChanged = original?.unresolvedQuestions[0] !== story.unresolvedQuestions[0];
  const updatedQuestion = story.unresolvedQuestions[0];
  return {
    ...snapshot,
    updatedAt: new Date().toISOString(),
    stories: snapshot.stories.map((current) => (current.id === story.id ? story : current)),
    lifeEvents: snapshot.lifeEvents.map((event) => event.storyId === story.id ? {
      ...event,
      approximateDate: story.approximateDate,
      sortYear: Number(story.approximateDate.match(/\b(18|19|20)\d{2}\b/)?.[0] ?? 9999),
      location: story.location,
    } : event),
    gatheringPrompts: snapshot.gatheringPrompts.flatMap((prompt) => {
      if (prompt.sourceStoryId !== story.id) return [prompt];
      if (questionChanged && !updatedQuestion) return [];
      return [{
        ...prompt,
        sourceStoryTitle: story.title,
        ...(questionChanged && updatedQuestion ? {
          prompt: `Ask Grandma: ${updatedQuestion}`,
          rationale: "This question remains unresolved in the reviewed source story.",
        } : {}),
      }];
    }),
    people: snapshot.people.map((person) => person.relatedStoryIds.includes(story.id) ? {
      ...person,
      places: [...new Set([
        ...person.places.filter((place) => place !== original?.location),
        story.location,
      ])],
      unresolvedQuestions: [
        ...person.unresolvedQuestions.filter((question) => !original?.unresolvedQuestions.includes(question)),
        ...story.unresolvedQuestions,
      ],
    } : person),
  };
}

export function nextDemoPrompt(snapshot: ArchiveSnapshot, currentId: string | null): GatheringPrompt {
  const prompts = snapshot.gatheringPrompts;
  const currentIndex = prompts.findIndex((prompt) => prompt.id === currentId);
  return prompts[(currentIndex + 1 + prompts.length) % prompts.length] ?? {
    id: "prompt-empty",
    sourceStoryId: "",
    sourceStoryTitle: "No saved story yet",
    prompt: "Start by asking about a place the family once called home.",
    rationale: "A familiar place can make a gentle opening question.",
    sensitivityLevel: "low",
    caution: null,
  };
}

export { createDemoExtraction };
