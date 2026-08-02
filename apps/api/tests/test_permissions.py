from __future__ import annotations

import pytest
from linger_api.config import Settings
from linger_api.schemas import DirectStoryCreateRequest, ExtractionConfirmRequest
from pydantic import ValidationError


def test_archive_save_requires_explicit_consent() -> None:
    with pytest.raises(ValidationError, match="explicit consent"):
        DirectStoryCreateRequest(
            family_id="10000000-0000-4000-8000-000000000001",
            speaker_id="10000000-0000-4000-8000-000000000003",
            transcript="A story",
            memory={
                "suggested_title": "A story",
                "summary": "A story",
                "sensitivity_level": "low",
            },
            consent=False,
        )


def test_new_archive_writes_default_private_and_reject_unenforced_selected_sharing() -> None:
    payload = {
        "family_id": "10000000-0000-4000-8000-000000000001",
        "speaker_id": "10000000-0000-4000-8000-000000000003",
        "transcript": "A story",
        "memory": {
            "suggested_title": "A story",
            "summary": "A story",
            "sensitivity_level": "low",
        },
        "consent": True,
    }
    request = DirectStoryCreateRequest.model_validate(payload)
    assert request.sharing_permission == "private"
    with pytest.raises(ValidationError):
        DirectStoryCreateRequest.model_validate({**payload, "sharing_permission": "selected"})

    confirm = ExtractionConfirmRequest(
        family_id=payload["family_id"],
        speaker_id=payload["speaker_id"],
        transcript=payload["transcript"],
        original_memory=payload["memory"],
        consent=True,
    )
    assert confirm.sharing_permission == "private"


def test_unimplemented_application_auth_is_truthfully_labeled_and_blocks_startup() -> None:
    settings = Settings(app_environment="test", mock_auth=False)
    assert settings.auth_mode == "unconfigured"
    assert settings.startup_issues()
    assert settings.readiness_issues()
