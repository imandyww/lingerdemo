from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

from sqlalchemy import event
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool, StaticPool

from .config import Settings, get_settings


class Base(DeclarativeBase):
    pass


def create_engine(settings: Settings) -> AsyncEngine:
    url = make_url(settings.database_url)
    kwargs: dict[str, object] = {"pool_pre_ping": True}
    if url.drivername.startswith("sqlite"):
        if url.database and url.database != ":memory:":
            Path(url.database).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        if url.database == ":memory:":
            kwargs["poolclass"] = StaticPool
        else:
            # File SQLite is local/demo storage; closing each async connection avoids cross-loop/thread reuse.
            kwargs["poolclass"] = NullPool
        kwargs["connect_args"] = {"check_same_thread": False}
    engine = create_async_engine(settings.database_url, **kwargs)
    if url.drivername.startswith("sqlite"):

        @event.listens_for(engine.sync_engine, "connect")
        def _sqlite_foreign_keys(dbapi_connection: object, _connection_record: object) -> None:
            cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


settings = get_settings()
engine = create_engine(settings)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def init_database(target_engine: AsyncEngine = engine) -> None:
    from . import models  # noqa: F401

    async with target_engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
