from __future__ import annotations

from .base import UnavailableStreamingSTT, UnavailableStreamingTTS

OPENAI_REALTIME_PLACEHOLDER_DETAIL = (
    "The OpenAI realtime adapter is an extension boundary only. It has no configured provider behavior and "
    "never exposes credentials to the browser."
)


class OpenAIRealtimeSTTPlaceholder(UnavailableStreamingSTT):
    def __init__(self) -> None:
        super().__init__("openai-realtime-stt-placeholder", OPENAI_REALTIME_PLACEHOLDER_DETAIL)


class OpenAIRealtimeTTSPlaceholder(UnavailableStreamingTTS):
    def __init__(self) -> None:
        super().__init__("openai-realtime-tts-placeholder", OPENAI_REALTIME_PLACEHOLDER_DETAIL)
