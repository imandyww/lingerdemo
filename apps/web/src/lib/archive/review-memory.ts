import type { ExtractedMemory } from "./types";

export function normalizeReviewedMemory(memory: ExtractedMemory): ExtractedMemory {
  return {
    ...memory,
    suggestedTitle: memory.suggestedTitle.trim(),
    summary: memory.summary.trim(),
    people: memory.people
      .filter((person) => person.name.trim())
      .map((person) => ({ ...person, name: person.name.trim(), relationship: person.relationship.trim() })),
    places: memory.places
      .filter((place) => place.name.trim())
      .map((place) => ({ ...place, name: place.name.trim() })),
    events: memory.events.filter((event) => event.title.trim() && event.description.trim()),
    unresolvedQuestions: memory.unresolvedQuestions.map((question) => question.trim()).filter(Boolean),
  };
}

export function setPrimaryEventDate(memory: ExtractedMemory, approximateDate: string): ExtractedMemory {
  if (memory.events[0]) {
    return {
      ...memory,
      events: memory.events.map((event, index) => index === 0 ? { ...event, approximateDate } : event),
    };
  }
  if (!approximateDate) return memory;
  return {
    ...memory,
    events: [{
      title: memory.suggestedTitle,
      description: memory.summary,
      approximateDate,
      confidence: 1,
    }],
  };
}
