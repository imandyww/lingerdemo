import { describe, expect, it } from "vitest";
import { createDemoExtraction } from "./seed";
import { normalizeReviewedMemory, setPrimaryEventDate } from "./review-memory";

describe("generic live review", () => {
  it("keeps conservative empty fact collections saveable and lets the storyteller add a date", () => {
    const conservative = {
      ...createDemoExtraction(),
      people: [],
      places: [],
      events: [],
      unresolvedQuestions: [],
    };
    const normalized = normalizeReviewedMemory(conservative);
    expect(normalized.people).toEqual([]);
    expect(normalized.places).toEqual([]);
    expect(normalized.events).toEqual([]);
    expect(normalized.unresolvedQuestions).toEqual([]);

    const dated = setPrimaryEventDate(normalized, "Autumn 1999");
    expect(dated.events[0]).toMatchObject({
      title: conservative.suggestedTitle,
      description: conservative.summary,
      approximateDate: "Autumn 1999",
      confidence: 1,
    });
  });

  it("drops blank optional entries rather than fabricating facts", () => {
    const draft = createDemoExtraction();
    draft.people[0] = { ...draft.people[0]!, name: " " };
    draft.places[0] = { ...draft.places[0]!, name: "" };
    draft.unresolvedQuestions = ["   "];
    const normalized = normalizeReviewedMemory(draft);
    expect(normalized.people).toHaveLength(1);
    expect(normalized.places).toEqual([]);
    expect(normalized.unresolvedQuestions).toEqual([]);
  });
});
