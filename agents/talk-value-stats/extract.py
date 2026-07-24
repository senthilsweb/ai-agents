"""Extract quantified value stats from a transcript into the JSON DB.

    python extract.py runs/<ts>-<id>/transcript.md
    python extract.py <video-id>            # finds the latest runs/*-<id>/transcript.md

Reads a transcript.md, calls Claude with a config-loaded prompt to get a
schema-matched `ExtractedContent` (structured outputs — the model is forced to
return something that validates), assembles a full `TranscriptStatsPage` with an
authoritative `VideoSource` parsed from the transcript header, and upserts it
into `db.json` (keyed by videoId).

This is the ONE place in the whole agent that calls a GenAI model — it is a
separate agent; the sibling youtube-transcriber stays 100% LLM-free. Needs an
Anthropic credential (env `ANTHROPIC_API_KEY`, or an `ant auth login` profile)
and the agent installed:

    pip install -e .

Model is resolved from env, per the monorepo convention (no hard-coded default):
`MODEL_STATS_EXTRACTOR` → `MODEL` → startup error.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

# schema.py sits next to this file.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from schema import (  # noqa: E402
    ExtractedContent,
    StatsDB,
    TranscriptStatsPage,
    VideoSource,
)

HERE = Path(__file__).resolve().parent
DEFAULT_DB = HERE / "db.json"
PROMPT_FILE = HERE / "prompts" / "extract.md"
# This agent consumes transcripts; it doesn't produce them. By default they come
# from the sibling youtube-transcriber agent's runs/ — override with $TRANSCRIBER_RUNS.
TRANSCRIBER_RUNS = Path(
    os.getenv("TRANSCRIBER_RUNS", HERE.parent / "youtube-transcriber" / "runs")
)

# transcript.md header lines: "- Source: https://www.youtube.com/watch?v=<id>"
_HEADER = {
    "url": re.compile(r"^- Source:\s*(\S+)", re.M),
    "channel": re.compile(r"^- Channel:\s*(.+)$", re.M),
    "duration": re.compile(r"^- Duration:\s*(\d{2}):(\d{2}):(\d{2})", re.M),
}
_VIDEO_ID = re.compile(r"[?&]v=([A-Za-z0-9_-]{11})")
_TITLE = re.compile(r"^#\s+(.+?)\s*$", re.M)


def resolve_model() -> str:
    """MODEL_STATS_EXTRACTOR → MODEL → error. No hard-coded default (repo rule)."""
    model = os.getenv("MODEL_STATS_EXTRACTOR") or os.getenv("MODEL")
    if not model:
        sys.exit(
            "No model configured. Set MODEL_STATS_EXTRACTOR (or MODEL) in the "
            "environment, e.g. MODEL_STATS_EXTRACTOR=claude-opus-4-8"
        )
    return model


def find_transcript(arg: str) -> Path:
    """Accept a transcript.md path, or an 11-char video id to look up in runs/."""
    p = Path(arg)
    if p.is_file():
        return p
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", arg):
        matches = sorted(TRANSCRIBER_RUNS.glob(f"*-{arg}/transcript.md"))
        if matches:
            return matches[-1]  # latest by timestamped dir name
        sys.exit(f"No transcript found for video id {arg} under {TRANSCRIBER_RUNS}")
    sys.exit(f"Not a transcript file or 11-char video id: {arg}")


def parse_source(text: str) -> VideoSource:
    """Build an authoritative VideoSource from the transcript.md header."""
    url_m = _HEADER["url"].search(text)
    if not url_m:
        sys.exit("Transcript header has no `- Source:` URL")
    url = url_m.group(1)
    vid_m = _VIDEO_ID.search(url)
    if not vid_m:
        sys.exit(f"Could not find an 11-char video id in {url}")

    title_m = _TITLE.search(text)
    chan_m = _HEADER["channel"].search(text)
    dur_m = _HEADER["duration"].search(text)
    duration = (
        int(dur_m.group(1)) * 3600 + int(dur_m.group(2)) * 60 + int(dur_m.group(3))
        if dur_m
        else None
    )
    return VideoSource(
        videoId=vid_m.group(1),
        title=title_m.group(1).strip() if title_m else vid_m.group(1),
        channel=chan_m.group(1).strip() if chan_m else None,
        url=f"https://www.youtube.com/watch?v={vid_m.group(1)}",
        durationSeconds=duration,
        publishedAt=None,
    )


def slugify(source: VideoSource) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", source.title.lower()).strip("-")
    base = re.sub(r"-{2,}", "-", base)[:60].strip("-")
    return base or source.videoId.lower()


def extract_content(text: str, source: VideoSource, model: str) -> ExtractedContent:
    from anthropic import Anthropic  # imported here so `build.py` needs no anthropic

    prompt = PROMPT_FILE.read_text().format(
        title=source.title,
        channel=source.channel or "(unknown)",
        transcript=text,
    )
    client = Anthropic()
    response = client.messages.parse(
        model=model,
        max_tokens=8000,
        messages=[{"role": "user", "content": prompt}],
        output_format=ExtractedContent,
    )
    if response.parsed_output is None:
        sys.exit(
            "Model did not return schema-valid content "
            f"(stop_reason={response.stop_reason}). Nothing written."
        )
    return response.parsed_output


def load_db(path: Path) -> list[TranscriptStatsPage]:
    if not path.exists():
        return []
    return StatsDB.validate_python(json.loads(path.read_text()))


def upsert(db: list[TranscriptStatsPage], page: TranscriptStatsPage) -> list[TranscriptStatsPage]:
    out = [p for p in db if p.source.videoId != page.source.videoId]
    out.append(page)
    out.sort(key=lambda p: p.source.title.lower())
    return out


def write_db(path: Path, db: list[TranscriptStatsPage]) -> None:
    payload = StatsDB.dump_python(db, mode="json", exclude_none=False)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


def main() -> None:
    load_dotenv(HERE / ".env")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("transcript", help="path to a transcript.md, or an 11-char video id")
    ap.add_argument("--db", type=Path, default=DEFAULT_DB, help="JSON DB path")
    args = ap.parse_args()

    model = resolve_model()
    tpath = find_transcript(args.transcript)
    text = tpath.read_text()
    source = parse_source(text)

    print(f"Extracting from {tpath} → model {model} …")
    content = extract_content(text, source, model)

    # Stamp the run date. datetime.now() is fine here (a CLI, not a workflow script).
    stamped = datetime.now(timezone.utc).date().isoformat()
    page = TranscriptStatsPage(
        slug=slugify(source),
        source=source,
        speakers=content.speakers,
        headline=content.headline,
        examples=content.examples,
        extractedBy=model,
        extractedAt=stamped,
    )

    db = load_db(args.db)
    db = upsert(db, page)
    write_db(args.db, db)

    n_metrics = sum(len(e.metrics) for e in page.examples)
    print(
        f"✓ {source.videoId}: {len(page.examples)} example(s), {n_metrics} metric(s), "
        f"{len(page.speakers)} speaker(s) → {args.db} ({len(db)} total)"
    )


if __name__ == "__main__":
    main()
