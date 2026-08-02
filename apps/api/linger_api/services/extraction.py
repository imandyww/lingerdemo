from __future__ import annotations

import json
import re
from typing import cast

import httpx
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletion
from pydantic import ValidationError

from ..config import Settings
from ..providers.base import MemoryExtractionProvider, ProviderError
from ..schemas import ExtractedMemory, FamilyContext

JSON_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL | re.IGNORECASE)


def validate_fact_provenance(memory: ExtractedMemory) -> None:
    missing: list[str] = []
    missing.extend(f"people[{index}]" for index, item in enumerate(memory.people) if item.provenance is None)
    missing.extend(f"places[{index}]" for index, item in enumerate(memory.places) if item.provenance is None)
    missing.extend(f"events[{index}]" for index, item in enumerate(memory.events) if item.provenance is None)
    if missing:
        raise ValueError(f"extracted facts are missing provenance: {', '.join(missing)}")


class TenstorrentMemoryExtractionProvider(MemoryExtractionProvider):
    name = "tenstorrent"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        timeout = httpx.Timeout(
            settings.tenstorrent_request_timeout_seconds,
            connect=settings.tenstorrent_connect_timeout_seconds,
        )
        self.client = AsyncOpenAI(
            api_key=settings.tenstorrent_api_key or "local-development-only",
            base_url=settings.tenstorrent_base_url,
            timeout=timeout,
        )

    async def extract(self, transcript: str, context: FamilyContext) -> ExtractedMemory:
        if not self.settings.tenstorrent_model:
            raise ProviderError(
                "model_not_configured", "TENSTORRENT_MODEL must be verified before live extraction."
            )
        rules_path = self.settings.prompts_dir / "memory_extraction.md"
        rules = rules_path.read_text(encoding="utf-8")
        schema = ExtractedMemory.model_json_schema()
        request = (
            f"{rules}\n\nReturn only one JSON object matching this schema:\n"
            f"{json.dumps(schema, separators=(',', ':'))}\n\n"
            f"Stored family context:\n{context.model_dump_json()}\n\nTranscript:\n{transcript}"
        )
        error_detail = ""
        for attempt in range(2):
            messages: list[dict[str, str]] = [
                {
                    "role": "system",
                    "content": (
                        "Extract only supported oral-history facts. Every person, place, and event must include "
                        "provenance. Return JSON only; never invent a fact."
                    ),
                },
                {"role": "user", "content": request},
            ]
            if attempt:
                messages.append(
                    {
                        "role": "user",
                        "content": f"The previous JSON was invalid ({error_detail}). Repair it and return JSON only.",
                    }
                )
            response = cast(
                ChatCompletion,
                await self.client.chat.completions.create(
                    model=self.settings.tenstorrent_model,
                    messages=messages,  # type: ignore[arg-type]
                    stream=False,
                ),
            )
            content = response.choices[0].message.content if response.choices else None
            if not isinstance(content, str) or not content.strip():
                error_detail = "empty model output"
                continue
            match = JSON_FENCE.match(content)
            candidate = match.group(1) if match else content
            try:
                memory = ExtractedMemory.model_validate_json(candidate)
                validate_fact_provenance(memory)
                return memory
            except (ValidationError, ValueError) as exc:
                error_detail = str(exc).splitlines()[0][:300]
        raise ProviderError(
            "extraction_validation_failed",
            f"Memory extraction did not produce valid, provenance-backed JSON after one repair ({error_detail}).",
            recoverable=True,
        )

    async def close(self) -> None:
        await self.client.close()
