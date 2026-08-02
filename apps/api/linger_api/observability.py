from __future__ import annotations

import json
import logging
from typing import Any


def log_session_event(
    logger: logging.Logger,
    event: str,
    *,
    correlation_id: str,
    session_id: str | None,
    turn_id: int,
    subsystem: str,
    error_code: str | None = None,
    metrics: dict[str, int | float | None] | None = None,
) -> None:
    """Emit a small structured record containing no audio, transcript, prompts, or credentials."""
    record: dict[str, Any] = {
        "event": event,
        "correlation_id": correlation_id,
        "session_id": session_id,
        "turn_id": turn_id,
        "subsystem": subsystem,
    }
    if error_code is not None:
        record["error_code"] = error_code
    if metrics is not None:
        record["metrics"] = metrics
    logger.info(json.dumps(record, separators=(",", ":"), sort_keys=True))
