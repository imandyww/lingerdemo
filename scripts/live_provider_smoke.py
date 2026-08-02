#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
from dataclasses import asdict, dataclass
from typing import Literal

from linger_api.config import get_settings
from linger_api.providers.inworld import STT_AUDIO_FORMAT, InworldSTTProvider, InworldTTSProvider
from linger_api.providers.inworld_llm import InworldLLMProvider
from linger_api.providers.tenstorrent import TenstorrentLLMProvider

Status = Literal["pass", "fail", "skipped", "unavailable"]


@dataclass(slots=True)
class Check:
    subsystem: str
    status: Status
    detail: str


async def check_inworld_stt() -> Check:
    settings = get_settings()
    if not settings.inworld_api_key:
        return Check("inworld_stt", "skipped", "INWORLD_API_KEY is not configured.")
    provider = InworldSTTProvider(settings)
    try:
        await provider.connect(language=settings.inworld_language, audio_format=STT_AUDIO_FORMAT)
        return Check("inworld_stt", "pass", "Authenticated streaming handshake and config send succeeded.")
    except Exception as exc:
        return Check("inworld_stt", "fail", f"Streaming check failed ({type(exc).__name__}).")
    finally:
        await provider.close()


async def check_inworld_tts() -> Check:
    settings = get_settings()
    if not settings.inworld_api_key:
        return Check("inworld_tts", "skipped", "INWORLD_API_KEY is not configured.")
    if not settings.inworld_voice_id:
        return Check("inworld_tts", "unavailable", "INWORLD_VOICE_ID is not configured.")
    provider = InworldTTSProvider(settings)
    cancellation = asyncio.Event()
    total_bytes = 0
    try:
        async for chunk in provider.synthesize(
            "This is a short Linger voice check.",
            segment_id="smoke-test",
            turn_id=0,
            cancellation=cancellation,
        ):
            total_bytes += len(chunk.data)
        if total_bytes == 0:
            return Check("inworld_tts", "fail", "Streaming completed without audio bytes.")
        return Check("inworld_tts", "pass", f"Synthesized {total_bytes} bytes of raw PCM audio.")
    except Exception as exc:
        return Check("inworld_tts", "fail", f"Synthesis check failed ({type(exc).__name__}).")
    finally:
        await provider.close()


async def check_inworld_llm() -> Check:
    settings = get_settings()
    if not settings.inworld_api_key:
        return Check("inworld_llm", "skipped", "INWORLD_API_KEY is not configured.")
    if not settings.inworld_llm_model:
        return Check("inworld_llm", "unavailable", "INWORLD_LLM_MODEL is not configured.")
    provider = InworldLLMProvider(settings)
    cancellation = asyncio.Event()
    generated = ""
    try:
        async for chunk in provider.stream(
            [
                {"role": "system", "content": "Reply briefly."},
                {"role": "user", "content": "Reply with exactly: Inworld reply ready"},
            ],
            turn_id=0,
            cancellation=cancellation,
        ):
            generated += chunk.text
        if generated.strip() != "Inworld reply ready":
            return Check("inworld_llm", "fail", "Chat completion returned unexpected text.")
        return Check("inworld_llm", "pass", "Streamed a verified Inworld-generated reply.")
    except Exception as exc:
        return Check("inworld_llm", "fail", f"Reply generation failed ({type(exc).__name__}).")
    finally:
        await provider.close()


async def check_tenstorrent() -> list[Check]:
    settings = get_settings()
    if not settings.tenstorrent_health_url:
        return [
            Check(
                "tenstorrent_health",
                "unavailable",
                "TENSTORRENT_HEALTH_URL is required because the serving stack owns the health location.",
            ),
            Check("tenstorrent_generation", "skipped", "Health and model validation did not run."),
        ]
    if not settings.tenstorrent_model:
        return [
            Check("tenstorrent_health", "unavailable", "TENSTORRENT_MODEL is not configured."),
            Check("tenstorrent_generation", "skipped", "No verified model is configured."),
        ]
    provider = TenstorrentLLMProvider(settings)
    try:
        health = await provider.health()
        health_check = Check(
            "tenstorrent_health",
            "pass" if health.ready else "fail",
            health.detail,
        )
        if not health.ready:
            return [health_check, Check("tenstorrent_generation", "skipped", "Readiness failed.")]
        cancellation = asyncio.Event()
        generated = ""
        async for chunk in provider.stream(
            [{"role": "user", "content": "Reply with exactly: Linger ready"}],
            turn_id=0,
            cancellation=cancellation,
        ):
            generated += chunk.text
            if len(generated) > 200:
                break
        generation = Check(
            "tenstorrent_generation",
            "pass" if generated.strip() else "fail",
            "Short chat-completions stream returned text."
            if generated.strip()
            else "The stream returned no text.",
        )
        return [health_check, generation]
    except Exception as exc:
        return [
            Check("tenstorrent_health", "fail", f"Live check failed ({type(exc).__name__})."),
            Check("tenstorrent_generation", "skipped", "Health/model validation did not complete."),
        ]
    finally:
        await provider.close()


async def main() -> int:
    checks = [
        await check_inworld_stt(),
        await check_inworld_llm(),
        await check_inworld_tts(),
        *(await check_tenstorrent()),
    ]
    print(json.dumps({"checks": [asdict(check) for check in checks]}, indent=2))
    return 1 if any(check.status == "fail" for check in checks) else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
