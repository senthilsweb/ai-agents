"""yt-dlp invocations.

Two rules hold everywhere in this module:

1. Commands are argument **lists**. Never a shell string, never shell=True.
2. The only user-derived value in any command is the validated 11-character
   video id, wrapped in the canonical URL built by `resolve.py`.
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
from pathlib import Path

from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from .config import Config
from .state import PipelineError, VideoRef

log = logging.getLogger(__name__)

PROBE_TIMEOUT_S = 90
DOWNLOAD_TIMEOUT_S = 1800


def _base_args(cfg: Config) -> list[str]:
    args = ["yt-dlp", "--no-playlist", "--no-warnings"]
    if cfg.cookies_file:
        args += ["--cookies", cfg.cookies_file]
    return args


def _run(args: list[str], timeout: int) -> subprocess.CompletedProcess:
    log.debug("exec: %s", " ".join(args))
    try:
        return subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=True,
        )
    except subprocess.TimeoutExpired as exc:
        raise PipelineError(f"{args[0]} timed out after {timeout}s") from exc
    except subprocess.CalledProcessError as exc:
        tail = (exc.stderr or "").strip().splitlines()[-3:]
        raise PipelineError(f"{args[0]} failed: {' | '.join(tail) or exc}") from exc


def probe_metadata(ref: VideoRef, cfg: Config) -> dict:
    """`yt-dlp -J` — title, channel, duration. No download."""
    args = _base_args(cfg) + ["-J", "--skip-download", ref.canonical_url]
    proc = _run(args, PROBE_TIMEOUT_S)
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise PipelineError(f"could not parse yt-dlp metadata for {ref.video_id}") from exc


@retry(
    retry=retry_if_exception_type(PipelineError),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=20),
    reraise=True,
)
def download_audio(ref: VideoRef, cfg: Config, dest_dir: Path) -> Path:
    """Download the audio stream only, into `dest_dir`.

    Retried three times with exponential backoff. Retry is right here and
    was wrong in job-pilot's matcher because this call is free and
    idempotent — there is no paid duplicate to protect against, only
    ordinary network flakiness and YouTube throttling.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    template = str(dest_dir / f"{ref.video_id}.%(ext)s")

    args = _base_args(cfg) + [
        "-f",
        "bestaudio/best",
        "--max-filesize",
        f"{cfg.max_filesize_mb}M",
        "--no-progress",
        "-o",
        template,
        ref.canonical_url,
    ]
    _run(args, DOWNLOAD_TIMEOUT_S)

    produced = sorted(dest_dir.glob(f"{ref.video_id}.*"))
    if not produced:
        raise PipelineError(
            f"yt-dlp reported success but wrote nothing for {ref.video_id} "
            f"(likely over the {cfg.max_filesize_mb}MB cap)"
        )
    return produced[0]


def ensure_available() -> None:
    """Fail fast, with the command needed to fix it."""
    missing = []
    if shutil.which("yt-dlp") is None:
        missing.append("yt-dlp  →  pip install yt-dlp  (or: brew install yt-dlp)")
    if shutil.which("ffmpeg") is None:
        missing.append("ffmpeg  →  brew install ffmpeg")
    if missing:
        raise PipelineError(
            "missing prerequisites:\n  " + "\n  ".join(missing)
        )
