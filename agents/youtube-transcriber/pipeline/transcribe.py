"""Local ASR via faster-whisper.

This is the step the whole agent exists for, and the reason a run costs
nothing: faster-whisper runs on this machine. There is no model API call,
no API key, and no token spend anywhere in this file. Audio does not leave
the box.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Iterable

from .config import Config
from .state import PipelineError, Segment, TranscriptState

log = logging.getLogger(__name__)

# One model per process. Loading distil-large-v3 takes a few seconds and
# several hundred MB, so transcribing two videos in one invocation should
# pay that once.
_MODEL_CACHE: dict[tuple[str, str], Any] = {}


def load_model(cfg: Config) -> Any:
    key = (cfg.asr_model, cfg.asr_compute_type)
    if key not in _MODEL_CACHE:
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:  # pragma: no cover - environment issue
            raise PipelineError(
                "faster-whisper is not installed  →  pip install faster-whisper"
            ) from exc

        log.info(
            "loading %s (%s) — first run downloads ~1GB of weights",
            cfg.asr_model,
            cfg.asr_compute_type,
        )
        # CPU by design: CTranslate2 has no Metal backend, so there is no
        # GPU path on macOS to fall back to. See design.md's ASR table.
        _MODEL_CACHE[key] = WhisperModel(
            cfg.asr_model, device="cpu", compute_type=cfg.asr_compute_type
        )
    return _MODEL_CACHE[key]


def to_segments(raw: Iterable[Any]) -> list[Segment]:
    """Adapt faster-whisper's segment stream to our typed model.

    The iterable is lazy — consuming it is what actually runs the
    transcription — so this function is also where the work happens.
    """
    segments: list[Segment] = []
    for i, seg in enumerate(raw):
        text = (seg.text or "").strip()
        if not text:
            # VAD sometimes yields an empty span at a boundary. An empty
            # segment is noise in every output format we write.
            continue
        segments.append(
            Segment(
                index=len(segments),
                start_s=round(float(seg.start), 3),
                end_s=round(float(seg.end), 3),
                text=text,
            )
        )
    return segments


def join_text(segments: list[Segment]) -> str:
    return " ".join(s.text for s in segments).strip()


def transcribe(state: TranscriptState, cfg: Config) -> TranscriptState:
    """Graph node. Not retried — this is local and deterministic, so a
    failure here is a real failure, not a flaky one."""
    if not state.audio_path:
        raise PipelineError("no audio to transcribe")

    # Model load is timed separately from the ASR itself. On the very first
    # run it includes a ~1GB weight download, which would otherwise be
    # charged to transcription and make the realtime factor look far worse
    # than it is. Found by comparing the two seed videos: 1.94 vs 4.68 on
    # the same machine, purely because the first one paid for the download.
    load_started = time.monotonic()
    model = load_model(cfg)
    model_load_s = round(time.monotonic() - load_started, 2)

    asr_started = time.monotonic()
    raw, info = model.transcribe(
        state.audio_path,
        beam_size=cfg.asr_beam_size,
        language=cfg.asr_language,  # None = auto-detect
        vad_filter=cfg.asr_vad,
    )

    # Consuming the lazy iterator is what actually runs the ASR, so the
    # clock has to stop after this line, not after model.transcribe().
    state.segments = to_segments(raw)
    asr_s = round(time.monotonic() - asr_started, 2)

    state.full_text = join_text(state.segments)
    state.language = getattr(info, "language", None) or cfg.asr_language
    state.model = cfg.asr_model
    state.metrics = {**state.metrics, "model_load_s": model_load_s, "asr_s": asr_s}

    if not state.segments:
        raise PipelineError(
            "transcription produced no speech — the audio may be silent or music-only"
        )

    log.info(
        "transcribed %s — %d segments, %d words, language %s",
        state.ref.video_id,
        len(state.segments),
        len(state.full_text.split()),
        state.language,
    )
    return state
