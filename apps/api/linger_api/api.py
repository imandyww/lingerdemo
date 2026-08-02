from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from .config import Settings, get_settings
from .database import get_session
from .models import ConversationPrompt, LifeEvent, Person, Story, UnresolvedQuestion
from .providers.mock import MockMemoryExtractionProvider
from .schemas import (
    DirectStoryCreateRequest,
    ExtractionConfirmRequest,
    ExtractionRequest,
    GatheringStartRequest,
    StoryUpdateRequest,
)
from .seed import DEMO_FAMILY_ID
from .services.archive import (
    archive_aggregate,
    default_speaker_id,
    delete_story,
    family_context,
    gathering_prompt_text,
    save_confirmed_extraction,
    save_memory_direct,
    update_story_archive,
)
from .services.extraction import TenstorrentMemoryExtractionProvider

router = APIRouter(prefix="/api")
SessionDependency = Annotated[AsyncSession, Depends(get_session)]
SettingsDependency = Annotated[Settings, Depends(get_settings)]


def _not_found(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)


def _conflict(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)


async def _get_archive(session: AsyncSession, family_id: str) -> dict[str, Any]:
    try:
        return await archive_aggregate(session, family_id)
    except LookupError as exc:
        raise _not_found(str(exc)) from exc


@router.get("/demo")
async def demo_archive(session: SessionDependency) -> dict[str, Any]:
    return await _get_archive(session, DEMO_FAMILY_ID)


@router.get("/archive")
async def archive_alias(session: SessionDependency) -> dict[str, Any]:
    return await _get_archive(session, DEMO_FAMILY_ID)


@router.get("/families/{family_id}/archive")
async def family_archive(family_id: str, session: SessionDependency) -> dict[str, Any]:
    return await _get_archive(session, family_id)


@router.get("/families/{family_id}/timeline")
async def family_timeline(family_id: str, session: SessionDependency) -> dict[str, Any]:
    archive = await _get_archive(session, family_id)
    return {"life_events": archive["life_events"]}


@router.get("/families/{family_id}/people")
async def family_people(family_id: str, session: SessionDependency) -> dict[str, Any]:
    archive = await _get_archive(session, family_id)
    return {"people": archive["people"]}


@router.post("/extractions", status_code=status.HTTP_201_CREATED)
async def extract_memory(
    request: ExtractionRequest,
    session: SessionDependency,
    settings: SettingsDependency,
) -> dict[str, Any]:
    try:
        context = await family_context(session, request.family_id)
        speaker_id = request.speaker_id or await default_speaker_id(session, request.family_id)
    except LookupError as exc:
        raise _not_found(str(exc)) from exc
    if settings.llm_provider == "tenstorrent":
        provider = TenstorrentMemoryExtractionProvider(settings)
        try:
            extracted = await provider.extract(request.transcript, context)
        finally:
            await provider.close()
    else:
        extracted = await MockMemoryExtractionProvider().extract(request.transcript, context)
    return {
        "family_id": request.family_id,
        "speaker_id": speaker_id,
        "status": "awaiting_confirmation",
        "extracted_memory": extracted.model_dump(mode="json"),
    }


def _saved_payload(
    result: tuple[Story, list[Person], list[LifeEvent], list[UnresolvedQuestion], list[ConversationPrompt]],
) -> dict[str, Any]:
    story, people, events, questions, prompts = result
    return {
        "story": {
            "id": story.id,
            "family_id": story.family_id,
            "speaker_id": story.speaker_id,
            "title": story.title,
            "summary": story.summary,
            "transcript": story.transcript,
            "approximate_start_date": story.approximate_start_date,
            "location": story.location,
            "emotional_themes": story.emotional_themes,
            "sensitivity_level": story.sensitivity_level,
            "sharing_permission": story.sharing_permission,
            "consent_confirmed": story.consent_confirmed,
        },
        "people": [
            {
                "id": person.id,
                "name": person.name,
                "aliases": person.aliases,
                "relationship_to_primary_user": person.relationship_to_primary_user,
                "confidence": person.confidence,
            }
            for person in people
        ],
        "life_events": [
            {
                "id": event.id,
                "story_id": event.story_id,
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
            }
            for question in questions
        ],
        "conversation_prompts": [
            {
                "id": prompt.id,
                "source_story_id": prompt.source_story_id,
                "prompt": prompt.prompt,
                "rationale": prompt.rationale,
                "sensitivity_level": prompt.sensitivity_level,
                "caution": prompt.caution,
            }
            for prompt in prompts
        ],
    }


@router.post("/extractions/confirm", status_code=status.HTTP_201_CREATED)
async def confirm_extraction(
    request: ExtractionConfirmRequest,
    session: SessionDependency,
    settings: SettingsDependency,
) -> dict[str, Any]:
    try:
        result = await save_confirmed_extraction(
            session,
            family_id=request.family_id,
            speaker_id=request.speaker_id,
            transcript=request.transcript,
            original_memory=request.original_memory,
            corrected_memory=request.corrected_memory,
            sharing_permission=request.sharing_permission,
            retain_audio=request.retain_audio,
            retain_transcript=settings.transcript_retention,
        )
    except LookupError as exc:
        raise _not_found(str(exc)) from exc
    except ValueError as exc:
        raise _conflict(str(exc)) from exc
    payload = _saved_payload(result)
    payload["archive"] = await _get_archive(session, result[0].family_id)
    return payload


@router.post("/archive/stories", status_code=status.HTTP_201_CREATED)
async def create_story_direct(
    request: DirectStoryCreateRequest,
    session: SessionDependency,
    settings: SettingsDependency,
) -> dict[str, Any]:
    try:
        result = await save_memory_direct(
            session,
            family_id=request.family_id,
            speaker_id=request.speaker_id,
            transcript=request.transcript,
            memory=request.memory,
            sharing_permission=request.sharing_permission,
            retain_transcript=settings.transcript_retention,
        )
    except LookupError as exc:
        raise _not_found(str(exc)) from exc
    return _saved_payload(result)


@router.patch("/stories/{story_id}")
async def update_story(
    story_id: str, request: StoryUpdateRequest, session: SessionDependency
) -> dict[str, Any]:
    try:
        story, questions = await update_story_archive(
            session, story_id, request.model_dump(exclude_unset=True)
        )
    except LookupError as exc:
        raise _not_found(str(exc)) from exc
    return {
        "id": story.id,
        "title": story.title,
        "summary": story.summary,
        "transcript": story.transcript,
        "approximate_start_date": story.approximate_start_date,
        "location": story.location,
        "emotional_themes": story.emotional_themes,
        "sensitivity_level": story.sensitivity_level,
        "sharing_permission": story.sharing_permission,
        "unresolved_questions": [
            {"id": question.id, "question": question.question, "status": question.status}
            for question in questions
        ],
        "updated_at": story.updated_at,
    }


@router.delete("/stories/{story_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_story(story_id: str, session: SessionDependency) -> Response:
    if not await delete_story(session, story_id):
        raise _not_found("story not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/stories/{story_id}/export", response_class=PlainTextResponse)
async def export_story(story_id: str, session: SessionDependency) -> PlainTextResponse:
    story = await session.get(Story, story_id)
    if story is None:
        raise _not_found("story not found")
    content = (
        f"# {story.title}\n\n{story.summary}\n\n"
        f"Approximate date: {story.approximate_start_date or 'Not recorded'}\n"
        f"Place: {story.location or 'Not recorded'}\n"
        f"Sharing: {story.sharing_permission}\n\n## Transcript\n\n{story.transcript}\n"
    )
    return PlainTextResponse(
        content,
        headers={"Content-Disposition": f'attachment; filename="linger-story-{story.id}.md"'},
    )


@router.get("/families/{family_id}/gathering-prompts")
async def gathering_prompts(family_id: str, session: SessionDependency) -> dict[str, Any]:
    archive = await _get_archive(session, family_id)
    return {"prompts": archive["conversation_prompts"]}


@router.post("/families/{family_id}/gathering-prompts/generate")
async def generate_gathering_prompts(family_id: str, session: SessionDependency) -> dict[str, Any]:
    archive = await _get_archive(session, family_id)
    existing_story_ids = {prompt["source_story_id"] for prompt in archive["conversation_prompts"]}
    stories = {story["id"]: story for story in archive["stories"]}
    for question in archive["unresolved_questions"]:
        if question["status"] != "open" or question["story_id"] in existing_story_ids:
            continue
        story = stories.get(question["story_id"])
        if story is None:
            continue
        prompt = ConversationPrompt(
            family_id=family_id,
            source_story_id=story["id"],
            prompt=gathering_prompt_text(story["speaker"] or "the storyteller", question["question"]),
            rationale=f"This question remains open in “{story['title']}.”",
            sensitivity_level=story["sensitivity_level"],
            caution="Ask only if she seems comfortable." if story["sensitivity_level"] == "high" else None,
            provenance={"kind": "derived", "sources": [question["id"], story["id"]]},
        )
        session.add(prompt)
    await session.commit()
    refreshed = await _get_archive(session, family_id)
    return {"prompts": refreshed["conversation_prompts"]}


@router.post("/gathering/start")
async def start_gathering(request: GatheringStartRequest, session: SessionDependency) -> dict[str, Any]:
    prompt = await session.get(ConversationPrompt, request.prompt_id)
    if prompt is None:
        raise _not_found("conversation prompt not found")
    return {
        "introduction": prompt.prompt,
        "assistant_state": "quiet",
        "recording_active": False,
        "next_action": "Explicitly resume the AI or start a new consented recording to preserve a memory.",
    }
