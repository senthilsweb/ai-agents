"""FastAPI service around the transcription pipeline.

The pipeline is imported and called unchanged (`run_one`); this module only
adds HTTP, an async job lifecycle, and a resident ASR model. There is still no
LLM, no token spend, and no API key anywhere — the server is plumbing.

Run it:

    uvicorn server.app:app --host 0.0.0.0 --port 8000

Transcription is CPU-bound and can take minutes, so `POST /transcribe` returns
a job id immediately and the caller polls `GET /jobs/{id}`. The work runs off
the event loop in a worker thread; the model is loaded once at startup and held
resident, so a request never pays the ~1 GB weight load.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from dataclasses import replace
from pathlib import Path
from typing import Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from pipeline import telemetry, transcribe, ytdlp
from pipeline.config import Config
from pipeline.graph import run_one
from pipeline.resolve import parse_video_ref
from pipeline.state import PipelineError, TranscriptState

log = logging.getLogger("youtube-transcriber.server")

# The three artifact files a completed run leaves in its run directory, keyed by
# the extension the download endpoint accepts.
ARTIFACTS = {
    "json": ("transcript.json", "application/json"),
    "md": ("transcript.md", "text/markdown; charset=utf-8"),
    "srt": ("transcript.srt", "application/x-subrip; charset=utf-8"),
}

JobStatus = Literal["queued", "running", "done", "error"]


class TranscribeRequest(BaseModel):
    """One of `video_id` or `url` is required; both accept the same values the
    CLI does, since `parse_video_ref` handles a bare id or a full URL."""

    video_id: Optional[str] = None
    url: Optional[str] = None
    model: Optional[str] = None
    language: Optional[str] = None

    def raw_input(self) -> str:
        raw = (self.video_id or self.url or "").strip()
        if not raw:
            raise ValueError("provide either video_id or url")
        return raw


class Job(BaseModel):
    id: str
    status: JobStatus = "queued"
    video_id: str
    error: Optional[str] = None
    result: Optional[dict] = None
    run_dir: Optional[str] = None


class AppState:
    """Process-wide singletons. The queue is created in `lifespan`, not here,
    so it binds to the running event loop (creating it at import time would
    bind it to the wrong loop and the worker would never consume)."""

    def __init__(self) -> None:
        self.cfg: Config | None = None
        self.jobs: dict[str, Job] = {}
        self.queue: asyncio.Queue[tuple[str, str, Config]] | None = None
        self.worker: asyncio.Task | None = None
        self.model_ready: bool = False


state = AppState()


def _cfg_for(base: Config, req: TranscribeRequest) -> Config:
    """Apply per-request model/language overrides onto the base config."""
    overrides: dict = {}
    if req.model:
        overrides["asr_model"] = req.model
    if req.language:
        overrides["asr_language"] = req.language
    return replace(base, **overrides) if overrides else base


async def _worker() -> None:
    """Single background consumer. Concurrency is 1 on purpose: the work is
    CPU-bound, so running jobs in parallel would only make each one slower."""
    while True:
        job_id, raw, cfg = await state.queue.get()
        job = state.jobs[job_id]
        job.status = "running"
        log.info("job %s running: %s", job_id, job.video_id)
        try:
            # run_one is synchronous and CPU-heavy — keep it off the event loop
            # so status polls stay responsive.
            result: TranscriptState = await asyncio.to_thread(run_one, raw, cfg)
            job.run_dir = result.run_dir
            job.result = {
                "video_id": result.ref.video_id,
                "title": result.title,
                "language": result.language,
                "model": result.model,
                "segment_count": len(result.segments),
                "word_count": len(result.full_text.split()),
                "cache_hit": result.cache_hit,
                "metrics": result.metrics,
                "artifacts": {
                    ext: f"/jobs/{job_id}/transcript.{ext}" for ext in ARTIFACTS
                },
            }
            job.status = "done"
            log.info("job %s done: %s", job_id, result.run_dir)
        except PipelineError as exc:
            job.status = "error"
            job.error = str(exc)
            log.error("job %s failed: %s", job_id, exc)
        except Exception as exc:  # noqa: BLE001 - one bad job must not kill the worker
            job.status = "error"
            job.error = f"unexpected: {exc}"
            log.exception("job %s crashed", job_id)
        finally:
            state.queue.task_done()


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_dotenv()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    state.cfg = Config.from_env()
    state.jobs = {}
    state.queue = asyncio.Queue()
    state.model_ready = False
    telemetry.configure()

    # Fail fast on missing binaries, same as the CLI does before any work.
    ytdlp.ensure_available()

    # Warm the model once so the first request does not pay the load. This
    # reuses the pipeline's own model cache, so nothing in transcribe.py
    # changes.
    log.info("warming ASR model %s (%s)", state.cfg.asr_model, state.cfg.asr_compute_type)
    await asyncio.to_thread(transcribe.load_model, state.cfg)
    state.model_ready = True
    log.info("model resident — ready")

    state.worker = asyncio.create_task(_worker())
    try:
        yield
    finally:
        if state.worker:
            state.worker.cancel()
        state.model_ready = False
        telemetry.shutdown()


app = FastAPI(title="youtube-transcriber", version="0.1.0", lifespan=lifespan)


@app.middleware("http")
async def require_api_key(request, call_next):
    """API-key gate for public exposure (deploy-stats-managed-agent).

    Env-gated: no TRANSCRIBER_API_KEY set means an open service (the
    loopback/local deployments). With a key set, every endpoint except
    GET /healthz requires a matching X-API-Key header — an unauthenticated
    public service is a CPU-DoS and transcript-exfiltration surface.
    """
    import os
    import secrets as _secrets

    from fastapi.responses import JSONResponse

    expected = os.getenv("TRANSCRIBER_API_KEY", "").strip()
    if expected and request.url.path != "/healthz":
        supplied = request.headers.get("x-api-key", "")
        if not _secrets.compare_digest(supplied, expected):
            return JSONResponse({"detail": "invalid or missing API key"}, status_code=401)
    return await call_next(request)


@app.get("/healthz")
def healthz() -> dict:
    return {
        "ready": state.model_ready and state.worker is not None,
        "model_loaded": state.model_ready,
        "model": state.cfg.asr_model if state.cfg else None,
        "queued": state.queue.qsize() if state.queue else 0,
        "jobs": len(state.jobs),
    }


@app.post("/transcribe", status_code=202)
async def transcribe_endpoint(req: TranscribeRequest) -> dict:
    # Validate through the pipeline's own boundary before anything else: only a
    # validated 11-char id or an allowlisted-host URL is allowed to become a
    # job. A bad input never creates a job and never reaches a subprocess.
    try:
        raw = req.raw_input()
        ref = parse_video_ref(raw)
    except (ValueError, PipelineError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    job_id = uuid.uuid4().hex
    state.jobs[job_id] = Job(id=job_id, video_id=ref.video_id)
    await state.queue.put((job_id, raw, _cfg_for(state.cfg, req)))
    log.info("job %s queued: %s", job_id, ref.video_id)
    return {"job_id": job_id, "status": "queued"}


@app.get("/jobs")
def list_jobs() -> dict:
    return {"jobs": [j.model_dump() for j in state.jobs.values()]}


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> Job:
    job = state.jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    return job


@app.get("/jobs/{job_id}/transcript.{ext}")
def get_artifact(job_id: str, ext: str) -> FileResponse:
    if ext not in ARTIFACTS:
        raise HTTPException(status_code=404, detail=f"unknown artifact .{ext}")
    job = state.jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="no such job")
    if job.status != "done" or not job.run_dir:
        raise HTTPException(status_code=409, detail=f"job is {job.status}, not done")

    filename, media_type = ARTIFACTS[ext]
    path = Path(job.run_dir) / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="artifact not found on disk")
    return FileResponse(path, media_type=media_type, filename=filename)
