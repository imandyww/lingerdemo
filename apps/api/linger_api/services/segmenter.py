from __future__ import annotations

import re
from dataclasses import dataclass
from time import monotonic

VALID_STEERING = re.compile(r"^\[(?:sound|say) [^\]\r\n]{1,120}\]\s*", re.IGNORECASE)
ANY_STEERING = re.compile(r"\[(?:sound|say) [^\]\r\n]{1,120}\]\s*", re.IGNORECASE)
URL = re.compile(r"https?://[^\s<>()]+", re.IGNORECASE)
MARKDOWN_LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)]+)\)")
COMMON_ABBREVIATIONS = {
    "mr.",
    "mrs.",
    "ms.",
    "dr.",
    "prof.",
    "sr.",
    "jr.",
    "st.",
    "mt.",
    "vs.",
    "etc.",
    "e.g.",
    "i.e.",
    "a.m.",
    "p.m.",
    "u.s.",
    "u.k.",
}


@dataclass(frozen=True, slots=True)
class SpeechSegment:
    display_text: str
    speech_text: str


def _spoken_url(value: str) -> str:
    value = re.sub(r"^https?://", "", value, flags=re.IGNORECASE).rstrip("/.,")
    return value.replace("www.", "").replace(".", " dot ").replace("/", " slash ").replace("-", " dash ")


def _speech_friendly(text: str) -> str:
    text = MARKDOWN_LINK.sub(lambda match: f"{match.group(1)}, at {_spoken_url(match.group(2))}", text)
    text = URL.sub(lambda match: _spoken_url(match.group(0)), text)
    # Formatting markers are removed without changing their enclosed words.
    text = text.replace("```", " ").replace("`", "")
    text = re.sub(r"(?<!\w)[*_~#>]+", "", text)
    return " ".join(text.split())


def split_display_and_speech(text: str) -> SpeechSegment:
    stripped = text.strip()
    display = ANY_STEERING.sub("", stripped)
    speech = _speech_friendly(stripped)
    return SpeechSegment(display_text=display.strip(), speech_text=speech.strip())


class StreamingDisplayFilter:
    """Remove steering tags without exposing tags split across token deltas."""

    def __init__(self) -> None:
        self._pending = ""

    def reset(self) -> None:
        self._pending = ""

    def feed(self, delta: str) -> str:
        self._pending += delta
        output: list[str] = []
        while self._pending:
            opening = self._pending.find("[")
            if opening < 0:
                output.append(self._pending)
                self._pending = ""
                break
            output.append(self._pending[:opening])
            closing = self._pending.find("]", opening + 1)
            if closing < 0:
                if len(self._pending) - opening > 130:
                    output.append("[")
                    self._pending = self._pending[opening + 1 :]
                    continue
                self._pending = self._pending[opening:]
                break
            candidate = self._pending[opening : closing + 1]
            if VALID_STEERING.fullmatch(candidate):
                self._pending = self._pending[closing + 1 :].lstrip()
            else:
                output.append(candidate)
                self._pending = self._pending[closing + 1 :]
        return "".join(output)

    def finish(self) -> str:
        remaining, self._pending = self._pending, ""
        return ANY_STEERING.sub("", remaining)


class StreamingTextSegmenter:
    def __init__(
        self,
        *,
        min_length: int = 18,
        clause_length: int = 90,
        max_length: int = 180,
        max_wait_seconds: float = 0.8,
    ) -> None:
        if not 1 <= min_length <= clause_length <= max_length:
            raise ValueError("segment lengths must satisfy min <= clause <= max")
        self.min_length = min_length
        self.clause_length = clause_length
        self.max_length = max_length
        self.max_wait_seconds = max_wait_seconds
        self._buffer = ""
        self._updated_at = monotonic()
        self._cancelled = False

    @property
    def buffered_text(self) -> str:
        return self._buffer

    def cancel(self) -> None:
        self._cancelled = True
        self._buffer = ""

    def reset(self) -> None:
        self._cancelled = False
        self._buffer = ""
        self._updated_at = monotonic()

    def feed(self, delta: str, *, now: float | None = None) -> list[SpeechSegment]:
        if self._cancelled or not delta:
            return []
        self._buffer += delta
        self._updated_at = monotonic() if now is None else now
        return self._drain(force=False)

    def flush_due(self, *, now: float | None = None) -> list[SpeechSegment]:
        current = monotonic() if now is None else now
        if self._buffer and current - self._updated_at >= self.max_wait_seconds:
            return self._drain(force=True)
        return []

    def finish(self) -> list[SpeechSegment]:
        if self._cancelled:
            return []
        return self._drain(force=True)

    def _drain(self, *, force: bool) -> list[SpeechSegment]:
        segments: list[SpeechSegment] = []
        while self._buffer.strip():
            boundary = self._find_boundary(force=force)
            if boundary is None:
                break
            raw = self._buffer[:boundary].strip()
            self._buffer = self._buffer[boundary:].lstrip()
            if raw:
                segments.append(split_display_and_speech(raw))
            if force:
                force = bool(self._buffer)
        return segments

    def _find_boundary(self, *, force: bool) -> int | None:
        text = self._buffer
        in_code = False
        in_url = False
        clause_candidate: int | None = None
        for index, char in enumerate(text):
            if char == "`":
                in_code = not in_code
            if not in_code and text[index : index + 7].lower() in {"http://", "https:/"}:
                in_url = True
            if in_url and char.isspace():
                in_url = False
            length = index + 1
            if in_code or in_url:
                continue
            if char in ",;:—" and length >= self.clause_length:
                clause_candidate = length
            if char in ".?!" and length >= self.min_length and self._is_sentence_boundary(index):
                return self._consume_trailing_space(length)
            if length >= self.max_length:
                if clause_candidate is not None:
                    return self._consume_trailing_space(clause_candidate)
                word_break = text.rfind(" ", self.min_length, length)
                return word_break + 1 if word_break >= self.min_length else length
        if force:
            return len(text)
        return None

    def _consume_trailing_space(self, position: int) -> int:
        while position < len(self._buffer) and self._buffer[position].isspace():
            position += 1
        return position

    def _is_sentence_boundary(self, index: int) -> bool:
        text = self._buffer
        char = text[index]
        if char == ".":
            previous = text[index - 1] if index else ""
            following = text[index + 1] if index + 1 < len(text) else ""
            if previous.isdigit() and following.isdigit():
                return False
            token_start = index
            while token_start > 0 and not text[token_start - 1].isspace():
                token_start -= 1
            token = text[token_start : index + 1].casefold().strip("\"'(")
            if token in COMMON_ABBREVIATIONS:
                return False
            if re.fullmatch(r"(?:[A-Za-z]\.){1,4}", token):
                return False
            if len(token) == 2 and token[0].isalpha():
                return False
        next_index = index + 1
        while next_index < len(text) and text[next_index] in "\"')]}":
            next_index += 1
        return next_index == len(text) or text[next_index].isspace()
