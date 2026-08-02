from __future__ import annotations

import asyncio

from sqlalchemy.ext.asyncio import AsyncSession

from .database import SessionLocal, init_database
from .models import (
    ConversationPrompt,
    Family,
    LifeEvent,
    Person,
    Story,
    StoryPerson,
    UnresolvedQuestion,
    User,
)

DEMO_FAMILY_ID = "10000000-0000-4000-8000-000000000001"
DEMO_USER_ID = "10000000-0000-4000-8000-000000000002"
DEMO_GRANDMA_ID = "10000000-0000-4000-8000-000000000003"
DEMO_GRANDPA_ID = "10000000-0000-4000-8000-000000000004"
DEMO_DAUGHTER_ID = "10000000-0000-4000-8000-000000000005"
DEMO_SON_ID = "10000000-0000-4000-8000-000000000006"
DEMO_GRANDDAUGHTER_ID = "10000000-0000-4000-8000-000000000007"
DEMO_GRANDSON_ID = "10000000-0000-4000-8000-000000000008"


async def seed_demo_data(session: AsyncSession) -> bool:
    if await session.get(Family, DEMO_FAMILY_ID) is not None:
        return False

    family = Family(id=DEMO_FAMILY_ID, family_name="Lin family")
    session.add(family)
    session.add(
        User(
            id=DEMO_USER_ID,
            family_id=DEMO_FAMILY_ID,
            name="Mei Lin",
            preferred_language="en-US",
            role="primary_speaker",
            birth_year=1951,
        )
    )
    people = [
        Person(
            id=DEMO_GRANDMA_ID,
            family_id=DEMO_FAMILY_ID,
            name="Mei Lin",
            normalized_name="mei lin",
            aliases=["Grandma", "Mom"],
            relationship_to_primary_user="self",
            birth_year=1951,
            notes="Primary oral-history speaker.",
        ),
        Person(
            id=DEMO_GRANDPA_ID,
            family_id=DEMO_FAMILY_ID,
            name="Arthur Lin",
            normalized_name="arthur lin",
            aliases=["Grandpa"],
            relationship_to_primary_user="spouse",
            birth_year=1949,
        ),
        Person(
            id=DEMO_DAUGHTER_ID,
            family_id=DEMO_FAMILY_ID,
            name="Helen Lin",
            normalized_name="helen lin",
            aliases=[],
            relationship_to_primary_user="daughter",
            birth_year=1977,
        ),
        Person(
            id=DEMO_SON_ID,
            family_id=DEMO_FAMILY_ID,
            name="Thomas Lin",
            normalized_name="thomas lin",
            aliases=["Tom"],
            relationship_to_primary_user="son",
            birth_year=1980,
        ),
        Person(
            id=DEMO_GRANDDAUGHTER_ID,
            family_id=DEMO_FAMILY_ID,
            name="Grace Lin",
            normalized_name="grace lin",
            aliases=[],
            relationship_to_primary_user="granddaughter",
            birth_year=2004,
        ),
        Person(
            id=DEMO_GRANDSON_ID,
            family_id=DEMO_FAMILY_ID,
            name="Alex Lin",
            normalized_name="alex lin",
            aliases=[],
            relationship_to_primary_user="grandson",
            birth_year=2007,
        ),
    ]
    session.add_all(people)
    await session.flush()

    story_specs = [
        (
            "20000000-0000-4000-8000-000000000001",
            "The community dance",
            "Mei met Arthur at a neighborhood community dance and noticed how carefully he listened to everyone.",
            "There was a community dance on a warm Saturday. Arthur asked whether the chair beside me was taken, then listened while I spoke about the books I liked.",
            "Around 1973",
            "Neighborhood community hall",
            ["beginnings", "companionship"],
            "low",
            [DEMO_GRANDMA_ID, DEMO_GRANDPA_ID],
        ),
        (
            "20000000-0000-4000-8000-000000000002",
            "Opening the family store",
            "Mei and Arthur opened a small grocery and learned every regular customer's name.",
            "We opened before sunrise on the first day. Arthur stocked the shelves while I wrote the prices by hand and worried nobody would come.",
            "1982",
            "Oak Street",
            ["work", "partnership", "community"],
            "low",
            [DEMO_GRANDMA_ID, DEMO_GRANDPA_ID],
        ),
        (
            "20000000-0000-4000-8000-000000000003",
            "The first weeks in California",
            "The family adjusted to a new city by sharing a small apartment and helping one another learn unfamiliar routines.",
            "Our first apartment in California had one narrow window. Helen helped me read the bus map, and we took the wrong bus twice before laughing about it.",
            "Late 1970s",
            "California",
            ["migration", "adaptation", "family"],
            "medium",
            [DEMO_GRANDMA_ID, DEMO_DAUGHTER_ID],
        ),
        (
            "20000000-0000-4000-8000-000000000004",
            "Grace learns the family dumplings",
            "Mei taught Grace to fold dumplings, including the small thumb press that keeps the filling inside.",
            "Grace was ten when she stood on a chair beside me at the kitchen counter. Her first dumpling leaned sideways, but it stayed closed in the pot.",
            "2014",
            "Family kitchen",
            ["tradition", "teaching", "joy"],
            "low",
            [DEMO_GRANDMA_ID, DEMO_GRANDDAUGHTER_ID],
        ),
        (
            "20000000-0000-4000-8000-000000000005",
            "The apartment with the narrow window",
            "Mei and Arthur furnished their first apartment together one practical piece at a time.",
            "The table came from a neighbor, and the two chairs did not match. We ate noodles there and planned what we would save for next.",
            "Around 1975",
            "First apartment",
            ["home", "partnership"],
            "low",
            [DEMO_GRANDMA_ID, DEMO_GRANDPA_ID],
        ),
    ]
    for index, spec in enumerate(story_specs, start=1):
        story_id, title, summary, transcript, date, location, themes, sensitivity, person_ids = spec
        story = Story(
            id=story_id,
            family_id=DEMO_FAMILY_ID,
            speaker_id=DEMO_GRANDMA_ID,
            title=title,
            summary=summary,
            transcript=transcript,
            approximate_start_date=date,
            location=location,
            emotional_themes=themes,
            sensitivity_level=sensitivity,
            sharing_permission="family",
            consent_confirmed=True,
            provenance={"seed": {"kind": "direct", "sources": ["demo fixture"]}},
        )
        session.add(story)
        await session.flush()
        for person_id in person_ids:
            session.add(StoryPerson(story_id=story_id, person_id=person_id, role_in_story="participant"))
        session.add(
            LifeEvent(
                id=f"30000000-0000-4000-8000-{index:012d}",
                family_id=DEMO_FAMILY_ID,
                story_id=story_id,
                title=title,
                description=summary,
                approximate_date=date,
                location=location,
                confidence=0.95 if date[:4].isdigit() else 0.78,
                provenance={"kind": "direct", "sources": ["seed story"]},
            )
        )

    questions = [
        (story_specs[0][0], "What song was playing when Mei and Arthur first danced?"),
        (story_specs[2][0], "Who helped the family find their first apartment in California?"),
        (story_specs[4][0], "What did Mei and Arthur save to buy after the table and chairs?"),
    ]
    for index, (story_id, question) in enumerate(questions, start=1):
        session.add(
            UnresolvedQuestion(
                id=f"40000000-0000-4000-8000-{index:012d}",
                story_id=story_id,
                question=question,
                status="open",
                provenance={"kind": "direct", "sources": ["demo fixture"]},
            )
        )
    session.add(
        ConversationPrompt(
            id="50000000-0000-4000-8000-000000000001",
            family_id=DEMO_FAMILY_ID,
            source_story_id=story_specs[0][0],
            prompt="Ask Grandma what song was playing when she first danced with Grandpa.",
            rationale="The story remembers their meeting but leaves the music unresolved.",
            sensitivity_level="low",
            provenance={"kind": "derived", "sources": ["seed unresolved question"]},
        )
    )
    await session.commit()
    return True


async def _main() -> None:
    await init_database()
    async with SessionLocal() as session:
        created = await seed_demo_data(session)
    print("Demo data seeded." if created else "Demo data already present; no changes made.")


if __name__ == "__main__":
    asyncio.run(_main())
