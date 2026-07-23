"""Audio normalization and the cache that makes re-runs cheap.

Whisper resamples to 16 kHz mono internally whatever you give it, so
normalizing to exactly that discards nothing and shrinks a 60-minute talk
to roughly 7 MB. That is also why videos of this length need no chunking.
"""

from __future__ import annotations

import logging
import subprocess
import tempfile
from pathlib import Path

from .config import Config
from .state import PipelineError, TranscriptState, VideoRef

log = logging.getLogger(__name__)

FFMPEG_TIMEOUT_S = 1800


def cache_path(ref: VideoRef, cfg: Config) -> Path:
    """Cache filename is built from the validated id and nothing else."""
    return cfg.cache_dir / f"{ref.video_id}.opus"


def has_cached_audio(ref: VideoRef, cfg: Config) -> bool:
    path = cache_path(ref, cfg)
    return path.exists() and path.stat().st_size > 0


def normalize(src: Path, dest: Path) -> Path:
    """16 kHz mono opus at 16 kbps. Argument list, never a shell string."""
    dest.parent.mkdir(parents=True, exist_ok=True)

    # Write to a sibling temp file first: a crash mid-transcode must not
    # leave a truncated file that the next run treats as a cache hit.
    with tempfile.NamedTemporaryFile(
        dir=dest.parent, suffix=".opus", delete=False
    ) as tmp:
        tmp_path = Path(tmp.name)

    args = [
        "ffmpeg",
        "-nostdin",
        "-y",
        "-i",
        str(src),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "libopus",
        "-b:a",
        "16k",
        str(tmp_path),
    ]
    try:
        subprocess.run(
            args, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT_S, check=True
        )
    except subprocess.TimeoutExpired as exc:
        tmp_path.unlink(missing_ok=True)
        raise PipelineError(f"ffmpeg timed out after {FFMPEG_TIMEOUT_S}s") from exc
    except subprocess.CalledProcessError as exc:
        tmp_path.unlink(missing_ok=True)
        tail = (exc.stderr or "").strip().splitlines()[-3:]
        raise PipelineError(f"ffmpeg failed: {' | '.join(tail) or exc}") from exc

    tmp_path.replace(dest)
    return dest


# --- graph nodes -------------------------------------------------------


def fetch_audio(state: TranscriptState, cfg: Config) -> TranscriptState:
    from . import ytdlp

    with tempfile.TemporaryDirectory(prefix="ytx-") as tmpdir:
        raw = ytdlp.download_audio(state.ref, cfg, Path(tmpdir))
        # Normalize inside the same block: the raw download is disposable,
        # only the normalized file is worth keeping.
        dest = normalize(raw, cache_path(state.ref, cfg))

    state.raw_audio_path = None
    state.audio_path = str(dest)
    state.cache_hit = False
    log.info(
        "audio ready for %s (%.1f MB cached)",
        state.ref.video_id,
        dest.stat().st_size / 1_000_000,
    )
    return state


def use_cached_audio(state: TranscriptState, cfg: Config) -> TranscriptState:
    path = cache_path(state.ref, cfg)
    state.audio_path = str(path)
    state.cache_hit = True
    log.info("cache hit for %s — no download", state.ref.video_id)
    return state
