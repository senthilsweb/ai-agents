"""API-key middleware tests (deploy-stats-managed-agent)."""

import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr("pipeline.transcribe.load_model", lambda cfg: object())
    monkeypatch.setattr("pipeline.ytdlp.ensure_available", lambda: None)
    import server.app as app_mod
    importlib.reload(app_mod)
    with TestClient(app_mod.app) as c:
        yield c


def test_open_when_key_unset(monkeypatch, client):
    monkeypatch.delenv("TRANSCRIBER_API_KEY", raising=False)
    assert client.get("/jobs").status_code == 200


def test_401_when_key_set_and_missing(monkeypatch, client):
    monkeypatch.setenv("TRANSCRIBER_API_KEY", "sekret")
    assert client.get("/jobs").status_code == 401
    assert client.post("/transcribe", json={"video_id": "dQw4w9WgXcQ"}).status_code == 401


def test_200_with_correct_key(monkeypatch, client):
    monkeypatch.setenv("TRANSCRIBER_API_KEY", "sekret")
    assert client.get("/jobs", headers={"X-API-Key": "sekret"}).status_code == 200
    assert client.get("/jobs", headers={"X-API-Key": "wrong"}).status_code == 401


def test_healthz_always_open(monkeypatch, client):
    monkeypatch.setenv("TRANSCRIBER_API_KEY", "sekret")
    assert client.get("/healthz").status_code == 200
