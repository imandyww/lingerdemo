from __future__ import annotations

import re
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    ConversationPrompt,
    Family,
    LifeEvent,
    Person,
    Story,
    StoryPerson,
    UnresolvedQuestion,
    User,
)
from ..schemas import ExtractedMemory, FamilyContext, Provenance, ProvenanceEvidence

REVIEWED_MEMORY_FIELDS = (
    "suggested_title",
    "summary",
    "people",
    "places",
    "events",
    "emotional_themes",
    "unresolved_questions",
    "sensitivity_level",
    "notable_quotes",
)


def normalize_person_name(name: str) -> str:
    return " ".join(re.sub(r"[^\w\s'-]", "", name, flags=re.UNICODE).casefold().split())


async def family_context(session: AsyncSession, family_id: str) -> FamilyContext:
    primary = await session.scalar(
        select(User).where(User.family_id == family_id).order_by(User.created_at).limit(1)
    )
    preferred = await session.scalar(
        select(User).where(User.family_id == family_id, User.role == "primary_speaker").limit(1)
    )
    primary = preferred or primary
    if primary is None:
        raise LookupError("family has no user context")
    people = (await session.scalars(select(Person).where(Person.family_id == family_id))).all()
    return FamilyContext(
        primary_user_name=primary.name,
        primary_user_birth_year=primary.birth_year,
        known_people=[
            {
                "id": person.id,
                "name": person.name,
                "aliases": person.aliases,
                "relationship": person.relationship_to_primary_user,
                "birth_year": person.birth_year,
            }
            for person in people
        ],
        known_facts=[
            {
                "fact": f"{primary.name} was born in {primary.birth_year}",
                "source": "stored user profile",
                "confidence": 1.0,
            }
        ]
        if primary.birth_year is not None
        else [],
    )


async def default_speaker_id(session: AsyncSession, family_id: str) -> str:
    speaker = await session.scalar(
        select(Person)
        .where(Person.family_id == family_id, Person.relationship_to_primary_user == "self")
        .limit(1)
    )
    if speaker is None:
        raise LookupError("family has no primary speaker person")
    return speaker.id


def _review_provenance(
    field_path: str, *, changed: bool, source: Provenance | None = None
) -> Provenance:
    kind = "user_correction" if changed else "user_confirmation"
    action = "corrected" if changed else "confirmed"
    return Provenance(
        kind=kind,
        sources=[kind],
        explanation=f"The user {action} {field_path} before consenting to archive persistence.",
        confidence=1.0,
        source=ProvenanceEvidence.model_validate(source.model_dump(exclude={"source"})) if source else None,
    )


def _without_provenance(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", exclude={"provenance"})
    return value


def review_memory_for_persistence(
    original: ExtractedMemory, corrected: ExtractedMemory | None
) -> ExtractedMemory:
    """Return a deep copy whose persisted facts record user confirmation/correction."""
    reviewed = (corrected or original).model_copy(deep=True)
    for field_name in REVIEWED_MEMORY_FIELDS:
        changed = getattr(original, field_name) != getattr(reviewed, field_name)
        reviewed.provenance[field_name] = _review_provenance(
            field_name, changed=changed, source=original.provenance.get(field_name)
        )

    for index, person_item in enumerate(reviewed.people):
        prior_person = original.people[index] if index < len(original.people) else None
        changed = prior_person is None or _without_provenance(prior_person) != _without_provenance(
            person_item
        )
        person_item.provenance = _review_provenance(
            f"people[{index}]",
            changed=changed,
            source=prior_person.provenance if prior_person is not None else None,
        )
    for index, place_item in enumerate(reviewed.places):
        prior_place = original.places[index] if index < len(original.places) else None
        changed = prior_place is None or _without_provenance(prior_place) != _without_provenance(
            place_item
        )
        place_item.provenance = _review_provenance(
            f"places[{index}]",
            changed=changed,
            source=prior_place.provenance if prior_place is not None else None,
        )
    for index, event_item in enumerate(reviewed.events):
        prior_event = original.events[index] if index < len(original.events) else None
        changed = prior_event is None or _without_provenance(prior_event) != _without_provenance(
            event_item
        )
        event_item.provenance = _review_provenance(
            f"events[{index}]",
            changed=changed,
            source=prior_event.provenance if prior_event is not None else None,
        )
    return reviewed


def gathering_prompt_text(speaker_name: str, question: str) -> str:
    return f"Ask {speaker_name}: {question}"


async def _resolve_person(
    session: AsyncSession,
    *,
    family_id: str,
    extracted_name: str,
    relationship: str | None,
    aliases: list[str],
    confidence: float,
    provenance: dict[str, Any],
    disambiguator: str,
) -> Person:
    normalized = normalize_person_name(extracted_name)
    existing = await session.scalar(
        select(Person).where(Person.family_id == family_id, Person.normalized_name == normalized).limit(1)
    )
    alias_evidence = bool(
        existing
        and {alias.casefold() for alias in existing.aliases}.intersection(
            alias.casefold() for alias in aliases
        )
    )
    relationship_evidence = bool(
        existing
        and relationship
        and existing.relationship_to_primary_user
        and relationship.casefold() == existing.relationship_to_primary_user.casefold()
    )
    if existing is not None and confidence >= 0.9 and alias_evidence and relationship_evidence:
        existing.aliases = sorted(set(existing.aliases + aliases))
        existing.confidence = max(existing.confidence, confidence)
        return existing
    if existing is not None:
        normalized = f"{normalized}#{disambiguator}"
    stored_provenance = dict(provenance)
    stored_provenance["record_origin"] = "story_extraction"
    person = Person(
        family_id=family_id,
        name=extracted_name,
        normalized_name=normalized,
        aliases=aliases,
        relationship_to_primary_user=relationship,
        confidence=confidence,
        provenance=stored_provenance,
    )
    session.add(person)
    await session.flush()
    return person


async def _persist_memory(
    session: AsyncSession,
    *,
    family_id: str,
    speaker_id: str,
    transcript: str,
    memory: ExtractedMemory,
    sharing_permission: str,
    retain_transcript: bool,
    disambiguator: str,
) -> tuple[Story, list[Person], list[LifeEvent], list[UnresolvedQuestion], list[ConversationPrompt]]:
    family = await session.get(Family, family_id)
    speaker = await session.get(Person, speaker_id)
    if family is None or speaker is None or speaker.family_id != family_id:
        raise LookupError("family or speaker not found")
    location = memory.places[0].name if memory.places else None
    approximate_date = next(
        (event.approximate_date for event in memory.events if event.approximate_date), None
    )
    story = Story(
        family_id=family_id,
        speaker_id=speaker_id,
        title=memory.suggested_title,
        summary=memory.summary,
        transcript=transcript if retain_transcript else "[Transcript not retained by archive policy.]",
        approximate_start_date=approximate_date,
        location=location,
        emotional_themes=memory.emotional_themes,
        sensitivity_level=memory.sensitivity_level,
        notable_quotes=memory.notable_quotes,
        sharing_permission=sharing_permission,
        consent_confirmed=True,
        audio_retained_with_consent=False,
        provenance={key: value.model_dump(mode="json") for key, value in memory.provenance.items()},
    )
    session.add(story)
    await session.flush()

    linked_people: list[Person] = []
    for index, extracted in enumerate(memory.people):
        provenance = extracted.provenance.model_dump(mode="json") if extracted.provenance else {}
        person = await _resolve_person(
            session,
            family_id=family_id,
            extracted_name=extracted.name,
            relationship=extracted.relationship,
            aliases=extracted.aliases,
            confidence=extracted.confidence,
            provenance=provenance,
            disambiguator=f"{disambiguator}-{index}",
        )
        linked_people.append(person)
        session.add(
            StoryPerson(
                story_id=story.id,
                person_id=person.id,
                role_in_story=extracted.relationship or "mentioned",
                confidence=extracted.confidence,
                provenance=provenance,
            )
        )

    events: list[LifeEvent] = []
    for extracted_event in memory.events:
        event = LifeEvent(
            family_id=family_id,
            story_id=story.id,
            title=extracted_event.title,
            description=extracted_event.description,
            approximate_date=extracted_event.approximate_date,
            location=location,
            confidence=extracted_event.confidence,
            provenance=extracted_event.provenance.model_dump(mode="json")
            if extracted_event.provenance
            else {},
        )
        session.add(event)
        events.append(event)

    questions: list[UnresolvedQuestion] = []
    question_provenance = memory.provenance.get("unresolved_questions")
    for question_text in memory.unresolved_questions:
        question = UnresolvedQuestion(
            story_id=story.id,
            question=question_text,
            provenance=question_provenance.model_dump(mode="json")
            if question_provenance
            else _review_provenance("unresolved_questions", changed=False).model_dump(mode="json"),
        )
        session.add(question)
        questions.append(question)

    prompts: list[ConversationPrompt] = []
    if memory.unresolved_questions:
        await session.flush()
        prompt_text = gathering_prompt_text(speaker.name, memory.unresolved_questions[0])
        caution = "Ask only if she seems comfortable." if memory.sensitivity_level == "high" else None
        prompt = ConversationPrompt(
            family_id=family_id,
            source_story_id=story.id,
            prompt=prompt_text,
            rationale="The saved story leaves a meaningful family question unresolved.",
            sensitivity_level=memory.sensitivity_level,
            caution=caution,
            provenance={"kind": "derived", "sources": [questions[0].id, story.id]},
        )
        session.add(prompt)
        prompts.append(prompt)
    await session.flush()
    return story, linked_people, events, questions, prompts


async def save_confirmed_extraction(
    session: AsyncSession,
    *,
    family_id: str,
    speaker_id: str | None,
    transcript: str,
    original_memory: ExtractedMemory,
    corrected_memory: ExtractedMemory | None,
    sharing_permission: str,
    retain_audio: bool,
    retain_transcript: bool = True,
) -> tuple[Story, list[Person], list[LifeEvent], list[UnresolvedQuestion], list[ConversationPrompt]]:
    if retain_audio:
        raise ValueError(
            "Raw audio retention is unavailable until consented object storage supplies a durable audio reference."
        )
    async with session.begin():
        resolved_speaker_id = speaker_id or await default_speaker_id(session, family_id)
        memory = review_memory_for_persistence(original_memory, corrected_memory)
        return await _persist_memory(
            session,
            family_id=family_id,
            speaker_id=resolved_speaker_id,
            transcript=transcript,
            memory=memory,
            sharing_permission=sharing_permission,
            retain_transcript=retain_transcript,
            disambiguator=uuid.uuid4().hex[:8],
        )


async def save_memory_direct(
    session: AsyncSession,
    *,
    family_id: str,
    speaker_id: str,
    transcript: str,
    memory: ExtractedMemory,
    sharing_permission: str,
    retain_transcript: bool = True,
) -> tuple[Story, list[Person], list[LifeEvent], list[UnresolvedQuestion], list[ConversationPrompt]]:
    async with session.begin():
        reviewed_memory = review_memory_for_persistence(memory, None)
        return await _persist_memory(
            session,
            family_id=family_id,
            speaker_id=speaker_id,
            transcript=transcript,
            memory=reviewed_memory,
            sharing_permission=sharing_permission,
            retain_transcript=retain_transcript,
            disambiguator=uuid.uuid4().hex[:8],
        )


async def update_story_archive(
    session: AsyncSession, story_id: str, updates: dict[str, Any]
) -> tuple[Story, list[UnresolvedQuestion]]:
    """Update a story and every archive projection it owns in one transaction."""
    async with session.begin():
        story = await session.scalar(select(Story).where(Story.id == story_id).with_for_update())
        if story is None:
            raise LookupError("story not found")

        story_provenance = dict(story.provenance)
        for key, value in updates.items():
            if key == "unresolved_questions":
                continue
            previous = getattr(story, key)
            setattr(story, key, value)
            story_provenance[key] = _review_provenance(key, changed=previous != value).model_dump(
                mode="json"
            )
        story.provenance = story_provenance

        if "approximate_start_date" in updates or "location" in updates:
            events = list(
                (await session.scalars(select(LifeEvent).where(LifeEvent.story_id == story.id))).all()
            )
            for event in events:
                event_provenance = dict(event.provenance)
                if "approximate_start_date" in updates:
                    date = updates["approximate_start_date"]
                    event_provenance["approximate_date"] = _review_provenance(
                        "approximate_date", changed=event.approximate_date != date
                    ).model_dump(mode="json")
                    event.approximate_date = date
                if "location" in updates:
                    location = updates["location"]
                    event_provenance["location"] = _review_provenance(
                        "location", changed=event.location != location
                    ).model_dump(mode="json")
                    event.location = location
                event.provenance = event_provenance

        questions = list(
            (
                await session.scalars(
                    select(UnresolvedQuestion)
                    .where(UnresolvedQuestion.story_id == story.id)
                    .order_by(UnresolvedQuestion.created_at, UnresolvedQuestion.id)
                )
            ).all()
        )
        if "unresolved_questions" in updates:
            requested_questions = updates["unresolved_questions"]
            story_provenance = dict(story.provenance)
            story_provenance["unresolved_questions"] = _review_provenance(
                "unresolved_questions",
                changed=[question.question for question in questions] != requested_questions,
            ).model_dump(mode="json")
            story.provenance = story_provenance
            question_provenance = story_provenance["unresolved_questions"]
            for index, question_text in enumerate(requested_questions):
                if index < len(questions):
                    questions[index].question = question_text
                    questions[index].status = "open"
                    questions[index].provenance = question_provenance
                else:
                    question = UnresolvedQuestion(
                        story_id=story.id,
                        question=question_text,
                        status="open",
                        provenance=question_provenance,
                    )
                    session.add(question)
                    questions.append(question)
            for question in questions[len(requested_questions) :]:
                await session.delete(question)
            questions = questions[: len(requested_questions)]
            await session.flush()

            prompts = list(
                (
                    await session.scalars(
                        select(ConversationPrompt)
                        .where(ConversationPrompt.source_story_id == story.id)
                        .order_by(ConversationPrompt.created_at, ConversationPrompt.id)
                    )
                ).all()
            )
            if questions:
                speaker = await session.get(Person, story.speaker_id)
                speaker_name = speaker.name if speaker is not None else "the storyteller"
                prompt_text = gathering_prompt_text(speaker_name, questions[0].question)
                caution = (
                    "Ask only if she seems comfortable." if story.sensitivity_level == "high" else None
                )
                if prompts:
                    prompt = prompts[0]
                    prompt.prompt = prompt_text
                    prompt.rationale = f"This question remains open in “{story.title}.”"
                    prompt.sensitivity_level = story.sensitivity_level
                    prompt.caution = caution
                    prompt.provenance = {
                        "kind": "user_correction",
                        "sources": [questions[0].id, story.id],
                    }
                else:
                    session.add(
                        ConversationPrompt(
                            family_id=story.family_id,
                            source_story_id=story.id,
                            prompt=prompt_text,
                            rationale=f"This question remains open in “{story.title}.”",
                            sensitivity_level=story.sensitivity_level,
                            caution=caution,
                            provenance={
                                "kind": "derived",
                                "sources": [questions[0].id, story.id],
                            },
                        )
                    )
                for extra_prompt in prompts[1:]:
                    await session.delete(extra_prompt)
            else:
                for prompt in prompts:
                    await session.delete(prompt)
        elif {"sensitivity_level", "title"}.intersection(updates):
            affected_prompts = (
                await session.scalars(
                    select(ConversationPrompt).where(ConversationPrompt.source_story_id == story.id)
                )
            ).all()
            for prompt in affected_prompts:
                if "title" in updates:
                    prompt.rationale = f"This question remains open in “{story.title}.”"
                if "sensitivity_level" in updates:
                    prompt.sensitivity_level = story.sensitivity_level
                    prompt.caution = (
                        "Ask only if she seems comfortable."
                        if story.sensitivity_level == "high"
                        else None
                    )

    await session.refresh(story)
    return story, questions


async def archive_aggregate(session: AsyncSession, family_id: str) -> dict[str, Any]:
    family = await session.get(Family, family_id)
    if family is None:
        raise LookupError("family not found")
    primary = await session.scalar(
        select(User).where(User.family_id == family_id, User.role == "primary_speaker").limit(1)
    )
    people = list((await session.scalars(select(Person).where(Person.family_id == family_id))).all())
    stories = list(
        (
            await session.scalars(
                select(Story).where(Story.family_id == family_id).order_by(Story.created_at)
            )
        ).all()
    )
    story_ids = [story.id for story in stories]
    links = (
        list((await session.scalars(select(StoryPerson).where(StoryPerson.story_id.in_(story_ids)))).all())
        if story_ids
        else []
    )
    events = list((await session.scalars(select(LifeEvent).where(LifeEvent.family_id == family_id))).all())
    questions = (
        list(
            (
                await session.scalars(
                    select(UnresolvedQuestion).where(UnresolvedQuestion.story_id.in_(story_ids))
                )
            ).all()
        )
        if story_ids
        else []
    )
    prompts = list(
        (
            await session.scalars(select(ConversationPrompt).where(ConversationPrompt.family_id == family_id))
        ).all()
    )
    people_by_id = {person.id: person for person in people}
    story_by_id = {story.id: story for story in stories}
    links_by_story: dict[str, list[StoryPerson]] = {}
    for link in links:
        links_by_story.setdefault(link.story_id, []).append(link)
    questions_by_story: dict[str, list[UnresolvedQuestion]] = {}
    for question in questions:
        questions_by_story.setdefault(question.story_id, []).append(question)
    return {
        "family": {"id": family.id, "family_name": family.family_name, "created_at": family.created_at},
        "primary_user": {
            "id": primary.id,
            "name": primary.name,
            "birth_year": primary.birth_year,
            "preferred_language": primary.preferred_language,
        }
        if primary
        else None,
        "people": [
            {
                "id": person.id,
                "family_id": person.family_id,
                "name": person.name,
                "aliases": person.aliases,
                "relationship_to_primary_user": person.relationship_to_primary_user,
                "birth_year": person.birth_year,
                "death_year": person.death_year,
                "notes": person.notes,
                "confidence": person.confidence,
                "provenance": person.provenance,
                "related_story_ids": [link.story_id for link in person.story_links]
                if "story_links" in person.__dict__
                else [link.story_id for link in links if link.person_id == person.id],
            }
            for person in people
        ],
        "stories": [
            {
                "id": story.id,
                "family_id": story.family_id,
                "speaker_id": story.speaker_id,
                "speaker": people_by_id[story.speaker_id].name if story.speaker_id in people_by_id else None,
                "title": story.title,
                "summary": story.summary,
                "transcript": story.transcript,
                "audio_url": story.audio_url,
                "approximate_start_date": story.approximate_start_date,
                "approximate_end_date": story.approximate_end_date,
                "location": story.location,
                "emotional_themes": story.emotional_themes,
                "sensitivity_level": story.sensitivity_level,
                "notable_quotes": story.notable_quotes,
                "sharing_permission": story.sharing_permission,
                "consent_confirmed": story.consent_confirmed,
                "created_at": story.created_at,
                "updated_at": story.updated_at,
                "people": [
                    {
                        "id": people_by_id[link.person_id].id,
                        "name": people_by_id[link.person_id].name,
                        "role_in_story": link.role_in_story,
                    }
                    for link in links_by_story.get(story.id, [])
                    if link.person_id in people_by_id
                ],
                "unresolved_questions": [
                    {"id": item.id, "question": item.question, "status": item.status}
                    for item in questions_by_story.get(story.id, [])
                ],
            }
            for story in stories
        ],
        "life_events": [
            {
                "id": event.id,
                "family_id": event.family_id,
                "story_id": event.story_id,
                "source_story_title": story_by_id[event.story_id].title
                if event.story_id in story_by_id
                else None,
                "title": event.title,
                "description": event.description,
                "approximate_date": event.approximate_date,
                "location": event.location,
                "confidence": event.confidence,
                "provenance": event.provenance,
            }
            for event in events
        ],
        "unresolved_questions": [
            {
                "id": question.id,
                "story_id": question.story_id,
                "question": question.question,
                "status": question.status,
                "created_at": question.created_at,
            }
            for question in questions
        ],
        "conversation_prompts": [
            {
                "id": prompt.id,
                "family_id": prompt.family_id,
                "source_story_id": prompt.source_story_id,
                "source_story_title": story_by_id[prompt.source_story_id].title
                if prompt.source_story_id in story_by_id
                else None,
                "prompt": prompt.prompt,
                "rationale": prompt.rationale,
                "sensitivity_level": prompt.sensitivity_level,
                "caution": prompt.caution,
                "created_at": prompt.created_at,
            }
            for prompt in prompts
        ],
    }


async def delete_story(session: AsyncSession, story_id: str) -> bool:
    story = await session.scalar(select(Story).where(Story.id == story_id).with_for_update())
    if story is None:
        return False
    person_ids = list(
        (
            await session.scalars(
                select(StoryPerson.person_id).where(StoryPerson.story_id == story_id)
            )
        ).all()
    )
    await session.delete(story)
    await session.flush()
    for person_id in person_ids:
        remaining_links = await session.scalar(
            select(StoryPerson.person_id).where(StoryPerson.person_id == person_id).limit(1)
        )
        if remaining_links is not None:
            continue
        person = await session.get(Person, person_id)
        if person is not None and person.provenance.get("record_origin") == "story_extraction":
            await session.delete(person)
    await session.commit()
    return True
