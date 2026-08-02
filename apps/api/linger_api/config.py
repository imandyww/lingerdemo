from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(ROOT_DIR / ".env", ROOT_DIR / "apps/api/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_host: str = "0.0.0.0"
    app_port: int = 8080
    app_environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    web_app_url: str = "http://localhost:3000"
    allowed_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    database_url: str = "sqlite+aiosqlite:///./data/linger.db"
    auto_migrate: bool = True
    seed_demo_on_start: bool = True
    demo_mode: bool = True
    mock_auth: bool = True

    voice_provider: Literal["mock", "inworld"] = "mock"
    llm_provider: Literal["mock", "tenstorrent", "inworld"] = "mock"
    speculative_generation: bool = False

    inworld_api_key: str | None = None
    inworld_api_secret: str | None = None
    inworld_stt_model: str | None = None
    inworld_tts_model: str | None = "inworld-tts-2"
    inworld_voice_id: str | None = None
    inworld_language: str = "en-US"
    inworld_tts_delivery_mode: Literal["STABLE", "BALANCED", "CREATIVE"] = "BALANCED"
    inworld_tts_sample_rate_hz: int = Field(default=24_000, ge=8_000, le=48_000)
    inworld_llm_base_url: str = "https://api.inworld.ai/v1"
    inworld_llm_model: str | None = "auto"
    inworld_llm_max_context_tokens: int = 8192
    inworld_llm_connect_timeout_seconds: float = 10.0
    inworld_llm_request_timeout_seconds: float = 30.0
    inworld_llm_total_timeout_seconds: float = 60.0

    tenstorrent_base_url: str = "http://localhost:8000/v1"
    tenstorrent_api_key: str | None = None
    tenstorrent_model: str | None = "Llama-3.1-8B-Instruct"
    tenstorrent_health_url: str | None = None
    tenstorrent_max_context_tokens: int = 8192
    tenstorrent_connect_timeout_seconds: float = 5.0
    tenstorrent_request_timeout_seconds: float = 30.0
    tenstorrent_total_timeout_seconds: float = 60.0

    openai_api_key: str | None = None

    raw_audio_retention: bool = False
    # Applies only after explicit archive confirmation; voice-session transcripts are never persisted.
    transcript_retention: bool = True
    max_active_sessions: int = 25
    max_audio_frame_bytes: int = 65_536
    max_control_message_bytes: int = 32_768
    max_messages_per_second: int = 80
    inbound_queue_size: int = 64
    outbound_queue_size: int = 128
    tts_queue_size: int = 16
    session_idle_timeout_seconds: float = 180.0

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def parse_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip().rstrip("/") for item in value.split(",") if item.strip()]
        return value

    @field_validator("allowed_origins")
    @classmethod
    def reject_wildcard_origins(cls, value: list[str]) -> list[str]:
        if "*" in value:
            raise ValueError("ALLOWED_ORIGINS must list explicit origins; wildcard origins are not allowed")
        return [origin.rstrip("/") for origin in value]

    @property
    def prompts_dir(self) -> Path:
        return ROOT_DIR / "config" / "prompts"

    @property
    def auth_mode(self) -> Literal["mock", "unconfigured"]:
        return "mock" if self.mock_auth else "unconfigured"

    @property
    def tenstorrent_unauthenticated_loopback_allowed(self) -> bool:
        if self.app_environment not in {"development", "test"}:
            return False
        urls = [self.tenstorrent_base_url]
        if self.tenstorrent_health_url:
            urls.append(self.tenstorrent_health_url)
        return all(urlparse(url).hostname in {"localhost", "127.0.0.1", "::1"} for url in urls)

    def startup_issues(self) -> list[str]:
        if not self.mock_auth:
            return [
                "Application authentication is not implemented; the API cannot start with MOCK_AUTH=false."
            ]
        return []

    def readiness_issues(self) -> list[str]:
        issues = self.startup_issues()
        if self.voice_provider == "inworld":
            if not self.inworld_api_key:
                issues.append(
                    "Inworld live mode requires INWORLD_API_KEY containing the provider-issued Base64 credential."
                )
            if not self.inworld_voice_id:
                issues.append("Inworld TTS requires INWORLD_VOICE_ID verified for the account.")
        if self.llm_provider == "tenstorrent":
            if not self.tenstorrent_model:
                issues.append(
                    "Tenstorrent live mode requires TENSTORRENT_MODEL verified for the server/hardware."
                )
            if not self.tenstorrent_health_url:
                issues.append("Tenstorrent live mode requires TENSTORRENT_HEALTH_URL from the serving stack.")
            if not self.tenstorrent_api_key and not self.tenstorrent_unauthenticated_loopback_allowed:
                issues.append(
                    "TENSTORRENT_API_KEY is required outside explicit development/test loopback endpoints."
                )
            if self.tenstorrent_base_url.startswith("http://") and self.app_environment == "production":
                issues.append("Production Tenstorrent access requires TLS or a private authenticated proxy.")
        if self.llm_provider == "inworld":
            if not self.inworld_api_key:
                issues.append("Inworld reply generation requires INWORLD_API_KEY.")
            if not self.inworld_llm_model:
                issues.append("Inworld reply generation requires INWORLD_LLM_MODEL.")
        if self.app_environment == "production" and self.mock_auth:
            issues.append(
                "Production readiness requires an implemented authentication and family-authorization boundary; "
                "mock authentication is demo-only."
            )
        return issues

    @property
    def llm_max_context_tokens(self) -> int:
        if self.llm_provider == "inworld":
            return self.inworld_llm_max_context_tokens
        return self.tenstorrent_max_context_tokens


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
