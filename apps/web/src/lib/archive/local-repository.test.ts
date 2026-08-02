import { describe, expect, it } from "vitest";
import { mergeConfirmedMemory, removeStory, updateStory } from "./local-repository";
import { DEMO_NEW_STORY_ID, DEMO_TRANSCRIPT, createDemoExtraction, getSeedArchive } from "./seed";

describe("confirmed demo memory transaction", () => {
  it("updates story, timeline, tree person, and exact gathering question atomically", () => {
    const result = mergeConfirmedMemory(getSeedArchive(), createDemoExtraction(), DEMO_TRANSCRIPT);
    expect(result.stories[0]?.id).toBe(DEMO_NEW_STORY_ID);
    expect(result.lifeEvents.some((event) => event.approximateDate === "1968")).toBe(true);
    expect(result.people.find((person) => person.id === "person-ming")?.relationshipToPrimaryUser).toBe("younger brother");
    expect(result.gatheringPrompts[0]?.prompt).toBe("Ask Grandma what happened to her younger brother Ming after she left home.");
  });

  it("persists confirmation corrections and does not reintroduce hardcoded facts", () => {
    const draft = createDemoExtraction();
    draft.suggestedTitle = "The train in spring";
    draft.people[0] = { ...draft.people[0]!, name: "Jun", relationship: "older brother" };
    draft.events[0] = { ...draft.events[0]!, approximateDate: "1969" };
    draft.unresolvedQuestions = ["Where did Jun live later?"];
    const result = mergeConfirmedMemory(getSeedArchive(), draft, DEMO_TRANSCRIPT);
    expect(result.stories[0]?.title).toBe("The train in spring");
    expect(result.people.find((person) => person.id === "person-ming")?.name).toBe("Jun");
    expect(result.lifeEvents.find((event) => event.storyId === DEMO_NEW_STORY_ID)?.sortYear).toBe(1969);
    expect(result.gatheringPrompts[0]?.prompt).toBe("Ask Grandma: Where did Jun live later?");
    expect(result.stories[0]?.provenance.some((fact) => fact.source === "confirmation")).toBe(true);
  });

  it("rejects cleared required facts instead of restoring fixture values", () => {
    const clearedName = createDemoExtraction();
    clearedName.people[0] = { ...clearedName.people[0]!, name: "   " };
    expect(() => mergeConfirmedMemory(getSeedArchive(), clearedName, DEMO_TRANSCRIPT)).toThrow("First person name");

    const clearedPlace = createDemoExtraction();
    clearedPlace.places[0] = { ...clearedPlace.places[0]!, name: "" };
    expect(() => mergeConfirmedMemory(getSeedArchive(), clearedPlace, DEMO_TRANSCRIPT)).toThrow("Place");

    const clearedQuestion = createDemoExtraction();
    clearedQuestion.unresolvedQuestions = [];
    expect(() => mergeConfirmedMemory(getSeedArchive(), clearedQuestion, DEMO_TRANSCRIPT)).toThrow("Unresolved question");
  });

  it("replaces provenance for every editable field that the storyteller changes", () => {
    const draft = createDemoExtraction();
    draft.summary = "Mei reviewed and rewrote this account herself.";
    draft.places[0] = { ...draft.places[0]!, name: "North station" };
    draft.events[0] = { ...draft.events[0]!, approximateDate: "Spring 1969" };
    draft.sensitivityLevel = "high";
    const story = mergeConfirmedMemory(getSeedArchive(), draft, DEMO_TRANSCRIPT).stories[0]!;
    const confirmationFields = story.provenance.filter((fact) => fact.source === "confirmation").map((fact) => fact.field);
    expect(confirmationFields).toEqual(expect.arrayContaining([
      "story.summary",
      "places[0].name",
      "events[0].approximateDate",
      "story.sensitivityLevel",
    ]));
    expect(story.provenance.some((fact) => fact.source === "derived" && fact.field.startsWith("places[0]"))).toBe(false);
    expect(story.provenance.some((fact) => fact.source === "derived" && fact.field.includes("approximateDate"))).toBe(false);
  });

  it("removes story-derived people, profile facts, and dangling tree links with the source story", () => {
    const archive = mergeConfirmedMemory(getSeedArchive(), createDemoExtraction(), DEMO_TRANSCRIPT);
    const result = removeStory(archive, DEMO_NEW_STORY_ID);
    expect(result.people.some((person) => person.id === "person-ming" || person.id === "person-meis-mother")).toBe(false);
    expect(result.people.find((person) => person.id === "person-mei")?.parentIds).not.toContain("person-meis-mother");
    expect(result.people.find((person) => person.id === "person-mei")?.unresolvedQuestions).not.toContain("What happened to Ming after that day?");
    expect(result.lifeEvents.some((event) => event.storyId === DEMO_NEW_STORY_ID)).toBe(false);
    expect(result.gatheringPrompts.some((prompt) => prompt.sourceStoryId === DEMO_NEW_STORY_ID)).toBe(false);
  });

  it("keeps a story edit aligned with its timeline and future prompt", () => {
    const archive = mergeConfirmedMemory(getSeedArchive(), createDemoExtraction(), DEMO_TRANSCRIPT);
    const story = archive.stories.find((item) => item.id === DEMO_NEW_STORY_ID)!;
    const updated = updateStory(archive, {
      ...story,
      approximateDate: "Around 1969",
      location: "Central station",
      unresolvedQuestions: ["Where did Ming settle?"],
    });
    expect(updated.lifeEvents.find((event) => event.storyId === story.id)).toMatchObject({
      approximateDate: "Around 1969", sortYear: 1969, location: "Central station",
    });
    expect(updated.gatheringPrompts.find((prompt) => prompt.sourceStoryId === story.id)?.prompt).toBe("Ask Grandma: Where did Ming settle?");
  });

  it("removes a future prompt when its source story no longer has an unresolved question", () => {
    const archive = mergeConfirmedMemory(getSeedArchive(), createDemoExtraction(), DEMO_TRANSCRIPT);
    const story = archive.stories.find((item) => item.id === DEMO_NEW_STORY_ID)!;
    const updated = updateStory(archive, { ...story, unresolvedQuestions: [] });
    expect(updated.gatheringPrompts.some((prompt) => prompt.sourceStoryId === story.id)).toBe(false);
  });
});
