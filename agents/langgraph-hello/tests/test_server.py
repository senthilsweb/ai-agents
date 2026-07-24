"""HTTP surface. FastAPI TestClient, no network."""

from __future__ import annotations

from fastapi.testclient import TestClient

import server.app as srv


def _client() -> TestClient:
    return TestClient(srv.app)


def test_healthz_ready():
    with _client() as c:
        body = c.get("/healthz").json()
        assert body["ready"] is True
        assert body["graph_compiled"] is True


def test_run_text():
    with _client() as c:
        body = c.post("/run", json={"text": "one two three"}).json()
        assert body["steps"] == ["normalize", "analyze", "probe", "assemble"]
        assert body["stats"]["word_count"] == 3
        assert "3 word(s)" in body["result"]


def test_run_empty():
    with _client() as c:
        body = c.post("/run", json={"text": ""}).json()
        assert body["steps"] == ["normalize", "echo_empty", "probe", "assemble"]
        assert "no input" in body["result"]


def test_whoami_shape():
    with _client() as c:
        env = c.get("/whoami").json()
        for key in ("hostname", "kernel", "machine", "pid"):
            assert key in env
