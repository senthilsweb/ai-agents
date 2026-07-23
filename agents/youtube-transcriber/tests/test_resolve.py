"""Eval 1 (id parsing) and eval 2 (duration cap). No network."""

from __future__ import annotations

import pytest

from pipeline.config import Config
from pipeline.resolve import ensure_within_duration, parse_video_ref
from pipeline.state import PipelineError

SEED_A = "EQuCyrwyfXU"
SEED_B = "gYAqupu6iNI"


@pytest.mark.parametrize(
    "raw",
    [
        # The owner's first seed link, tracking parameters and all. This is
        # the fixture the resolver exists for.
        "https://www.youtube.com/watch?v=EQuCyrwyfXU&t=19s"
        "&pp=ygUUa2FydGhpayBrcmlzaG5hbXV0aHk%3D",
        "https://www.youtube.com/watch?v=EQuCyrwyfXU",
        "http://youtube.com/watch?v=EQuCyrwyfXU",
        "https://m.youtube.com/watch?v=EQuCyrwyfXU",
        "www.youtube.com/watch?v=EQuCyrwyfXU",
        "https://youtu.be/EQuCyrwyfXU",
        "https://youtu.be/EQuCyrwyfXU?t=19",
        "https://www.youtube.com/live/EQuCyrwyfXU",
        "https://www.youtube.com/shorts/EQuCyrwyfXU",
        "https://www.youtube.com/embed/EQuCyrwyfXU",
        "EQuCyrwyfXU",
        "  EQuCyrwyfXU  ",
    ],
)
def test_every_link_shape_yields_the_same_id(raw: str) -> None:
    assert parse_video_ref(raw).video_id == SEED_A


def test_tracking_params_do_not_survive() -> None:
    raw = (
        "https://www.youtube.com/watch?v=EQuCyrwyfXU&t=19s"
        "&pp=ygUUa2FydGhpayBrcmlzaG5hbXV0aHk%3D"
    )
    ref = parse_video_ref(raw)

    # The canonical url is what downstream code uses; nothing from the
    # original query string is allowed into it.
    assert ref.canonical_url == "https://www.youtube.com/watch?v=EQuCyrwyfXU"
    assert "t=19s" not in ref.canonical_url
    assert "pp=" not in ref.canonical_url
    # The id itself is the only value that becomes a path component.
    assert ref.video_id.isascii() and len(ref.video_id) == 11


def test_second_seed_video() -> None:
    assert parse_video_ref(f"https://www.youtube.com/watch?v={SEED_B}").video_id == SEED_B


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        # Wrong host — this must not become a general-purpose downloader.
        "https://evil.example.com/watch?v=EQuCyrwyfXU",
        "https://youtube.com.evil.example.com/watch?v=EQuCyrwyfXU",
        "https://vimeo.com/123456789",
        "file:///etc/passwd",
        # No id present.
        "https://www.youtube.com/watch",
        "https://www.youtube.com/",
        # Path traversal and shell metacharacters in the id position.
        "https://www.youtube.com/watch?v=../../../etc/passwd",
        "https://youtu.be/../../secrets",
        "https://www.youtube.com/watch?v=abc;rm+-rf+/",
        "https://www.youtube.com/watch?v=$(whoami)",
        "https://www.youtube.com/watch?v=a b c d e f g h",
        # Right alphabet, wrong length.
        "https://www.youtube.com/watch?v=tooshort",
        "https://www.youtube.com/watch?v=waytoolongvideoid",
    ],
)
def test_hostile_and_malformed_input_is_rejected(raw: str) -> None:
    with pytest.raises(PipelineError):
        parse_video_ref(raw)


def test_duration_cap_rejects_a_four_hour_stream() -> None:
    cfg = Config(max_duration_min=180)
    with pytest.raises(PipelineError, match="over the 180 min cap"):
        ensure_within_duration(240 * 60, cfg)


def test_duration_cap_allows_a_sixty_minute_talk() -> None:
    ensure_within_duration(60 * 60, Config(max_duration_min=180))


def test_missing_duration_is_tolerated() -> None:
    # Live streams report no duration; the filesize cap is the backstop.
    ensure_within_duration(None, Config())
