from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest_asyncio
from linger_api.config import Settings
from linger_api.database import create_engine, init_database
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


@pytest_asyncio.fixture
async def session_factory(tmp_path: Path) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    database_path = tmp_path / "linger-test.db"
    settings = Settings(
        database_url=f"sqlite+aiosqlite:///{database_path}",
        app_environment="test",
        seed_demo_on_start=False,
    )
    engine = create_engine(settings)
    await init_database(engine)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    await engine.dispose()
