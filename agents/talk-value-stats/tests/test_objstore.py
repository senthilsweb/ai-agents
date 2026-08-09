"""objstore tests — no network, no boto3 client construction, no key."""

from pathlib import Path

import pytest

import extract
import objstore

ENV = {
    "OBJECT_STORE_BUCKET": "ai-agents",
    "OBJECT_STORE_ENDPOINT": "https://example.test",
    "OBJECT_STORE_ACCESS_KEY_ID": "k",
    "OBJECT_STORE_SECRET_ACCESS_KEY": "s",
    "OBJECT_STORE_FORCE_PATH_STYLE": "true",
}

VID = "dQw4w9WgXcQ"


class FakeS3:
    """Just enough of the boto3 client surface for objstore."""

    def __init__(self, keys=(), db_exists=True):
        self.keys = list(keys)
        self.db_exists = db_exists
        self.downloads: list[str] = []
        self.uploads: list[tuple[str, str]] = []

    def get_paginator(self, _op):
        keys = self.keys

        class P:
            def paginate(self, Bucket, Prefix):
                yield {"Contents": [{"Key": k} for k in keys if k.startswith(Prefix)]}

        return P()

    def download_file(self, _bucket, key, dest):
        self.downloads.append(key)
        Path(dest).write_text(f"content of {key}")

    def get_object(self, Bucket, Key):
        import io

        if Key == objstore.DB_KEY and not self.db_exists:
            raise _missing_error()
        self.downloads.append(Key)
        return {"Body": io.BytesIO(f"content of {Key}".encode())}

    def upload_file(self, src, _bucket, key):
        self.uploads.append((src, key))


def _missing_error():
    exc = Exception("missing")
    exc.response = {"Error": {"Code": "404"}}
    return exc


@pytest.fixture
def s3env(monkeypatch):
    for k, v in ENV.items():
        monkeypatch.setenv(k, v)


def test_unconfigured_is_inert(monkeypatch):
    monkeypatch.delenv("OBJECT_STORE_BUCKET", raising=False)
    assert objstore.configured() is False


def test_find_transcript_s3_latest_run_wins(s3env):
    fake = FakeS3(keys=[
        f"{objstore.RUNS_PREFIX}20260801T000000Z-{VID}/transcript.md",
        f"{objstore.RUNS_PREFIX}20260809T120000Z-{VID}/transcript.md",
        f"{objstore.RUNS_PREFIX}20260805T000000Z-OTHERvideo1/transcript.md",
        f"{objstore.RUNS_PREFIX}20260805T000000Z-{VID}/metrics.json",
    ])
    path = objstore.find_transcript_s3(VID, s3=fake)
    assert path is not None and path.read_text().endswith(
        f"20260809T120000Z-{VID}/transcript.md"
    )


def test_find_transcript_s3_none_for_unknown_id(s3env):
    assert objstore.find_transcript_s3("aaaaaaaaaaa", s3=FakeS3()) is None


def test_pull_db_missing_store_copy_is_false(s3env, tmp_path):
    dest = tmp_path / "db.json"
    assert objstore.pull_db(dest, s3=FakeS3(db_exists=False)) is False
    assert not dest.exists()


def test_pull_and_push_db(s3env, tmp_path):
    dest = tmp_path / "db.json"
    fake = FakeS3()
    assert objstore.pull_db(dest, s3=fake) is True
    objstore.push_db(dest, s3=fake)
    assert fake.uploads == [(str(dest), objstore.DB_KEY)]


def test_extract_find_transcript_prefers_s3_then_falls_back(s3env, monkeypatch, tmp_path):
    # S3 hit wins.
    hit = tmp_path / "transcript.md"
    hit.write_text("# t")
    monkeypatch.setattr(objstore, "find_transcript_s3", lambda vid: hit)
    assert extract.find_transcript(VID) == hit

    # S3 miss falls back to the local glob.
    monkeypatch.setattr(objstore, "find_transcript_s3", lambda vid: None)
    runs = tmp_path / "runs"
    (runs / f"20260809T000000Z-{VID}").mkdir(parents=True)
    local = runs / f"20260809T000000Z-{VID}" / "transcript.md"
    local.write_text("# t")
    monkeypatch.setattr(extract, "TRANSCRIBER_RUNS", runs)
    assert extract.find_transcript(VID) == local


def test_filesystem_mode_untouched(monkeypatch, tmp_path):
    monkeypatch.delenv("OBJECT_STORE_BUCKET", raising=False)
    runs = tmp_path / "runs"
    (runs / f"20260809T000000Z-{VID}").mkdir(parents=True)
    local = runs / f"20260809T000000Z-{VID}" / "transcript.md"
    local.write_text("# t")
    monkeypatch.setattr(extract, "TRANSCRIBER_RUNS", runs)
    assert extract.find_transcript(VID) == local
