export type SensitivityLevel = "low" | "medium" | "high";
export type Confidence = "certain" | "likely" | "uncertain";

export type FactProvenance = {
  field: string;
  source: "transcript" | "family_context" | "derived" | "confirmation";
  evidence: string;
  confidence: number;
};

export type Family = {
  id: string;
  familyName: string;
};

export type Person = {
  id: string;
  familyId: string;
  name: string;
  aliases: string[];
  relationshipToPrimaryUser: string;
  birthYear: number | null;
  deathYear: number | null;
  notes: string;
  relatedStoryIds: string[];
  quotes: string[];
  places: string[];
  unresolvedQuestions: string[];
  parentIds: string[];
  partnerIds: string[];
  derivedFromStoryId: string | null;
};

export type Story = {
  id: string;
  familyId: string;
  speakerId: string;
  speakerName: string;
  title: string;
  summary: string;
  transcript: string;
  audioUrl: string | null;
  approximateDate: string;
  location: string;
  emotionalThemes: string[];
  sensitivityLevel: SensitivityLevel;
  createdAt: string;
  people: { id: string; name: string; roleInStory: string }[];
  unresolvedQuestions: string[];
  notableQuotes: string[];
  sharing: "private" | "family" | "selected";
  provenance: FactProvenance[];
};

export type LifeEvent = {
  id: string;
  storyId: string;
  title: string;
  description: string;
  approximateDate: string;
  sortYear: number;
  location: string;
  confidence: number;
  provenance: FactProvenance[];
};

export type GatheringPrompt = {
  id: string;
  sourceStoryId: string;
  sourceStoryTitle: string;
  prompt: string;
  rationale: string;
  sensitivityLevel: SensitivityLevel;
  caution: string | null;
};

export type ArchiveSnapshot = {
  family: Family;
  primaryUser: { id: string; name: string; birthYear: number };
  people: Person[];
  stories: Story[];
  lifeEvents: LifeEvent[];
  gatheringPrompts: GatheringPrompt[];
  updatedAt: string;
};

export type ExtractedPerson = {
  name: string;
  relationship: string;
  aliases: string[];
  confidence: number;
};

export type ExtractedPlace = { name: string; confidence: number };

export type ExtractedEvent = {
  title: string;
  description: string;
  approximateDate: string;
  confidence: number;
};

export type ExtractedMemory = {
  suggestedTitle: string;
  summary: string;
  people: ExtractedPerson[];
  places: ExtractedPlace[];
  events: ExtractedEvent[];
  emotionalThemes: string[];
  unresolvedQuestions: string[];
  sensitivityLevel: SensitivityLevel;
  notableQuotes: string[];
  provenance: FactProvenance[];
};

export type ExtractionDraft = {
  id: string;
  transcript: string;
  memory: ExtractedMemory;
};
