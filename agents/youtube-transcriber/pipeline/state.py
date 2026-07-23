"""Typed state for the transcription graph.

Pydantic rather than a bare TypedDict: `video_id` validation belongs on the
model, so no node can construct a reference that would be unsafe to hand to
a subprocess or use as a path component.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


class VideoRef(BaseModel):
    """A validated YouTube video reference.

    `video_id` is the only user-derived value allowed to reach a subprocess
    argument or a filesystem path, which is why it is validated here rather
    than at each use site.
    """

    video_id: str
    source_url: str

    @field_validator("video_id")
    @classmethod
    def _valid_id(cls, v: str) -> str:
        if not VIDEO_ID_RE.match(v):
            raise ValueError(f"not a YouTube video id: {v!r}")
        return v

    @property
    def canonical_url(self) -> str:
        return f"https://www.youtube.com/watch?v={self.video_id}"


class Segment(BaseModel):
    """One ASR segment: a span of audio and the words heard in it."""

    index: int
    start_s: float
    end_s: float
    text: str


class TranscriptState(BaseModel):
    """State threaded through the graph, one instance per video."""

    ref: VideoRef

    # Filled by resolve_video from `yt-dlp -J`.
    title: str | None = None
    channel: str | None = None
    duration_s: float | None = None

    # Filled by fetch_audio / normalize_audio, or skipped on a cache hit.
    raw_audio_path: str | None = None  # whatever yt-dlp gave us
    audio_path: str | None = None  # normalized 16 kHz mono, cached
    cache_hit: bool = False

    # Filled by transcribe.
    language: str | None = None
    model: str | None = None
    segments: list[Segment] = Field(default_factory=list)
    full_text: str = ""

    # Filled by write_outputs.
    run_dir: str | None = None

    metrics: dict = Field(default_factory=dict)
    failures: list[str] = Field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.failures


class PipelineError(Exception):
    """A failure that ends this video's run but not the whole invocation."""
