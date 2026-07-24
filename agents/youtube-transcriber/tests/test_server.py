"""Service tests: the HTTP layer, with the pipeline stubbed out.

No network, no model, no secrets — the same rule the rest of this agent's
tests follow. `run_one` is replaced with a stub, and the two startup calls
(`ytdlp.ensure_available`, `transcribe.load_model`) are neutralised so the
lifespan runs instantly. What is exercised here is the job lifecycle, the
input-validation boundary, and the artifact endpoints — not transcription.
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pipeline.config import Config
from pipeline.state import PipelineError, Segment, TranscriptState, VideoRef

import server.app as srv

SEED_A = "EQuCyrwyfXU"


def _fake_state(video_id: str, run_dir: Path) -> TranscriptState:
    """A completed run, with its three artifacts written to `run_dir`."""
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "transcript.md").write_text(f"# {video_id}\n\nhello world\n")
    (run_dir / "transcript.srt").write_text("1\n00:00:00,000 --> 00:00:01,000\nhi\n")
    (run_dir / "transcript.json").write_text(json.dumps({"video_id": video_id}))
    return TranscriptState(
        ref=VideoRef(video_id=video_id, source_url=f"https://youtu.be/{video_id}"),
        title="Fake talk",
        language="en",
        model="distil-large-v3",
        segments=[Segment(index=0, start_s=0.0, end_s=1.0, text="hello world")],
        full_text="hello world",
        run_dir=str(run_dir),
        metrics={"asr_s": 1.0, "realtime_factor": 4.8},
    )


@pytest.fixture()
def client(monkeypatch, tmp_path: Path) -> TestClient:
    # Neutralise the two things startup does that would need a real environment.
    monkeypatch.setattr(srv.ytdlp, "ensure_available", lambda: None)
    monkeypatch.setattr(srv.transcribe, "load_model", lambda cfg: object())
    # Keep any writes out of the real runs/ directory.
    monkeypatch.setattr(
        srv.Config,
        "from_env",
        classmethod(lambda cls: Config(runs_dir=tmp_path / "runs", cache_dir=tmp_path / "cache")),
    )
    with TestClient(srv.app) as c:
        yield c


def _poll(client: TestClient, job_id: str, want: str, timeout: float = 5.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f"/jobs/{job_id}").json()
        if job["status"] in (want, "error"):
            return job
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} never reached {want}")


def test_healthz_ready(client: TestClient):
    body = client.get("/healthz").json()
    assert body["ready"] is True
    assert body["model_loaded"] is True


def test_job_lifecycle_and_artifacts(client: TestClient, monkeypatch, tmp_path: Path):
    def fake_run_one(raw: str, cfg: Config) -> TranscriptState:
        return _fake_state(SEED_A, tmp_path / "runs" / f"stamp-{SEED_A}")

    monkeypatch.setattr(srv, "run_one", fake_run_one)

    r = client.post("/transcribe", json={"video_id": SEED_A})
    assert r.status_code == 202
    job_id = r.json()["job_id"]
    assert r.json()["status"] == "queued"

    job = _poll(client, job_id, "done")
    assert job["status"] == "done", job
    assert job["result"]["word_count"] == 2
    assert job["result"]["video_id"] == SEED_A

    md = client.get(f"/jobs/{job_id}/transcript.md")
    assert md.status_code == 200
    assert "hello world" in md.text

    js = client.get(f"/jobs/{job_id}/transcript.json")
    assert js.status_code == 200
    assert js.json()["video_id"] == SEED_A


def test_bad_id_creates_no_job(client: TestClient):
    before = len(client.get("/jobs").json()["jobs"])
    r = client.post("/transcribe", json={"video_id": "not-a-valid-id!!"})
    assert r.status_code == 422
    after = len(client.get("/jobs").json()["jobs"])
    assert after == before  # no job was created


def test_missing_input_rejected(client: TestClient):
    r = client.post("/transcribe", json={})
    assert r.status_code == 422


def test_pipeline_error_becomes_error_status(client: TestClient, monkeypatch):
    def boom(raw: str, cfg: Config) -> TranscriptState:
        raise PipelineError("download failed")

    monkeypatch.setattr(srv, "run_one", boom)
    job_id = client.post("/transcribe", json={"video_id": SEED_A}).json()["job_id"]
    job = _poll(client, job_id, "done")  # returns early on "error" too
    assert job["status"] == "error"
    assert "download failed" in job["error"]


def test_artifact_before_done_is_409(client: TestClient, monkeypatch, tmp_path: Path):
    release = threading.Event()

    def gated(raw: str, cfg: Config) -> TranscriptState:
        release.wait(timeout=5)
        return _fake_state(SEED_A, tmp_path / "runs" / f"gated-{SEED_A}")

    monkeypatch.setattr(srv, "run_one", gated)
    job_id = client.post("/transcribe", json={"video_id": SEED_A}).json()["job_id"]
    _poll(client, job_id, "running")

    early = client.get(f"/jobs/{job_id}/transcript.md")
    assert early.status_code == 409  # still running, not done

    release.set()
    _poll(client, job_id, "done")
    assert client.get(f"/jobs/{job_id}/transcript.md").status_code == 200


def test_unknown_job_and_ext_are_404(client: TestClient):
    assert client.get("/jobs/does-not-exist").status_code == 404
    assert client.get("/jobs/does-not-exist/transcript.md").status_code == 404
    # A valid, done job but an unknown extension.
    assert client.get("/jobs/whatever/transcript.txt").status_code == 404
