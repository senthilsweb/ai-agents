"""Eval 3 (cache branch) and eval 4 (retry policy). No network, no ffmpeg."""

from __future__ import annotations

from pathlib import Path

import pytest
from tenacity import wait_none

from pipeline import audio, ytdlp
from pipeline.config import Config
from pipeline.state import PipelineError, TranscriptState, VideoRef

SEED = "EQuCyrwyfXU"


@pytest.fixture()
def cfg(tmp_path: Path) -> Config:
    return Config(cache_dir=tmp_path / "cache", runs_dir=tmp_path / "runs")


@pytest.fixture()
def ref() -> VideoRef:
    return VideoRef(video_id=SEED, source_url=f"https://youtu.be/{SEED}")


@pytest.fixture(autouse=True)
def _no_retry_sleep():
    """Keep the retry test fast — behaviour under test is the count, not the wait."""
    original = ytdlp.download_audio.retry.wait
    ytdlp.download_audio.retry.wait = wait_none()
    yield
    ytdlp.download_audio.retry.wait = original


# --- cache branch ------------------------------------------------------


def test_cache_path_is_built_from_the_video_id_alone(ref: VideoRef, cfg: Config) -> None:
    path = audio.cache_path(ref, cfg)
    assert path.name == f"{SEED}.opus"
    assert path.parent == cfg.cache_dir


def test_no_cache_on_first_run(ref: VideoRef, cfg: Config) -> None:
    assert audio.has_cached_audio(ref, cfg) is False


def test_cache_hit_when_the_file_exists(ref: VideoRef, cfg: Config) -> None:
    path = audio.cache_path(ref, cfg)
    path.parent.mkdir(parents=True)
    path.write_bytes(b"not really opus, but non-empty")
    assert audio.has_cached_audio(ref, cfg) is True


def test_an_empty_cache_file_is_not_a_hit(ref: VideoRef, cfg: Config) -> None:
    # A crashed transcode must not look like a usable cache entry.
    path = audio.cache_path(ref, cfg)
    path.parent.mkdir(parents=True)
    path.touch()
    assert audio.has_cached_audio(ref, cfg) is False


def test_use_cached_audio_skips_the_network(ref: VideoRef, cfg: Config, monkeypatch) -> None:
    path = audio.cache_path(ref, cfg)
    path.parent.mkdir(parents=True)
    path.write_bytes(b"cached")

    def _boom(*_a, **_kw):  # pragma: no cover - must never run
        raise AssertionError("cache hit must not download anything")

    monkeypatch.setattr(ytdlp, "download_audio", _boom)

    state = audio.use_cached_audio(TranscriptState(ref=ref), cfg)
    assert state.cache_hit is True
    assert state.audio_path == str(path)


# --- retry policy ------------------------------------------------------


def test_download_retries_twice_then_succeeds(
    ref: VideoRef, cfg: Config, tmp_path: Path, monkeypatch
) -> None:
    calls = {"n": 0}
    dest = tmp_path / "dl"

    def fake_run(args, timeout):
        calls["n"] += 1
        if calls["n"] < 3:
            raise PipelineError("network hiccup")
        (dest / f"{SEED}.webm").write_bytes(b"audio")
        return None

    monkeypatch.setattr(ytdlp, "_run", fake_run)

    produced = ytdlp.download_audio(ref, cfg, dest)
    assert calls["n"] == 3
    assert produced.name == f"{SEED}.webm"


def test_download_gives_up_after_three_attempts(
    ref: VideoRef, cfg: Config, tmp_path: Path, monkeypatch
) -> None:
    calls = {"n": 0}

    def fake_run(args, timeout):
        calls["n"] += 1
        raise PipelineError("video unavailable")

    monkeypatch.setattr(ytdlp, "_run", fake_run)

    with pytest.raises(PipelineError):
        ytdlp.download_audio(ref, cfg, tmp_path / "dl")
    assert calls["n"] == 3


def test_silent_success_with_no_file_is_treated_as_failure(
    ref: VideoRef, cfg: Config, tmp_path: Path, monkeypatch
) -> None:
    # yt-dlp exits 0 when --max-filesize aborts the download.
    monkeypatch.setattr(ytdlp, "_run", lambda args, timeout: None)
    with pytest.raises(PipelineError, match="wrote nothing"):
        ytdlp.download_audio(ref, cfg, tmp_path / "dl")


# --- command construction ----------------------------------------------


def test_commands_are_argument_lists_carrying_only_the_canonical_url(
    ref: VideoRef, cfg: Config, monkeypatch
) -> None:
    seen: list[list[str]] = []

    def fake_run(args, timeout):
        seen.append(args)
        raise PipelineError("stop here — we only want the argv")

    monkeypatch.setattr(ytdlp, "_run", fake_run)
    with pytest.raises(PipelineError):
        ytdlp.probe_metadata(ref, cfg)

    args = seen[0]
    assert isinstance(args, list) and args[0] == "yt-dlp"
    assert args[-1] == f"https://www.youtube.com/watch?v={SEED}"
    # No shell metacharacter can appear, because nothing but the id is
    # interpolated in the first place.
    assert not any(tok in " ".join(args) for tok in (";", "&&", "|", "$("))


def test_cookies_file_is_passed_only_when_configured(ref: VideoRef) -> None:
    assert "--cookies" not in ytdlp._base_args(Config())
    args = ytdlp._base_args(Config(cookies_file="/tmp/c.txt"))
    assert args[args.index("--cookies") + 1] == "/tmp/c.txt"


def test_filesize_cap_is_always_applied(
    ref: VideoRef, tmp_path: Path, monkeypatch
) -> None:
    seen: list[list[str]] = []
    monkeypatch.setattr(
        ytdlp, "_run", lambda args, timeout: seen.append(args)
    )
    with pytest.raises(PipelineError):
        ytdlp.download_audio(ref, Config(max_filesize_mb=200), tmp_path / "dl")
    assert "--max-filesize" in seen[0]
    assert "200M" in seen[0]
