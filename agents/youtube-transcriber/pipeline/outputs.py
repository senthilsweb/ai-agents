"""Write the four artifacts of a run.

Run directory names are built from the validated video id and a timestamp,
and from nothing else. Titles and channel names are metadata written *into*
files — never used as path components, so a hostile title cannot escape
`runs/`.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from .config import Config
from .state import Segment, TranscriptState

log = logging.getLogger(__name__)

# A pause longer than this starts a new paragraph in the markdown.
PARAGRAPH_GAP_S = 2.0
PARAGRAPH_MAX_CHARS = 700


def srt_timestamp(seconds: float) -> str:
    """`HH:MM:SS,mmm` — the SRT spec's comma, not a period."""
    if seconds < 0:
        seconds = 0.0
    ms_total = int(round(seconds * 1000))
    hours, rem = divmod(ms_total, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, ms = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def clock(seconds: float) -> str:
    """`HH:MM:SS` — the readable marker used in the markdown."""
    total = int(seconds)
    return f"{total // 3600:02d}:{(total % 3600) // 60:02d}:{total % 60:02d}"


def to_srt(segments: list[Segment]) -> str:
    blocks = []
    for i, seg in enumerate(segments, start=1):
        blocks.append(
            f"{i}\n"
            f"{srt_timestamp(seg.start_s)} --> {srt_timestamp(seg.end_s)}\n"
            f"{seg.text}\n"
        )
    return "\n".join(blocks)


def to_paragraphs(segments: list[Segment]) -> list[tuple[float, str]]:
    """Group segments into readable paragraphs on pauses and length."""
    paragraphs: list[tuple[float, str]] = []
    start = None
    buf: list[str] = []
    prev_end = 0.0

    for seg in segments:
        gap = seg.start_s - prev_end
        too_long = sum(len(t) + 1 for t in buf) > PARAGRAPH_MAX_CHARS
        if buf and (gap > PARAGRAPH_GAP_S or too_long):
            paragraphs.append((start or 0.0, " ".join(buf)))
            buf, start = [], None
        if start is None:
            start = seg.start_s
        buf.append(seg.text)
        prev_end = seg.end_s

    if buf:
        paragraphs.append((start or 0.0, " ".join(buf)))
    return paragraphs


def to_markdown(state: TranscriptState) -> str:
    lines = [
        f"# {state.title or state.ref.video_id}",
        "",
        f"- Source: {state.ref.canonical_url}",
    ]
    if state.channel:
        lines.append(f"- Channel: {state.channel}")
    if state.duration_s:
        lines.append(f"- Duration: {clock(state.duration_s)}")
    lines += [
        f"- Language: {state.language or 'unknown'}",
        f"- Transcribed by: faster-whisper `{state.model}` (local)",
        "",
        "---",
        "",
    ]
    for start, text in to_paragraphs(state.segments):
        lines += [f"**[{clock(start)}]** {text}", ""]
    return "\n".join(lines)


def to_json(state: TranscriptState) -> dict:
    return {
        "video_id": state.ref.video_id,
        "url": state.ref.canonical_url,
        "title": state.title,
        "channel": state.channel,
        "duration_s": state.duration_s,
        "language": state.language,
        "model": state.model,
        "segment_count": len(state.segments),
        "word_count": len(state.full_text.split()),
        "full_text": state.full_text,
        "segments": [s.model_dump() for s in state.segments],
    }


def run_dir_name(video_id: str, now: datetime | None = None) -> str:
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
    return f"{stamp}-{video_id}"


def write_outputs(
    state: TranscriptState, cfg: Config, now: datetime | None = None
) -> TranscriptState:
    """Graph node: create the run folder and write all four artifacts."""
    run_dir = cfg.runs_dir / run_dir_name(state.ref.video_id, now)
    run_dir.mkdir(parents=True, exist_ok=True)

    (run_dir / "transcript.json").write_text(
        json.dumps(to_json(state), indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (run_dir / "transcript.md").write_text(to_markdown(state), encoding="utf-8")
    (run_dir / "transcript.srt").write_text(to_srt(state.segments), encoding="utf-8")

    metrics = dict(state.metrics)
    metrics.update(
        {
            "video_id": state.ref.video_id,
            "audio_duration_s": state.duration_s,
            "cache_hit": state.cache_hit,
            "model": state.model,
            "segment_count": len(state.segments),
            "word_count": len(state.full_text.split()),
        }
    )
    # Prefer asr_s over transcribe_s: the latter includes model load, which
    # on a first run means a ~1GB download. Charging that to transcription
    # made the first seed video look 2.4x slower than the second on the same
    # machine. The realtime factor should describe the ASR alone.
    asr_s = metrics.get("asr_s") or metrics.get("transcribe_s")
    if asr_s and state.duration_s:
        metrics["realtime_factor"] = round(state.duration_s / asr_s, 2)
    (run_dir / "metrics.json").write_text(
        json.dumps(metrics, indent=2), encoding="utf-8"
    )

    state.run_dir = str(run_dir)
    state.metrics = metrics
    log.info("wrote %s", run_dir)
    return state
