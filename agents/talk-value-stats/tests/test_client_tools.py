"""Driver tool-handler tests — no network, no docker, no key, no session."""

import json
from pathlib import Path

import pytest

import objstore
from client import tools as t

FIXTURE = Path(__file__).parent / "fixtures"
VID = "dQw4w9WgXcQ"

HEADER = (
    f"# A Talk\n\n- Source: https://www.youtube.com/watch?v={VID}\n"
    "- Channel: @test\n- Duration: 00:10:00\n- Language: en\n\n---\n\n"
    "[00:00:01] We saved $60M with the new model.\n"
)

CONTENT = {
    "headline": "Saved $60M",
    "speakers": [{"name": "A. Speaker", "role": None, "company": None,
                  "headshotUrl": None, "profileUrl": None}],
    "examples": [{
        "useCase": "Cost saving", "org": None, "speakerName": "A. Speaker",
        "summary": "Saved money.", "timestampStart": "00:00:01",
        "metrics": [{"category": "cost_savings", "label": "Cost saved",
                     "value": 60000000, "unit": "$", "display": "$60M",
                     "direction": "up", "confidence": "stated",
                     "quote": "We saved $60M with the new model.",
                     "timestamp": "00:00:01"}],
    }],
}


class FakeHTTP:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def post(self, url, **kw):
        self.calls.append(("POST", url, kw))
        return self.responses.pop(0)

    def get(self, url, **kw):
        self.calls.append(("GET", url, kw))
        return self.responses.pop(0)


class Resp:
    def __init__(self, code, payload):
        self.status_code = code
        self.payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self.payload

    def raise_for_status(self):
        assert self.status_code < 400


@pytest.fixture
def state(monkeypatch):
    monkeypatch.setenv("TRANSCRIBER_URL", "http://t.example/")
    monkeypatch.setenv("TRANSCRIBER_API_KEY", "sekret")
    return t.ToolState(http=FakeHTTP([]))


def test_state_carries_api_key(state):
    assert state.headers == {"X-API-Key": "sekret"}
    assert state.base == "http://t.example"


def test_start_transcription(state):
    state.http.responses = [Resp(202, {"job_id": "j1", "status": "queued"})]
    out, err = t.handle_tool_call("start_transcription", {"url": "x"}, state)
    assert not err and "j1" in out and "j1" in state.job_started


def test_check_job_terminal_immediately(state):
    state.http.responses = [Resp(200, {"status": "done", "video_id": VID})]
    out, err = t.handle_tool_call("check_job", {"job_id": "j1"}, state)
    assert not err and json.loads(out)["status"] == "done"


def test_check_job_waits_once_then_returns(state, monkeypatch):
    monkeypatch.setattr(t.time, "sleep", lambda s: None)
    state.http.responses = [
        Resp(200, {"status": "running"}), Resp(200, {"status": "done"}),
    ]
    out, err = t.handle_tool_call("check_job", {"job_id": "j1"}, state)
    assert not err and json.loads(out)["status"] == "done"


def test_check_job_error_status_is_error(state):
    state.http.responses = [Resp(200, {"status": "error", "error": "blocked"})]
    out, err = t.handle_tool_call("check_job", {"job_id": "j1"}, state)
    assert err and "blocked" in out


def test_fetch_transcript_caches(state, monkeypatch, tmp_path):
    p = tmp_path / "transcript.md"
    p.write_text(HEADER)
    monkeypatch.setattr(objstore, "find_transcript_s3", lambda vid: p)
    out, err = t.handle_tool_call("fetch_transcript", {"video_id": VID}, state)
    assert not err and state.transcripts[VID] == HEADER


def test_fetch_rejects_bad_id(state):
    out, err = t.handle_tool_call("fetch_transcript", {"video_id": "nope"}, state)
    assert err


def test_persist_requires_prior_fetch(state):
    out, err = t.handle_tool_call(
        "persist_page", {"video_id": VID, "content_json": "{}"}, state
    )
    assert err and "fetch_transcript" in out


def test_persist_validation_error_lists_problems(state):
    state.transcripts[VID] = HEADER
    bad = json.dumps({"headline": "x", "speakers": [], "examples": [{"bogus": 1}]})
    out, err = t.handle_tool_call(
        "persist_page", {"video_id": VID, "content_json": bad}, state
    )
    assert err and "validation failed" in out


def test_persist_happy_path(state, monkeypatch, tmp_path):
    state.transcripts[VID] = HEADER
    pulls, pushes = [], []
    monkeypatch.setattr(objstore, "pull_db", lambda p: pulls.append(p) or False)
    monkeypatch.setattr(objstore, "push_db", lambda p: pushes.append(p))
    out, err = t.handle_tool_call(
        "persist_page", {"video_id": VID, "content_json": json.dumps(CONTENT)}, state
    )
    assert not err, out
    assert "1 example(s), 1 metric(s)" in out
    assert pulls and pushes


def test_unknown_tool(state):
    out, err = t.handle_tool_call("nope", {}, state)
    assert err
