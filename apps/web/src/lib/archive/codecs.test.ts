import { describe, expect, it } from "vitest";
import { decodeArchiveSnapshot, decodeExtractedMemory, encodeExtractedMemory } from "./codecs";
import { createDemoExtraction } from "./seed";

const archiveDto = {
  family: { id: "10000000-0000-4000-8000-000000000001", family_name: "Lin family", created_at: "2026-01-01T00:00:00Z" },
  primary_user: { id: "u1", name: "Mei Lin", birth_year: 1951 },
  people: [{ id: "p1", family_id: "10000000-0000-4000-8000-000000000001", name: "Mei Lin", aliases: [], relationship_to_primary_user: "self", birth_year: 1951, death_year: null, notes: "Speaker", related_story_ids: ["s1"] }],
  stories: [{ id: "s1", family_id: "10000000-0000-4000-8000-000000000001", speaker_id: "p1", speaker: "Mei Lin", title: "A story", summary: "Summary", transcript: "Transcript", audio_url: null, approximate_start_date: "Around 1971", location: "Oakland", emotional_themes: ["welcome"], sensitivity_level: "low", notable_quotes: ["A quote"], sharing_permission: "family", created_at: "2026-02-01T00:00:00Z", people: [{ id: "p1", name: "Mei Lin", role_in_story: "speaker" }], unresolved_questions: [{ id: "q1", question: "What happened next?", status: "open" }], provenance: {} }],
  life_events: [{ id: "e1", story_id: "s1", title: "An event", description: "Description", approximate_date: "Around 1971", location: "Oakland", confidence: .8, provenance: { kind: "direct", sources: ["story"] } }],
  unresolved_questions: [],
  conversation_prompts: [{ id: "g1", source_story_id: "s1", source_story_title: "A story", prompt: "Ask what happened next.", rationale: "It remains open.", sensitivity_level: "low", caution: null }],
};

describe("archive boundary codecs", () => {
  it("validates and converts the API snake_case aggregate", () => {
    const decoded = decodeArchiveSnapshot(archiveDto);
    expect(decoded?.family.familyName).toBe("Lin family");
    expect(decoded?.stories[0]?.speakerName).toBe("Mei Lin");
    expect(decoded?.people[0]?.quotes).toEqual(["A quote"]);
    expect(decoded?.lifeEvents[0]?.sortYear).toBe(1971);
  });

  it("rejects partial aggregates instead of poisoning localStorage", () => {
    expect(decodeArchiveSnapshot({ ...archiveDto, stories: [{ title: "missing contract fields" }] })).toBeNull();
  });

  it("preserves backend storyteller confirmations and corrections as confirmation provenance", () => {
    const reviewed = structuredClone(archiveDto);
    reviewed.stories[0]!.provenance = {
      summary: { kind: "user_correction", sources: ["storyteller review"], confidence: 1 },
    };
    reviewed.life_events[0]!.provenance = {
      kind: "user_confirmation", sources: ["storyteller review"],
    };
    const decoded = decodeArchiveSnapshot(reviewed);
    expect(decoded?.stories[0]?.provenance[0]?.source).toBe("confirmation");
    expect(decoded?.lifeEvents[0]?.provenance[0]?.source).toBe("confirmation");
  });

  it("round-trips extraction fields across camel and snake case", () => {
    const memory = createDemoExtraction();
    const decoded = decodeExtractedMemory(encodeExtractedMemory(memory));
    expect(decoded?.suggestedTitle).toBe(memory.suggestedTitle);
    expect(decoded?.events[0]?.approximateDate).toBe("1968");
  });
});
