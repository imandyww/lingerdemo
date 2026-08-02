from __future__ import annotations

import json
import logging

from linger_api.observability import log_session_event


def test_structured_session_log_contains_only_safe_fields(caplog: object) -> None:
    logger = logging.getLogger("linger.test")
    with caplog.at_level(logging.INFO, logger="linger.test"):  # type: ignore[attr-defined]
        log_session_event(
            logger,
            "session.error",
            correlation_id="correlation",
            session_id="session",
            turn_id=2,
            subsystem="tts",
            error_code="tts_disconnected",
            metrics={"reconnects": 1},
        )
    payload = json.loads(caplog.records[-1].message)  # type: ignore[attr-defined]
    assert payload["error_code"] == "tts_disconnected"
    assert set(payload) == {
        "event",
        "correlation_id",
        "session_id",
        "turn_id",
        "subsystem",
        "error_code",
        "metrics",
    }
