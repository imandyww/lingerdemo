from __future__ import annotations

from collections import deque
from time import monotonic

from fastapi import WebSocket

from .config import Settings


class SlidingWindowRateLimiter:
    def __init__(self, maximum: int, *, window_seconds: float = 1.0) -> None:
        self.maximum = maximum
        self.window_seconds = window_seconds
        self._events: deque[float] = deque()

    def allow(self, *, now: float | None = None) -> bool:
        current = monotonic() if now is None else now
        cutoff = current - self.window_seconds
        while self._events and self._events[0] <= cutoff:
            self._events.popleft()
        if len(self._events) >= self.maximum:
            return False
        self._events.append(current)
        return True


def websocket_origin_allowed(websocket: WebSocket, settings: Settings) -> bool:
    origin = websocket.headers.get("origin")
    if origin is None:
        # Native/non-browser clients have no Origin. Browser connections always do, and production requires it.
        return settings.app_environment != "production"
    return origin.rstrip("/") in settings.allowed_origins


def websocket_transport_allowed(websocket: WebSocket, settings: Settings) -> bool:
    if settings.app_environment != "production":
        return True
    forwarded = websocket.headers.get("x-forwarded-proto", "").split(",", 1)[0].strip().lower()
    return websocket.url.scheme == "wss" or forwarded == "https"
