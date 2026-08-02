from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def new_id() -> str:
    return str(uuid.uuid4())


def now_utc() -> datetime:
    return datetime.now(UTC)


class Family(Base):
    __tablename__ = "families"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    family_name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    users: Mapped[list[User]] = relationship(back_populates="family", cascade="all, delete-orphan")
    people: Mapped[list[Person]] = relationship(back_populates="family", cascade="all, delete-orphan")
    stories: Mapped[list[Story]] = relationship(back_populates="family", cascade="all, delete-orphan")


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    family_id: Mapped[str] = mapped_column(ForeignKey("families.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    preferred_language: Mapped[str] = mapped_column(String(35), default="en-US", nullable=False)
    role: Mapped[str] = mapped_column(String(40), default="family_member", nullable=False)
    birth_year: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    family: Mapped[Family] = relationship(back_populates="users")
    sessions: Mapped[list[ConversationSession]] = relationship(back_populates="user")


class Person(Base):
    __tablename__ = "people"
    __table_args__ = (UniqueConstraint("family_id", "normalized_name", name="uq_person_family_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    family_id: Mapped[str] = mapped_column(ForeignKey("families.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(120), nullable=False)
    aliases: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    relationship_to_primary_user: Mapped[str | None] = mapped_column(String(120))
    birth_year: Mapped[int | None] = mapped_column(Integer)
    death_year: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    provenance: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    family: Mapped[Family] = relationship(back_populates="people")
    story_links: Mapped[list[StoryPerson]] = relationship(
        back_populates="person", cascade="all, delete-orphan"
    )


class Story(Base):
    __tablename__ = "stories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    family_id: Mapped[str] = mapped_column(ForeignKey("families.id", ondelete="CASCADE"), index=True)
    speaker_id: Mapped[str] = mapped_column(ForeignKey("people.id"), index=True)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    transcript: Mapped[str] = mapped_column(Text, nullable=False)
    audio_url: Mapped[str | None] = mapped_column(Text)
    approximate_start_date: Mapped[str | None] = mapped_column(String(100))
    approximate_end_date: Mapped[str | None] = mapped_column(String(100))
    location: Mapped[str | None] = mapped_column(String(200))
    emotional_themes: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    sensitivity_level: Mapped[str] = mapped_column(String(12), default="low", nullable=False)
    notable_quotes: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    sharing_permission: Mapped[str] = mapped_column(String(24), default="private", nullable=False)
    consent_confirmed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    audio_retained_with_consent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    provenance: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False
    )

    family: Mapped[Family] = relationship(back_populates="stories")
    speaker: Mapped[Person] = relationship(foreign_keys=[speaker_id])
    people: Mapped[list[StoryPerson]] = relationship(back_populates="story", cascade="all, delete-orphan")
    life_events: Mapped[list[LifeEvent]] = relationship(back_populates="story", cascade="all, delete-orphan")
    unresolved_questions: Mapped[list[UnresolvedQuestion]] = relationship(
        back_populates="story", cascade="all, delete-orphan"
    )


class StoryPerson(Base):
    __tablename__ = "story_people"

    story_id: Mapped[str] = mapped_column(ForeignKey("stories.id", ondelete="CASCADE"), primary_key=True)
    person_id: Mapped[str] = mapped_column(ForeignKey("people.id", ondelete="CASCADE"), primary_key=True)
    role_in_story: Mapped[str] = mapped_column(String(120), default="mentioned", nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    provenance: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    story: Mapped[Story] = relationship(back_populates="people")
    person: Mapped[Person] = relationship(back_populates="story_links")


class LifeEvent(Base):
    __tablename__ = "life_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    family_id: Mapped[str] = mapped_column(ForeignKey("families.id", ondelete="CASCADE"), index=True)
    story_id: Mapped[str] = mapped_column(ForeignKey("stories.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    approximate_date: Mapped[str | None] = mapped_column(String(100))
    location: Mapped[str | None] = mapped_column(String(200))
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    provenance: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    story: Mapped[Story] = relationship(back_populates="life_events")


class UnresolvedQuestion(Base):
    __tablename__ = "unresolved_questions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    story_id: Mapped[str] = mapped_column(ForeignKey("stories.id", ondelete="CASCADE"), index=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="open", nullable=False)
    provenance: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    story: Mapped[Story] = relationship(back_populates="unresolved_questions")


class ConversationPrompt(Base):
    __tablename__ = "conversation_prompts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    family_id: Mapped[str] = mapped_column(ForeignKey("families.id", ondelete="CASCADE"), index=True)
    source_story_id: Mapped[str] = mapped_column(ForeignKey("stories.id", ondelete="CASCADE"), index=True)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    sensitivity_level: Mapped[str] = mapped_column(String(12), default="low", nullable=False)
    caution: Mapped[str | None] = mapped_column(Text)
    provenance: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)


class ConversationSession(Base):
    __tablename__ = "conversation_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    transcript: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="active", nullable=False)
    recording_consent: Mapped[bool] = mapped_column(Boolean, nullable=False)
    retain_audio_consent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    correlation_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    interruption_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    user: Mapped[User] = relationship(back_populates="sessions")


class ExtractionDraft(Base):
    """Legacy schema compatibility only; no API or service writes pre-consent extraction drafts."""

    __tablename__ = "extraction_drafts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    family_id: Mapped[str] = mapped_column(ForeignKey("families.id", ondelete="CASCADE"), index=True)
    speaker_id: Mapped[str] = mapped_column(ForeignKey("people.id"), index=True)
    transcript: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    provenance: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="awaiting_confirmation", nullable=False)
    confirmed_by_user: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    saved_story_id: Mapped[str | None] = mapped_column(ForeignKey("stories.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False
    )
