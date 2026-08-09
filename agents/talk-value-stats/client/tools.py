"""Host-side custom-tool handlers — the credential boundary.

The managed agent (agent/stats-extractor.agent.yaml) has no network and no
secrets; every capability round-trips through these handlers, which run on
the owner's machine holding TRANSCRIBER_URL / TRANSCRIBER_API_KEY /
OBJECT_STORE_* (see openspec/changes/deploy-stats-managed-agent design D2).

All failures return (message, is_error=True) — a tool error is a result the
agent handles, never a client crash (pii-discovery pattern).
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import extract  # noqa: E402
import objstore  # noqa: E402
from schema import ExtractedContent, TranscriptStatsPage  # noqa: E402

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
POLL_SLEEP_S = 10
JOB_CAP_S = 90 * 60


class ToolState:
    """Per-session driver state: transcript cache + job start times."""

    def __init__(self, http=None, model_label: str = "tvs-stats-extractor"):
        import httpx

        self.http = http or httpx.Client(timeout=30)
        self.transcripts: dict[str, str] = {}
        self.job_started: dict[str, float] = {}
        self.model_label = model_label
        self.base = os.environ["TRANSCRIBER_URL"].rstrip("/")
        self.headers = {}
        key = os.getenv("TRANSCRIBER_API_KEY", "").strip()
        if key:
            self.headers["X-API-Key"] = key


def handle_tool_call(name: str, args: dict, state: ToolState) -> tuple[str, bool]:
    try:
        fn = {
            "start_transcription": _start,
            "check_job": _check,
            "fetch_transcript": _fetch,
            "persist_page": _persist,
        }[name]
    except KeyError:
        return f"unknown tool: {name}", True
    try:
        return fn(args, state)
    except Exception as exc:  # noqa: BLE001 — tool errors are results
        return f"{type(exc).__name__}: {exc}", True


def _start(args: dict, s: ToolState) -> tuple[str, bool]:
    resp = s.http.post(
        f"{s.base}/transcribe", json={"url": args["url"]}, headers=s.headers
    )
    if resp.status_code >= 400:
        return f"transcriber rejected ({resp.status_code}): {resp.text}", True
    job = resp.json()
    s.job_started[job["job_id"]] = time.monotonic()
    return resp.text, False


def _check(args: dict, s: ToolState) -> tuple[str, bool]:
    job_id = args["job_id"]

    def get() -> dict:
        r = s.http.get(f"{s.base}/jobs/{job_id}", headers=s.headers)
        r.raise_for_status()
        return r.json()

    job = get()
    if job.get("status") in ("queued", "running"):
        # D3: the wait lives here, not in agent turns.
        started = s.job_started.setdefault(job_id, time.monotonic())
        if time.monotonic() - started > JOB_CAP_S:
            return f"job {job_id} exceeded the {JOB_CAP_S // 60}-min cap", True
        time.sleep(POLL_SLEEP_S)
        job = get()
    if job.get("status") == "error":
        return json.dumps(job), True
    return json.dumps(job), False


def _fetch(args: dict, s: ToolState) -> tuple[str, bool]:
    vid = args["video_id"].strip()
    if not VIDEO_ID_RE.match(vid):
        return f"not an 11-char video id: {vid!r}", True
    path = objstore.find_transcript_s3(vid)
    if path is None:
        return f"no stored transcript for {vid} — transcribe it first", True
    text = path.read_text()
    s.transcripts[vid] = text
    return text, False


def _persist(args: dict, s: ToolState) -> tuple[str, bool]:
    vid = args["video_id"].strip()
    text = s.transcripts.get(vid)
    if text is None:
        return f"fetch_transcript({vid}) must succeed before persist_page", True
    try:
        content = ExtractedContent.model_validate(json.loads(args["content_json"]))
    except Exception as exc:  # noqa: BLE001 — the schema gate (design D1)
        return f"validation failed — fix and retry:\n{exc}", True

    source = extract.parse_source(text)
    if source.videoId != vid:
        return f"transcript header is for {source.videoId}, not {vid}", True
    page = TranscriptStatsPage(
        slug=extract.slugify(source),
        source=source,
        speakers=content.speakers,
        headline=content.headline,
        examples=content.examples,
        extractedBy=s.model_label,
        extractedAt=datetime.now(timezone.utc).date().isoformat(),
    )

    import tempfile

    db_path = Path(tempfile.mkdtemp(prefix="tvs-db-")) / "db.json"
    objstore.pull_db(db_path)
    db = extract.load_db(db_path)
    db = extract.upsert(db, page)
    extract.write_db(db_path, db)
    objstore.push_db(db_path)

    n_metrics = sum(len(e.metrics) for e in page.examples)
    return (
        f"persisted {vid}: {len(page.examples)} example(s), {n_metrics} "
        f"metric(s), {len(page.speakers)} speaker(s); db now has {len(db)} page(s)"
    ), False
