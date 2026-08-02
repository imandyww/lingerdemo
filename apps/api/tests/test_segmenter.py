from __future__ import annotations

from linger_api.services.segmenter import (
    StreamingDisplayFilter,
    StreamingTextSegmenter,
    split_display_and_speech,
)


def test_sentence_boundaries_avoid_decimals_abbreviations_and_initials() -> None:
    segmenter = StreamingTextSegmenter(min_length=5)
    segments = segmenter.feed("Dr. Chen paid 3.14 dollars. J. Lin kept the receipt. Next came home.")
    assert [segment.display_text for segment in segments] == [
        "Dr. Chen paid 3.14 dollars.",
        "J. Lin kept the receipt.",
        "Next came home.",
    ]


def test_url_markdown_and_code_are_not_split_mid_fragment() -> None:
    segmenter = StreamingTextSegmenter(min_length=5)
    text = "Visit https://example.com/a.b for *our archive*. Use `story.id` carefully. Then stop."
    segments = segmenter.feed(text)
    assert segments[0].display_text.startswith("Visit https://example.com/a.b")
    assert "example dot com" in segments[0].speech_text
    assert any("story.id" in segment.display_text for segment in segments)


def test_steering_is_hidden_from_display_and_kept_for_speech() -> None:
    value = split_display_and_speech(
        "[sound warm and reassuring with a measured pace] Welcome.\n"
        "[say clearly with deliberate pauses] Who was there?"
    )
    assert "[sound" not in value.display_text
    assert "[say" not in value.display_text
    assert "[sound" in value.speech_text
    assert "[say" in value.speech_text


def test_streaming_filter_handles_split_steering_tag() -> None:
    display = StreamingDisplayFilter()
    assert display.feed("[sound warm and") == ""
    assert display.feed(" patient] Who") == "Who"
    assert display.feed(" was there?") == " was there?"
    assert display.finish() == ""


def test_clause_limit_wait_flush_and_cancellation() -> None:
    segmenter = StreamingTextSegmenter(min_length=5, clause_length=20, max_length=35, max_wait_seconds=0.5)
    segments = segmenter.feed("This is a longer clause, and it keeps moving without a final stop", now=0)
    assert segments
    segmenter.reset()
    segmenter.feed("A quiet unfinished thought", now=1)
    assert segmenter.flush_due(now=1.6)[0].display_text == "A quiet unfinished thought"
    segmenter.feed("This will be discarded", now=2)
    segmenter.cancel()
    assert segmenter.finish() == []
    assert segmenter.buffered_text == ""
