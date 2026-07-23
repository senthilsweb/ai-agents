"""Runtime configuration, read from the environment.

Everything is env-driven so that trying a different Whisper model is a
config edit rather than a code change. There are no secrets here — the ASR
path is entirely local, so there is no API key to hold.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent


def _int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Config:
    # ASR — defaults pinned at the Inception gate (2026-07-23): accuracy
    # over speed, so distil-large-v3 stays even though it is not the
    # fastest option.
    asr_model: str = "distil-large-v3"
    asr_compute_type: str = "int8"
    asr_language: str | None = None
    asr_beam_size: int = 5
    asr_vad: bool = True

    # Limits, both checked before any audio is downloaded.
    max_duration_min: int = 180
    max_filesize_mb: int = 200

    cookies_file: str | None = None

    runs_dir: Path = AGENT_ROOT / "runs"
    cache_dir: Path = AGENT_ROOT / ".cache" / "audio"
    logs_dir: Path = AGENT_ROOT / "logs"

    @classmethod
    def from_env(cls) -> "Config":
        lang = os.getenv("ASR_LANGUAGE", "").strip() or None
        cookies = os.getenv("YT_COOKIES_FILE", "").strip() or None
        return cls(
            asr_model=os.getenv("ASR_MODEL", "").strip() or cls.asr_model,
            asr_compute_type=(
                os.getenv("ASR_COMPUTE_TYPE", "").strip() or cls.asr_compute_type
            ),
            asr_language=lang,
            asr_beam_size=_int("ASR_BEAM_SIZE", cls.asr_beam_size),
            asr_vad=_bool("ASR_VAD", cls.asr_vad),
            max_duration_min=_int("MAX_DURATION_MIN", cls.max_duration_min),
            max_filesize_mb=_int("MAX_FILESIZE_MB", cls.max_filesize_mb),
            cookies_file=cookies,
        )
