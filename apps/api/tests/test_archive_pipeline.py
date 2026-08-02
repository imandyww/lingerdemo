from __future__ import annotations

import pytest
from fastapi import HTTPException
from linger_api.api import confirm_extraction, extract_memory
from linger_api.config import Settings
from linger_api.models import (
    ConversationPrompt,
    ExtractionDraft,
    LifeEvent,
    Person,
    Story,
    UnresolvedQuestion,
)
from linger_api.providers.mock import (
    DEMO_EXTRACTION_TRANSCRIPT,
    DEMO_FRONTEND_TRANSCRIPT,
    MockMemoryExtractionProvider,
)
from linger_api.schemas import (
    ExtractedMemory,
    ExtractedPerson,
    ExtractionConfirmRequest,
    ExtractionRequest,
    FamilyContext,
    Provenance,
)
from linger_api.seed import DEMO_FAMILY_ID, seed_demo_data
from linger_api.services.archive import (
    archive_aggregate,
    default_speaker_id,
    delete_story,
    family_context,
    save_confirmed_extraction,
    save_memory_direct,
    update_story_archive,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

TRANSCRIPT = DEMO_EXTRACTION_TRANSCRIPT


async def test_full_demo_extraction_transaction_updates_archive_timeline_tree_and_prompt(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        assert await seed_demo_data(session)
    async with session_factory() as session:
        context = await family_context(session, DEMO_FAMILY_ID)
        speaker_id = await default_speaker_id(session, DEMO_FAMILY_ID)
        memory = await MockMemoryExtractionProvider().extract(TRANSCRIPT, context)
        assert memory.events[0].approximate_date == "1968"
        assert memory.events[0].provenance is not None
        assert "family_context" in " ".join(memory.events[0].provenance.sources)
        assert memory.places[0].provenance is not None
        assert memory.places[0].provenance.kind == "derived"
    async with session_factory() as session:
        story, people, events, questions, prompts = await save_confirmed_extraction(
            session,
            family_id=DEMO_FAMILY_ID,
            speaker_id=speaker_id,
            transcript=TRANSCRIPT,
            original_memory=memory,
            corrected_memory=None,
            sharing_permission="private",
            retain_audio=False,
        )
        assert story.title == "The day I left home"
        assert {person.name for person in people} == {"Ming", "Mother"}
        assert events[0].approximate_date == "1968"
        assert questions[0].question == "What happened to Ming after that day?"
        assert prompts[0].prompt == "Ask Mei Lin: What happened to Ming after that day?"
        assert story.sharing_permission == "private"
        assert events[0].provenance["kind"] == "user_confirmation"
        assert events[0].provenance["source"]["kind"] == "derived"
        assert "family_context" in " ".join(events[0].provenance["source"]["sources"])
        assert all(person.provenance["kind"] == "user_confirmation" for person in people)
        archive = await archive_aggregate(session, DEMO_FAMILY_ID)
        assert any(item["id"] == story.id for item in archive["stories"])
        assert any(item["story_id"] == story.id for item in archive["life_events"])
        ming = next(item for item in archive["people"] if item["name"] == "Ming")
        assert story.id in ming["related_story_ids"]


async def test_extraction_review_is_not_persisted_before_consent(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        await seed_demo_data(session)
        result = await extract_memory(
            ExtractionRequest(family_id=DEMO_FAMILY_ID, transcript=TRANSCRIPT),
            session,
            Settings(app_environment="test", llm_provider="mock"),
        )
        draft_count = await session.scalar(select(func.count()).select_from(ExtractionDraft))
    assert "extraction_id" not in result
    assert result["status"] == "awaiting_confirmation"
    assert draft_count == 0


async def test_user_corrections_replace_model_provenance_for_every_persisted_fact(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        await seed_demo_data(session)
        context = await family_context(session, DEMO_FAMILY_ID)
        speaker_id = await default_speaker_id(session, DEMO_FAMILY_ID)
    original = await MockMemoryExtractionProvider().extract(TRANSCRIPT, context)
    corrected = original.model_copy(deep=True)
    corrected.suggested_title = "Lian at the harbor"
    corrected.summary = "At eighteen, Mei said goodbye to her older sister Lian at the harbor."
    corrected.people[0].name = "Lian"
    corrected.people[0].relationship = "older sister"
    corrected.people[0].aliases = ["Aunt Lian"]
    corrected.places[0].name = "Harbor terminal"
    corrected.events[0].title = "Said goodbye at the harbor"
    corrected.events[0].description = "Mei left while Lian stayed at the harbor."
    corrected.events[0].approximate_date = "1969"
    corrected.emotional_themes = ["departure", "sisterhood"]
    corrected.unresolved_questions = ["Where did her older sister Lian settle?"]
    corrected.sensitivity_level = "high"
    corrected.notable_quotes = ["Lian stayed at the harbor."]

    async with session_factory() as session:
        story, people, events, questions, prompts = await save_confirmed_extraction(
            session,
            family_id=DEMO_FAMILY_ID,
            speaker_id=speaker_id,
            transcript=TRANSCRIPT,
            original_memory=original,
            corrected_memory=corrected,
            sharing_permission="private",
            retain_audio=False,
        )
        assert story.provenance["suggested_title"]["kind"] == "user_correction"
        assert story.provenance["summary"]["kind"] == "user_correction"
        assert story.provenance["places"]["kind"] == "user_correction"
        assert story.provenance["events"]["kind"] == "user_correction"
        assert story.provenance["sensitivity_level"]["kind"] == "user_correction"
        assert people[0].provenance["kind"] == "user_correction"
        assert people[0].relationship_to_primary_user == "older sister"
        assert people[1].provenance["kind"] == "user_confirmation"
        assert events[0].provenance["kind"] == "user_correction"
        assert events[0].provenance["source"]["kind"] == "derived"
        assert "family_context" in " ".join(events[0].provenance["source"]["sources"])
        assert events[0].approximate_date == "1969"
        assert events[0].location == "Harbor terminal"
        assert questions[0].provenance["kind"] == "user_correction"
        assert prompts[0].prompt == "Ask Mei Lin: Where did her older sister Lian settle?"


async def test_story_edit_updates_timeline_questions_and_gathering_prompt_transactionally(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    story_id = "20000000-0000-4000-8000-000000000001"
    async with session_factory() as session:
        await seed_demo_data(session)
        story, questions = await update_story_archive(
            session,
            story_id,
            {
                "approximate_start_date": "Summer 1974",
                "location": "Riverside hall",
                "unresolved_questions": ["Who introduced Mei and Arthur?"],
            },
        )
        event = await session.scalar(select(LifeEvent).where(LifeEvent.story_id == story_id))
        prompt = await session.scalar(
            select(ConversationPrompt).where(ConversationPrompt.source_story_id == story_id)
        )
        stored_questions = list(
            (
                await session.scalars(
                    select(UnresolvedQuestion).where(UnresolvedQuestion.story_id == story_id)
                )
            ).all()
        )
    assert story.approximate_start_date == "Summer 1974"
    assert story.location == "Riverside hall"
    assert event is not None
    assert event.approximate_date == "Summer 1974"
    assert event.location == "Riverside hall"
    assert event.provenance["approximate_date"]["kind"] == "user_correction"
    assert [item.question for item in questions] == ["Who introduced Mei and Arthur?"]
    assert [item.question for item in stored_questions] == ["Who introduced Mei and Arthur?"]
    assert prompt is not None
    assert prompt.prompt == "Ask Mei Lin: Who introduced Mei and Arthur?"


async def test_title_and_sensitivity_only_edits_refresh_existing_gathering_prompt(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    story_id = "20000000-0000-4000-8000-000000000001"
    async with session_factory() as session:
        await seed_demo_data(session)
        await update_story_archive(
            session,
            story_id,
            {"title": "The summer dance", "sensitivity_level": "high"},
        )
        prompt = await session.scalar(
            select(ConversationPrompt).where(ConversationPrompt.source_story_id == story_id)
        )
    assert prompt is not None
    assert prompt.rationale == "This question remains open in “The summer dance.”"
    assert prompt.sensitivity_level == "high"
    assert prompt.caution == "Ask only if she seems comfortable."


async def test_delete_story_removes_only_unreferenced_extraction_people(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    provenance = Provenance(
        kind="direct", sources=["transcript"], explanation="The name was spoken.", confidence=1.0
    )
    memory = ExtractedMemory(
        suggested_title="A walk with Rowan",
        summary="The speaker walked with Rowan.",
        people=[ExtractedPerson(name="Rowan", relationship="friend", confidence=1, provenance=provenance)],
        sensitivity_level="low",
    )
    async with session_factory() as session:
        await seed_demo_data(session)
        speaker_id = await default_speaker_id(session, DEMO_FAMILY_ID)
    async with session_factory() as session:
        story, people, *_ = await save_memory_direct(
            session,
            family_id=DEMO_FAMILY_ID,
            speaker_id=speaker_id,
            transcript="I walked with Rowan.",
            memory=memory,
            sharing_permission="private",
        )
        story_id = story.id
        rowan_id = people[0].id
    async with session_factory() as session:
        assert await delete_story(session, story_id)
        assert await session.get(Person, rowan_id) is None
        assert await session.get(Person, speaker_id) is not None


async def test_confirmed_story_can_omit_transcript_under_archive_retention_policy(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    memory = ExtractedMemory(
        suggested_title="A private metadata-only memory",
        summary="Only non-transcript metadata is retained.",
        sensitivity_level="low",
    )
    async with session_factory() as session:
        await seed_demo_data(session)
        speaker_id = await default_speaker_id(session, DEMO_FAMILY_ID)
    async with session_factory() as session:
        story, *_ = await save_memory_direct(
            session,
            family_id=DEMO_FAMILY_ID,
            speaker_id=speaker_id,
            transcript="Sensitive raw transcript.",
            memory=memory,
            sharing_permission="private",
            retain_transcript=False,
        )
    assert story.transcript == "[Transcript not retained by archive policy.]"
    assert "Sensitive" not in story.transcript


async def test_raw_audio_retention_is_rejected_until_storage_exists(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    memory = ExtractedMemory(
        suggested_title="No false audio flag",
        summary="Audio has no object reference.",
        sensitivity_level="low",
    )
    request = ExtractionConfirmRequest(
        family_id=DEMO_FAMILY_ID,
        transcript="A transcript",
        original_memory=memory,
        consent=True,
        retain_audio=True,
    )
    async with session_factory() as session:
        with pytest.raises(HTTPException) as caught:
            await confirm_extraction(request, session, Settings(app_environment="test"))
    assert caught.value.status_code == 409
    assert "object storage" in str(caught.value.detail)


async def test_mock_extraction_does_not_fabricate_demo_facts_from_keyword_overlap() -> None:
    memory = await MockMemoryExtractionProvider().extract(
        "Ming gave me a red scarf.",
        FamilyContext(primary_user_name="Speaker", primary_user_birth_year=1951),
    )
    serialized = memory.model_dump_json().casefold()
    assert memory.summary == "Ming gave me a red scarf."
    assert memory.people == []
    assert memory.events == []
    assert "train" not in serialized
    assert "mother" not in serialized
    assert "1968" not in serialized


async def test_mock_extraction_accepts_only_the_exact_scripted_frontend_conversation() -> None:
    context = FamilyContext(primary_user_name="Mei Lin", primary_user_birth_year=1951)
    memory = await MockMemoryExtractionProvider().extract(DEMO_FRONTEND_TRANSCRIPT, context)
    assert memory.suggested_title == "The day I left home"
    assert memory.events[0].approximate_date == "1968"
    altered = await MockMemoryExtractionProvider().extract(
        DEMO_FRONTEND_TRANSCRIPT.replace("Who was with you?", "Tell me more."), context
    )
    assert altered.events == []


async def test_year_is_not_fabricated_without_birth_year_context() -> None:
    context = FamilyContext(primary_user_name="Speaker", primary_user_birth_year=None)
    memory = await MockMemoryExtractionProvider().extract(TRANSCRIPT, context)
    assert memory.events[0].approximate_date is None
    assert memory.events[0].provenance is not None
    assert memory.events[0].provenance.kind == "direct"


async def test_low_confidence_person_is_not_automatically_merged(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        await seed_demo_data(session)
        speaker_id = await default_speaker_id(session, DEMO_FAMILY_ID)
        session.add(
            Person(
                family_id=DEMO_FAMILY_ID,
                name="Sam",
                normalized_name="sam",
                relationship_to_primary_user="friend",
            )
        )
        await session.commit()
    provenance = Provenance(
        kind="direct", sources=["transcript"], explanation="Name was spoken.", confidence=0.5
    )
    memory = ExtractedMemory(
        suggested_title="A memory with Sam",
        summary="The speaker remembered someone named Sam.",
        people=[ExtractedPerson(name="Sam", confidence=0.5, provenance=provenance)],
        places=[],
        events=[],
        emotional_themes=[],
        unresolved_questions=[],
        sensitivity_level="low",
        notable_quotes=[],
    )
    async with session_factory() as session:
        await save_memory_direct(
            session,
            family_id=DEMO_FAMILY_ID,
            speaker_id=speaker_id,
            transcript="Sam was there.",
            memory=memory,
            sharing_permission="family",
        )
        count = await session.scalar(
            select(func.count())
            .select_from(Person)
            .where(Person.family_id == DEMO_FAMILY_ID, Person.name == "Sam")
        )
        assert count == 2


async def test_same_name_high_confidence_still_needs_alias_and_relationship_evidence(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        await seed_demo_data(session)
        speaker_id = await default_speaker_id(session, DEMO_FAMILY_ID)
        session.add(
            Person(
                family_id=DEMO_FAMILY_ID,
                name="Taylor",
                normalized_name="taylor",
                relationship_to_primary_user="friend",
                aliases=[],
            )
        )
        await session.commit()
    provenance = Provenance(
        kind="direct", sources=["transcript"], explanation="Name was spoken.", confidence=0.99
    )
    memory = ExtractedMemory(
        suggested_title="A memory with Taylor",
        summary="The speaker remembered Taylor.",
        people=[
            ExtractedPerson(name="Taylor", relationship="friend", confidence=0.99, provenance=provenance)
        ],
        sensitivity_level="low",
    )
    async with session_factory() as session:
        await save_memory_direct(
            session,
            family_id=DEMO_FAMILY_ID,
            speaker_id=speaker_id,
            transcript="Taylor was there.",
            memory=memory,
            sharing_permission="family",
        )
        count = await session.scalar(
            select(func.count())
            .select_from(Person)
            .where(Person.family_id == DEMO_FAMILY_ID, Person.name == "Taylor")
        )
        assert count == 2


async def test_database_transaction_rolls_back_on_invalid_speaker(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        await seed_demo_data(session)
    memory = ExtractedMemory(
        suggested_title="Unsaved",
        summary="This must not persist.",
        sensitivity_level="low",
    )
    async with session_factory() as session:
        before = await session.scalar(select(func.count()).select_from(Story))
    async with session_factory() as session:
        try:
            await save_memory_direct(
                session,
                family_id=DEMO_FAMILY_ID,
                speaker_id="ffffffff-ffff-4fff-8fff-ffffffffffff",
                transcript="Not saved",
                memory=memory,
                sharing_permission="family",
            )
        except LookupError:
            pass
    async with session_factory() as session:
        after = await session.scalar(select(func.count()).select_from(Story))
    assert after == before
