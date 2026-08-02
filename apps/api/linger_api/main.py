from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from .api import router as api_router
from .config import get_settings
from .database import SessionLocal, engine, init_database
from .providers.base import ProviderHealth
from .providers.inworld import InworldSTTProvider, InworldTTSProvider
from .providers.mock import MockLLMProvider, MockSTTProvider, MockTTSProvider
from .providers.tenstorrent import TenstorrentLLMProvider
from .security import websocket_origin_allowed, websocket_transport_allowed
from .seed import seed_demo_data
from .services.orchestrator import SessionRegistry, VoiceSessionOrchestrator

settings = get_settings()
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    startup_issues = settings.startup_issues()
    if startup_issues:
        raise RuntimeError(" ".join(startup_issues))
    if settings.auto_migrate and settings.app_environment != "production":
        await init_database(engine)
    if settings.seed_demo_on_start and settings.demo_mode:
        async with SessionLocal() as session:
            await seed_demo_data(session)
    app.state.session_registry = SessionRegistry(settings.max_active_sessions)
    yield
    await engine.dispose()


app = FastAPI(
    title="Linger API",
    version="0.1.0",
    description="Realtime oral-history orchestration and consent-gated family archive.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Correlation-ID"],
    expose_headers=["X-Linger-Auth-Mode"],
)
app.include_router(api_router)


@app.middleware("http")
async def auth_mode_header(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    response = await call_next(request)
    response.headers["X-Linger-Auth-Mode"] = settings.auth_mode
    return response


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "linger-api",
        "mode": "demo" if settings.demo_mode else "standard",
        "auth_mode": settings.auth_mode,
    }


def _providers() -> tuple[object, object, object]:
    stt = InworldSTTProvider(settings) if settings.voice_provider == "inworld" else MockSTTProvider()
    tts = InworldTTSProvider(settings) if settings.voice_provider == "inworld" else MockTTSProvider()
    llm = TenstorrentLLMProvider(settings) if settings.llm_provider == "tenstorrent" else MockLLMProvider()
    return stt, llm, tts


@app.get("/ready")
async def ready(response: Response) -> dict[str, object]:
    stt, llm, tts = _providers()
    healths: list[ProviderHealth] = []
    try:
        healths = [await stt.health(), await llm.health(), await tts.health()]  # type: ignore[attr-defined]
    finally:
        await stt.close()  # type: ignore[attr-defined]
        await llm.close()  # type: ignore[attr-defined]
        await tts.close()  # type: ignore[attr-defined]
    issues = settings.readiness_issues()
    issues.extend(item.detail for item in healths if not item.ready and item.detail not in issues)
    if issues:
        response.status_code = 503
    return {
        "ready": not issues,
        "issues": issues,
        "providers": [
            {"provider": item.provider, "ready": item.ready, "detail": item.detail, "checks": item.checks}
            for item in healths
        ],
    }


async def _voice_socket(websocket: WebSocket, expected_session_id: str | None) -> None:
    if not websocket_origin_allowed(websocket, settings) or not websocket_transport_allowed(
        websocket, settings
    ):
        await websocket.close(code=1008, reason="WebSocket origin or transport is not allowed.")
        return
    stt, llm, tts = _providers()
    orchestrator = VoiceSessionOrchestrator(
        settings=settings,
        stt=stt,  # type: ignore[arg-type]
        llm=llm,  # type: ignore[arg-type]
        tts=tts,  # type: ignore[arg-type]
        session_factory=SessionLocal,
        registry=app.state.session_registry,
        expected_session_id=expected_session_id,
    )
    await orchestrator.run(websocket)


@app.websocket("/ws/voice")
async def websocket_voice(websocket: WebSocket) -> None:
    await _voice_socket(websocket, None)


@app.websocket("/ws/voice/{session_id}")
async def websocket_voice_with_id(websocket: WebSocket, session_id: str) -> None:
    await _voice_socket(websocket, session_id)
