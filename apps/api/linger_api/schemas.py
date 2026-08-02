from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class APIModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ProvenanceEvidence(APIModel):
    kind: Literal["direct", "context", "derived", "user_confirmation", "user_correction"]
    sources: list[str] = Field(min_length=1, max_length=8)
    explanation: str = Field(min_length=1, max_length=500)
    confidence: float = Field(ge=0, le=1)


class Provenance(ProvenanceEvidence):
    source: ProvenanceEvidence | None = None


class ExtractedPerson(APIModel):
    name: str = Field(min_length=1, max_length=120)
    relationship: str | None = Field(default=None, max_length=120)
    aliases: list[str] = Field(default_factory=list, max_length=20)
    confidence: float = Field(ge=0, le=1)
    provenance: Provenance | None = None


class ExtractedPlace(APIModel):
    name: str = Field(min_length=1, max_length=200)
    confidence: float = Field(ge=0, le=1)
    provenance: Provenance | None = None


class ExtractedEvent(APIModel):
    title: str = Field(min_length=1, max_length=180)
    description: str = Field(min_length=1, max_length=2_000)
    approximate_date: str | None = Field(default=None, max_length=100)
    confidence: float = Field(ge=0, le=1)
    provenance: Provenance | None = None


class ExtractedMemory(APIModel):
    suggested_title: str = Field(min_length=1, max_length=180)
    summary: str = Field(min_length=1, max_length=4_000)
    people: list[ExtractedPerson] = Field(default_factory=list, max_length=40)
    places: list[ExtractedPlace] = Field(default_factory=list, max_length=20)
    events: list[ExtractedEvent] = Field(default_factory=list, max_length=20)
    emotional_themes: list[str] = Field(default_factory=list, max_length=20)
    unresolved_questions: list[str] = Field(default_factory=list, max_length=20)
    sensitivity_level: Literal["low", "medium", "high"]
    notable_quotes: list[str] = Field(default_factory=list, max_length=20)
    provenance: dict[str, Provenance] = Field(default_factory=dict)

    @field_validator("emotional_themes", "unresolved_questions", "notable_quotes")
    @classmethod
    def reject_blank_or_duplicate_items(cls, values: list[str]) -> list[str]:
        clean: list[str] = []
        seen: set[str] = set()
        for value in values:
            normalized = value.strip()
            if not normalized:
                raise ValueError("items must not be blank")
            key = normalized.casefold()
            if key not in seen:
                clean.append(normalized)
                seen.add(key)
        return clean


class FamilyContext(APIModel):
    primary_user_name: str
    primary_user_birth_year: int | None = Field(default=None, ge=1850, le=2100)
    known_people: list[dict[str, Any]] = Field(default_factory=list)
    known_facts: list[dict[str, Any]] = Field(default_factory=list)


class ExtractionRequest(APIModel):
    family_id: str = Field(min_length=1, max_length=36)
    session_id: str | None = Field(default=None, max_length=36)
    speaker_id: str | None = Field(default=None, max_length=36)
    transcript: str = Field(min_length=1, max_length=100_000)


class ExtractionConfirmRequest(APIModel):
    family_id: str = Field(min_length=1, max_length=36)
    speaker_id: str | None = Field(default=None, max_length=36)
    transcript: str = Field(min_length=1, max_length=100_000)
    original_memory: ExtractedMemory
    consent: Literal[True]
    corrected_memory: ExtractedMemory | None = None
    sharing_permission: Literal["private", "family"] = "private"
    retain_audio: bool = False


class DirectStoryCreateRequest(APIModel):
    family_id: str = Field(min_length=1, max_length=36)
    speaker_id: str = Field(min_length=1, max_length=36)
    transcript: str = Field(min_length=1, max_length=100_000)
    memory: ExtractedMemory
    consent: bool
    sharing_permission: Literal["private", "family"] = "private"

    @model_validator(mode="after")
    def require_consent(self) -> DirectStoryCreateRequest:
        if not self.consent:
            raise ValueError("archive persistence requires explicit consent")
        return self


class StoryUpdateRequest(APIModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    summary: str | None = Field(default=None, min_length=1, max_length=4_000)
    transcript: str | None = Field(default=None, min_length=1, max_length=100_000)
    approximate_start_date: str | None = Field(default=None, max_length=100)
    location: str | None = Field(default=None, max_length=200)
    emotional_themes: list[str] | None = None
    sensitivity_level: Literal["low", "medium", "high"] | None = None
    sharing_permission: Literal["private", "family"] | None = None
    unresolved_questions: list[str] | None = Field(default=None, max_length=20)

    @field_validator("unresolved_questions")
    @classmethod
    def reject_blank_or_duplicate_questions(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        clean: list[str] = []
        seen: set[str] = set()
        for value in values:
            normalized = value.strip()
            if not normalized:
                raise ValueError("questions must not be blank")
            key = normalized.casefold()
            if key not in seen:
                clean.append(normalized)
                seen.add(key)
        return clean


class TimelineEventView(APIModel):
    id: str
    family_id: str
    story_id: str
    title: str
    description: str
    approximate_date: str | None
    location: str | None
    confidence: float
    provenance: dict[str, Any]


class GatheringPromptView(APIModel):
    id: str
    family_id: str
    source_story_id: str
    source_story_title: str | None = None
    prompt: str
    rationale: str
    sensitivity_level: Literal["low", "medium", "high"]
    caution: str | None = None
    created_at: datetime


class GatheringStartRequest(APIModel):
    prompt_id: str = Field(min_length=1, max_length=36)
