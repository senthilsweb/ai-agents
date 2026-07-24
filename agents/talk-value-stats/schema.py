"""The one source of truth for a stats page — pydantic v2.

One page = one YouTube video (`TranscriptStatsPage`) holding an ordered list of
examples; each example holds an ordered list of metrics. Metrics are a UNIFORM
list tagged by `category` rather than fixed named fields, because real talks
state numbers that fixed slots can't hold (200 bps EBITA, 85,000 lives, 400x).
Every metric is grounded to the verbatim words that made it.

Field names are camelCase to match the on-disk JSON DB (`db.json`) and the
JavaScript-flavoured web conventions the generated site uses. This module is
canonical: the GenAI extractor validates against `ExtractedContent`, the DB is
`list[TranscriptStatsPage]`, and the static-site builder renders from it.

This is the `talk-value-stats` agent — a downstream reader of transcript output.
The sibling `youtube-transcriber` agent stays 100% LLM-free; this agent is the
one that calls a model, and only in `extract.py`.
"""

from __future__ import annotations

import re
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, TypeAdapter, field_validator

_TS = re.compile(r"^\d{2}:\d{2}:\d{2}$")
_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")

# How firmly the number is claimed in the talk.
#   stated    — already achieved   ("it resolved over 7,000 tickets")
#   projected — in-flight/expected  ("we're getting them there 4 quarters ahead")
#   estimated — speaker's own rough figure ("about 400x", "roughly")
Confidence = Literal["stated", "projected", "estimated"]

# The kind of outcome a metric captures. Drives the tile icon + colour and lets
# the renderer group like with like. `other` is the deliberate escape hatch.
MetricCategory = Literal[
    "productivity_gain",   # 400x output, 5,000 hrs/mo saved
    "cost_savings",        # $60M saved
    "additional_revenue",  # £2B new revenue
    "fte_savings",         # "= 31 engineers", "1 person did what took 1000"
    "cycle_time",          # 26mo -> 4 quarters early, shipped in 3 weeks
    "quality",             # 91% resolution, 200 bps EBITA
    "scale",               # 130,000 cases, 94 companies > $100M
    "other",               # 85,000 lives saved
]

Direction = Literal["up", "down", "neutral"]


class _Model(BaseModel):
    # Reject unknown keys so a typo in the DB or a stray field from the model
    # fails loudly instead of silently vanishing.
    model_config = ConfigDict(extra="forbid")


class Person(_Model):
    """A speaker/influencer who gave the stats, and the company they represent."""

    name: str
    role: Optional[str] = None          # "CEO", "Engineering Manager", "Host"
    company: Optional[str] = None       # "Ascendion", "Vercel", "Y Combinator"
    headshotUrl: Optional[str] = None   # optional avatar in the detail header
    profileUrl: Optional[str] = None    # LinkedIn / X


class Metric(_Model):
    """One quantified claim, always grounded to the words that made it."""

    category: MetricCategory
    label: str                          # tile label: "Cost saved", "Tickets resolved"
    value: Optional[float] = None       # machine value where one cleanly exists (60_000_000), else None
    unit: str = ""                      # "$", "%", "x", "hrs/mo", "FTE", "quarters", "people", "bps"
    display: str                        # exactly what the tile shows: "$60M", "91%", "400x"
    direction: Direction = "neutral"
    confidence: Confidence = "stated"
    quote: str                          # verbatim sentence from the transcript (evidence)
    timestamp: Optional[str] = None     # "HH:MM:SS"; deep-links to ?t= on YouTube

    @field_validator("timestamp")
    @classmethod
    def _ts(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not _TS.match(v):
            raise ValueError("timestamp must be HH:MM:SS")
        return v


class Example(_Model):
    """One quantified example / case study inside a talk."""

    useCase: str                        # "Customer support automation"
    org: Optional[str] = None           # "Vercel", "a UK bank", "Fortune 100 client"
    speakerName: Optional[str] = None   # references a page speakers[].name — who made THESE claims
    summary: str                        # 1-2 sentence running summary
    metrics: list[Metric]               # IN THE ORDER they appear in the talk
    timestampStart: Optional[str] = None

    @field_validator("metrics")
    @classmethod
    def _non_empty(cls, v: list[Metric]) -> list[Metric]:
        if not v:
            raise ValueError("an example needs at least one metric")
        return v

    @field_validator("timestampStart")
    @classmethod
    def _ts(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not _TS.match(v):
            raise ValueError("timestampStart must be HH:MM:SS")
        return v


class VideoSource(_Model):
    """The YouTube source — everything the header + thumbnail needs.

    Assembled by the extractor from the transcript header, never from the model,
    so the id/url/duration are authoritative. Thumbnail is DERIVED from videoId
    (https://i.ytimg.com/vi/<id>/hqdefault.jpg), never stored.
    """

    videoId: str
    title: str
    channel: Optional[str] = None
    url: str
    durationSeconds: Optional[int] = None
    publishedAt: Optional[str] = None

    @field_validator("videoId")
    @classmethod
    def _vid(cls, v: str) -> str:
        if not _VIDEO_ID.match(v):
            raise ValueError("videoId must be 11 url-safe chars")
        return v


class ExtractedContent(_Model):
    """What the GenAI model returns — the judgement-heavy part only.

    The extractor combines this with an authoritative VideoSource (parsed from
    the transcript header) to build a full TranscriptStatsPage, so the model
    never has to guess the video id, url, or duration.
    """

    headline: Optional[str] = None      # one-line takeaway for the hero
    speakers: list[Person]              # featured people; speakers[0] = primary author
    examples: list[Example]             # [] is valid: a talk with no hard numbers


class TranscriptStatsPage(_Model):
    """One page = one video + its extracted examples, in order."""

    schemaVersion: Literal[2] = 2
    slug: str                           # detail-page filename, e.g. "vercel-support-agent"
    source: VideoSource
    speakers: list[Person]              # featured people; speakers[0] = primary "author"
    headline: Optional[str] = None
    examples: list[Example]
    extractedBy: str = "manual"         # "manual" or the model id
    extractedAt: str                    # ISO date it was keyed in

    @field_validator("slug")
    @classmethod
    def _slug(cls, v: str) -> str:
        if not re.match(r"^[a-z0-9-]+$", v):
            raise ValueError("slug must be kebab-case [a-z0-9-]")
        return v


# The JSON DB is a single file holding an array of pages.
StatsDB = TypeAdapter(list[TranscriptStatsPage])


def thumbnail_url(video_id: str) -> str:
    return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"


def watch_url(video_id: str, seconds: Optional[int] = None) -> str:
    base = f"https://www.youtube.com/watch?v={video_id}"
    return f"{base}&t={seconds}s" if seconds else base


def ts_to_seconds(ts: str) -> int:
    h, m, s = (int(p) for p in ts.split(":"))
    return h * 3600 + m * 60 + s
