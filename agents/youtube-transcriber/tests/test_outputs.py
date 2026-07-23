"""Eval 6 — the four artifacts, SRT formatting, and path safety."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from pipeline import outputs
from pipeline.config import Config
from pipeline.state import Segment, TranscriptState, VideoRef

SEED = "EQuCyrwyfXU"


@pytest.fixture()
def cfg(tmp_path: Path) -> Config:
    return Config(runs_dir=tmp_path / "runs", cache_dir=tmp_path / "cache")


@pytest.fixture()
def state() -> TranscriptState:
    return TranscriptState(
        ref=VideoRef(video_id=SEED, source_url=f"https://youtu.be/{SEED}"),
        title="A Talk About Systems",
        channel="Some Channel",
        duration_s=3720.0,
        language="en",
        model="distil-large-v3",
        segments=[
            Segment(index=0, start_s=0.0, end_s=2.5, text="one"),
            Segment(index=1, start_s=2.5, end_s=6.25, text="two"),
            Segment(index=2, start_s=30.0, end_s=33.0, text="three"),
        ],
        full_text="one two three",
        metrics={"transcribe_s": 300.0},
    )


# --- SRT ---------------------------------------------------------------


def test_srt_timestamp_formatting() -> None:
    assert outputs.srt_timestamp(3661.5) == "01:01:01,500"
    assert outputs.srt_timestamp(3665.25) == "01:01:05,250"
    assert outputs.srt_timestamp(0.0) == "00:00:00,000"
    assert outputs.srt_timestamp(59.999) == "00:00:59,999"


def test_srt_is_one_indexed_with_blank_line_separators(state) -> None:
    srt = outputs.to_srt(state.segments)
    blocks = srt.strip().split("\n\n")

    assert len(blocks) == 3
    assert blocks[0].splitlines()[0] == "1"  # 1-indexed, not 0
    assert blocks[0].splitlines()[1] == "00:00:00,000 --> 00:00:02,500"
    assert blocks[0].splitlines()[2] == "one"
    assert blocks[2].splitlines()[0] == "3"


# --- markdown ----------------------------------------------------------


def test_markdown_breaks_paragraphs_on_long_pauses(state) -> None:
    paragraphs = outputs.to_paragraphs(state.segments)
    # The 24-second gap before "three" starts a new paragraph.
    assert len(paragraphs) == 2
    assert paragraphs[0][1] == "one two"
    assert paragraphs[1][1] == "three"


def test_markdown_carries_metadata_and_timestamps(state) -> None:
    md = outputs.to_markdown(state)
    assert md.startswith("# A Talk About Systems")
    assert f"https://www.youtube.com/watch?v={SEED}" in md
    assert "distil-large-v3" in md
    assert "**[00:00:00]**" in md
    assert "**[00:00:30]**" in md


# --- json + metrics ----------------------------------------------------


def test_all_four_artifacts_are_written(state, cfg) -> None:
    out = outputs.write_outputs(state, cfg)
    run_dir = Path(out.run_dir)

    for name in ("transcript.json", "transcript.md", "transcript.srt", "metrics.json"):
        assert (run_dir / name).exists(), name
        assert (run_dir / name).stat().st_size > 0


def test_json_shape(state, cfg) -> None:
    out = outputs.write_outputs(state, cfg)
    data = json.loads((Path(out.run_dir) / "transcript.json").read_text())

    assert data["video_id"] == SEED
    assert data["url"] == f"https://www.youtube.com/watch?v={SEED}"
    assert data["language"] == "en"
    assert data["model"] == "distil-large-v3"
    assert data["segment_count"] == 3
    assert data["word_count"] == 3
    assert len(data["segments"]) == 3
    assert data["segments"][0] == {
        "index": 0,
        "start_s": 0.0,
        "end_s": 2.5,
        "text": "one",
    }


def test_metrics_record_the_realtime_factor(state, cfg) -> None:
    out = outputs.write_outputs(state, cfg)
    metrics = json.loads((Path(out.run_dir) / "metrics.json").read_text())
    # 3720s of audio transcribed in 300s.
    assert metrics["realtime_factor"] == 12.4
    assert metrics["cache_hit"] is False
    assert metrics["model"] == "distil-large-v3"


def test_missing_timing_does_not_invent_a_realtime_factor(state, cfg) -> None:
    state.metrics = {}
    out = outputs.write_outputs(state, cfg)
    metrics = json.loads((Path(out.run_dir) / "metrics.json").read_text())
    assert "realtime_factor" not in metrics


# --- path safety -------------------------------------------------------


def test_run_dir_name_is_timestamp_plus_id(state) -> None:
    now = datetime(2026, 7, 23, 9, 5, 1, tzinfo=timezone.utc)
    assert outputs.run_dir_name(SEED, now) == f"20260723T090501Z-{SEED}"


def test_a_hostile_title_cannot_escape_the_runs_directory(state, cfg) -> None:
    state.title = "../../../etc/passwd; rm -rf /"
    state.channel = "../../evil"
    out = outputs.write_outputs(state, cfg)

    run_dir = Path(out.run_dir).resolve()
    assert run_dir.parent == cfg.runs_dir.resolve()
    assert run_dir.name.endswith(f"-{SEED}")
    # The title survives as data, not as a path.
    assert "../../../etc/passwd" in (run_dir / "transcript.md").read_text()
    assert not (cfg.runs_dir.parent / "etc").exists()


def test_two_videos_get_two_independent_run_folders(state, cfg) -> None:
    first = outputs.write_outputs(state, cfg, now=datetime(2026, 7, 23, 9, 0, 0))

    second_state = state.model_copy(deep=True)
    second_state.ref = VideoRef(
        video_id="gYAqupu6iNI", source_url="https://youtu.be/gYAqupu6iNI"
    )
    second = outputs.write_outputs(second_state, cfg, now=datetime(2026, 7, 23, 9, 1, 0))

    assert first.run_dir != second.run_dir
    assert len(list(cfg.runs_dir.iterdir())) == 2
    # No combined output file.
    assert not (cfg.runs_dir / "transcript.json").exists()


def test_realtime_factor_excludes_model_load_time(state, cfg) -> None:
    """A first run pays a ~1GB weight download. Charging that to
    transcription understates the realtime factor by a lot — this is the
    defect the two seed videos exposed (1.94 vs 4.68 on one machine)."""
    state.metrics = {"transcribe_s": 460.0, "model_load_s": 160.0, "asr_s": 300.0}
    out = outputs.write_outputs(state, cfg)
    metrics = json.loads((Path(out.run_dir) / "metrics.json").read_text())

    assert metrics["realtime_factor"] == 12.4  # 3720 / 300, not 3720 / 460
    assert metrics["model_load_s"] == 160.0    # kept, just not conflated


def test_realtime_factor_falls_back_to_node_time(state, cfg) -> None:
    # Older runs and mocked paths have no asr_s; the metric still appears.
    state.metrics = {"transcribe_s": 300.0}
    out = outputs.write_outputs(state, cfg)
    metrics = json.loads((Path(out.run_dir) / "metrics.json").read_text())
    assert metrics["realtime_factor"] == 12.4
