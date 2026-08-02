import type {
  ArchiveSnapshot,
  ExtractedMemory,
  FactProvenance,
  GatheringPrompt,
  LifeEvent,
  Person,
  SensitivityLevel,
  Story,
} from "./types";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : string(value);
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
  return value.map((item) => item.trim()).filter(Boolean);
}

function sensitivity(value: unknown): SensitivityLevel | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

function isoDate(value: unknown): string | null {
  const text = string(value);
  return text && !Number.isNaN(Date.parse(text)) ? new Date(text).toISOString() : null;
}

function confidence(value: unknown): number | null {
  const parsed = number(value);
  return parsed !== null && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function provenanceList(value: unknown, field = "source"): FactProvenance[] {
  const source = record(value);
  if (!source) return [];
  const facts: FactProvenance[] = [];
  const entries = "kind" in source ? [[field, source] as const] : Object.entries(source);
  for (const [key, raw] of entries) {
    const fact = record(raw);
    if (!fact) continue;
    const kind = string(fact.kind);
    const factConfidence = confidence(fact.confidence) ?? 0.8;
    const sources = strings(fact.sources) ?? [];
    const explanation = string(fact.explanation) ?? (sources.join("; ") || "Stored archive provenance");
    facts.push({
      field: key,
      source: kind === "direct"
        ? "transcript"
        : kind === "context"
          ? "family_context"
          : kind === "user_confirmation" || kind === "user_correction"
            ? "confirmation"
            : "derived",
      evidence: explanation,
      confidence: factConfidence,
    });
  }
  return facts;
}

function approximateSortYear(label: string): number {
  const match = label.match(/\b(18|19|20)\d{2}\b/);
  return match ? Number(match[0]) : 9999;
}

function decodeStory(value: unknown, primaryName: string): Story | null {
  const source = record(value);
  if (!source) return null;
  const id = string(source.id);
  const familyId = string(source.family_id);
  const speakerId = string(source.speaker_id);
  const title = string(source.title);
  const summary = string(source.summary);
  const transcript = string(source.transcript);
  const themes = strings(source.emotional_themes);
  const sensitivityLevel = sensitivity(source.sensitivity_level);
  const createdAt = isoDate(source.created_at);
  const sharing = source.sharing_permission;
  if (!id || !familyId || !speakerId || !title || !summary || !transcript || !themes || !sensitivityLevel || !createdAt) return null;
  if (sharing !== "private" && sharing !== "family" && sharing !== "selected") return null;
  if (!Array.isArray(source.people) || !Array.isArray(source.unresolved_questions)) return null;
  const people: Story["people"] = [];
  for (const candidate of source.people) {
    const person = record(candidate);
    const personId = string(person?.id);
    const name = string(person?.name);
    const role = string(person?.role_in_story);
    if (!personId || !name || !role) return null;
    people.push({ id: personId, name, roleInStory: role });
  }
  const unresolvedQuestions: string[] = [];
  for (const candidate of source.unresolved_questions) {
    const question = record(candidate);
    const text = string(question?.question);
    if (!text) return null;
    unresolvedQuestions.push(text);
  }
  return {
    id,
    familyId,
    speakerId,
    speakerName: string(source.speaker) ?? primaryName,
    title,
    summary,
    transcript,
    audioUrl: nullableString(source.audio_url),
    approximateDate: nullableString(source.approximate_start_date) ?? "Date not yet known",
    location: nullableString(source.location) ?? "Place not yet known",
    emotionalThemes: themes,
    sensitivityLevel,
    createdAt,
    people,
    unresolvedQuestions,
    notableQuotes: strings(source.notable_quotes) ?? [],
    sharing,
    provenance: provenanceList(source.provenance, "story"),
  };
}

function decodeLifeEvent(value: unknown): LifeEvent | null {
  const source = record(value);
  if (!source) return null;
  const id = string(source.id);
  const storyId = string(source.story_id);
  const title = string(source.title);
  const description = string(source.description);
  const approximateDate = nullableString(source.approximate_date) ?? "Date not yet known";
  const eventConfidence = confidence(source.confidence);
  if (!id || !storyId || !title || !description || eventConfidence === null) return null;
  return {
    id,
    storyId,
    title,
    description,
    approximateDate,
    sortYear: approximateSortYear(approximateDate),
    location: nullableString(source.location) ?? "Place not yet known",
    confidence: eventConfidence,
    provenance: provenanceList(source.provenance, "event.approximateDate"),
  };
}

function decodePrompt(value: unknown): GatheringPrompt | null {
  const source = record(value);
  if (!source) return null;
  const id = string(source.id);
  const sourceStoryId = string(source.source_story_id);
  const prompt = string(source.prompt);
  const rationale = string(source.rationale);
  const level = sensitivity(source.sensitivity_level);
  if (!id || !sourceStoryId || !prompt || !rationale || !level) return null;
  return {
    id,
    sourceStoryId,
    sourceStoryTitle: nullableString(source.source_story_title) ?? "Source story",
    prompt,
    rationale,
    sensitivityLevel: level,
    caution: nullableString(source.caution),
  };
}

function deriveRelationships(people: Person[], primaryId: string): Person[] {
  const primary = people.find((person) => person.id === primaryId) ?? people.find((person) => person.relationshipToPrimaryUser === "self");
  if (!primary) return people;
  const spouse = people.find((person) => ["spouse", "husband", "wife", "partner"].includes(person.relationshipToPrimaryUser.toLowerCase()));
  const parents = people.filter((person) => ["mother", "father", "parent"].includes(person.relationshipToPrimaryUser.toLowerCase()));
  return people.map((person) => {
    const relationship = person.relationshipToPrimaryUser.toLowerCase();
    if (person.id === primary.id) return { ...person, parentIds: parents.map((parent) => parent.id), partnerIds: spouse ? [spouse.id] : [] };
    if (spouse && person.id === spouse.id) return { ...person, partnerIds: [primary.id] };
    if (["son", "daughter", "child"].includes(relationship)) {
      return { ...person, parentIds: [primary.id] };
    }
    return person;
  });
}

export function decodeArchiveSnapshot(value: unknown): ArchiveSnapshot | null {
  const source = record(value);
  if (!source) return null;
  const family = record(source.family);
  const primary = record(source.primary_user);
  const familyId = string(family?.id);
  const familyName = string(family?.family_name);
  const primaryId = string(primary?.id);
  const primaryName = string(primary?.name);
  const birthYear = number(primary?.birth_year);
  if (!familyId || !familyName || !primaryId || !primaryName || !Number.isInteger(birthYear)) return null;
  if (!Array.isArray(source.stories) || !Array.isArray(source.people) || !Array.isArray(source.life_events) || !Array.isArray(source.conversation_prompts)) return null;
  const stories = source.stories.map((item) => decodeStory(item, primaryName));
  const lifeEvents = source.life_events.map(decodeLifeEvent);
  const gatheringPrompts = source.conversation_prompts.map(decodePrompt);
  if (stories.some((item) => !item) || lifeEvents.some((item) => !item) || gatheringPrompts.some((item) => !item)) return null;
  const validStories = stories as Story[];
  const people: Person[] = [];
  for (const candidate of source.people) {
    const person = record(candidate);
    const id = string(person?.id);
    const personFamilyId = string(person?.family_id);
    const name = string(person?.name);
    const aliases = strings(person?.aliases);
    const relationship = string(person?.relationship_to_primary_user);
    const relatedIds = strings(person?.related_story_ids);
    if (!id || !personFamilyId || !name || !aliases || !relationship || !relatedIds) return null;
    const related = validStories.filter((story) => relatedIds.includes(story.id));
    people.push({
      id,
      familyId: personFamilyId,
      name,
      aliases,
      relationshipToPrimaryUser: relationship,
      birthYear: number(person?.birth_year),
      deathYear: number(person?.death_year),
      notes: nullableString(person?.notes) ?? "",
      relatedStoryIds: relatedIds,
      quotes: related.flatMap((story) => story.notableQuotes).slice(0, 5),
      places: [...new Set(related.map((story) => story.location).filter((place) => place !== "Place not yet known"))],
      unresolvedQuestions: related.flatMap((story) => story.unresolvedQuestions),
      parentIds: [],
      partnerIds: [],
      derivedFromStoryId: null,
    });
  }
  const createdTimes = validStories.map((story) => Date.parse(story.createdAt)).filter(Number.isFinite);
  const familyCreated = isoDate(family?.created_at);
  return {
    family: { id: familyId, familyName },
    primaryUser: { id: primaryId, name: primaryName, birthYear: birthYear as number },
    people: deriveRelationships(people, primaryId),
    stories: [...validStories].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
    lifeEvents: (lifeEvents as LifeEvent[]).sort((left, right) => left.sortYear - right.sortYear),
    gatheringPrompts: gatheringPrompts as GatheringPrompt[],
    updatedAt: createdTimes.length > 0 ? new Date(Math.max(...createdTimes)).toISOString() : familyCreated ?? new Date(0).toISOString(),
  };
}

function decodeExtractionProvenance(value: unknown): FactProvenance[] {
  return provenanceList(value);
}

export function decodeExtractedMemory(value: unknown): ExtractedMemory | null {
  const source = record(value);
  if (!source) return null;
  const suggestedTitle = string(source.suggested_title);
  const summary = string(source.summary);
  const emotionalThemes = strings(source.emotional_themes);
  const unresolvedQuestions = strings(source.unresolved_questions);
  const notableQuotes = strings(source.notable_quotes);
  const level = sensitivity(source.sensitivity_level);
  if (!suggestedTitle || !summary || !emotionalThemes || !unresolvedQuestions || !notableQuotes || !level || !Array.isArray(source.people) || !Array.isArray(source.places) || !Array.isArray(source.events)) return null;
  const people = source.people.map((candidate) => {
    const person = record(candidate);
    const name = string(person?.name);
    const personConfidence = confidence(person?.confidence);
    const aliases = strings(person?.aliases);
    if (!name || personConfidence === null || !aliases) return null;
    return { name, relationship: nullableString(person?.relationship) ?? "", aliases, confidence: personConfidence };
  });
  const places = source.places.map((candidate) => {
    const place = record(candidate);
    const name = string(place?.name);
    const placeConfidence = confidence(place?.confidence);
    return name && placeConfidence !== null ? { name, confidence: placeConfidence } : null;
  });
  const events = source.events.map((candidate) => {
    const event = record(candidate);
    const title = string(event?.title);
    const description = string(event?.description);
    const eventConfidence = confidence(event?.confidence);
    return title && description && eventConfidence !== null
      ? { title, description, approximateDate: nullableString(event?.approximate_date) ?? "", confidence: eventConfidence }
      : null;
  });
  if (people.some((item) => !item) || places.some((item) => !item) || events.some((item) => !item)) return null;
  return {
    suggestedTitle,
    summary,
    people: people as ExtractedMemory["people"],
    places: places as ExtractedMemory["places"],
    events: events as ExtractedMemory["events"],
    emotionalThemes,
    unresolvedQuestions,
    sensitivityLevel: level,
    notableQuotes,
    provenance: decodeExtractionProvenance(source.provenance),
  };
}

function encodeProvenance(memory: ExtractedMemory): Record<string, unknown> {
  return Object.fromEntries(memory.provenance.map((fact) => [fact.field, {
    kind: fact.source === "transcript" ? "direct" : fact.source === "family_context" || fact.source === "confirmation" ? "context" : "derived",
    sources: [fact.evidence],
    explanation: fact.evidence,
    confidence: fact.confidence,
  }]));
}

export function encodeExtractedMemory(memory: ExtractedMemory): UnknownRecord {
  return {
    suggested_title: memory.suggestedTitle,
    summary: memory.summary,
    people: memory.people.map((person) => ({ ...person, relationship: person.relationship || null })),
    places: memory.places,
    events: memory.events.map((event) => ({
      title: event.title,
      description: event.description,
      approximate_date: event.approximateDate || null,
      confidence: event.confidence,
    })),
    emotional_themes: memory.emotionalThemes,
    unresolved_questions: memory.unresolvedQuestions,
    sensitivity_level: memory.sensitivityLevel,
    notable_quotes: memory.notableQuotes,
    provenance: encodeProvenance(memory),
  };
}
