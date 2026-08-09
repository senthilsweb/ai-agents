"""S3/MinIO state I/O for talk-value-stats (add-object-store-state).

When OBJECT_STORE_* is configured, this agent needs no filesystem coupling
to the transcriber and no bind mounts: transcripts are resolved from
`youtube-transcriber/runs/<stamp>-<videoId>/transcript.md` in the bucket
(latest run wins — key order is chronological because the run-dir name
starts with a UTC timestamp), and `talk-value-stats/db.json` is pulled
before an upsert and pushed after. Without the env, every call is a no-op
and the agent behaves exactly as before.

CLI (used by infra/cmg/sync-db.sh to refresh the git working-tree copy for
the human publish):

    python objstore.py pull-db [path]     # store → local (default db.json)
    python objstore.py push-db [path]     # local → store

Endpoint quirk (verified 2026-08-09): the owner's S3 API answers on the
`minio-console.` hostname; `minio.` is the web console. Don't "fix" the env.
"""

from __future__ import annotations

import os
import re
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB_KEY = "talk-value-stats/db.json"
RUNS_PREFIX = "youtube-transcriber/runs/"

_client = None


def configured() -> bool:
    return bool(os.getenv("OBJECT_STORE_BUCKET", "").strip())


def bucket() -> str:
    return os.environ["OBJECT_STORE_BUCKET"].strip()


def client():
    global _client
    if _client is None:
        try:
            import boto3
            from botocore.config import Config as BotoConfig
        except ImportError as exc:  # pragma: no cover
            sys.exit(
                "OBJECT_STORE_* is configured but boto3 is not installed — "
                "pip install -e . (boto3 is a dependency)"
            )
        path_style = os.getenv("OBJECT_STORE_FORCE_PATH_STYLE", "").strip().lower() in {
            "1", "true", "yes", "on",
        }
        _client = boto3.client(
            "s3",
            endpoint_url=os.getenv("OBJECT_STORE_ENDPOINT", "").strip() or None,
            region_name=os.getenv("OBJECT_STORE_REGION", "us-east-1").strip(),
            aws_access_key_id=os.getenv("OBJECT_STORE_ACCESS_KEY_ID", ""),
            aws_secret_access_key=os.getenv("OBJECT_STORE_SECRET_ACCESS_KEY", ""),
            config=BotoConfig(
                s3={"addressing_style": "path" if path_style else "auto"}
            ),
        )
    return _client


def pull_db(path: Path, s3=None) -> bool:
    """Store → local. Returns True if the store copy existed.

    Streams and writes in place rather than download_file: boto3's
    temp-file-then-rename cannot rename onto a bind-mounted destination
    (EBUSY), and sync-db.sh points this at exactly such a mount. db.json is
    KBs, so no multipart transfer is being given up."""
    s3 = s3 or client()
    try:
        body = s3.get_object(Bucket=bucket(), Key=DB_KEY)["Body"].read()
    except Exception as exc:
        if _is_missing(exc):
            return False
        raise
    path.write_bytes(body)
    return True


def push_db(path: Path, s3=None) -> None:
    (s3 or client()).upload_file(str(path), bucket(), DB_KEY)


def find_transcript_s3(video_id: str, s3=None) -> Path | None:
    """Latest `<stamp>-<video_id>/transcript.md` under the runs prefix,
    downloaded to a temp file. None if the store has no run for this id."""
    s3 = s3 or client()
    pattern = re.compile(
        rf"^{re.escape(RUNS_PREFIX)}[^/]*-{re.escape(video_id)}/transcript\.md$"
    )
    keys: list[str] = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket(), Prefix=RUNS_PREFIX):
        keys.extend(
            o["Key"] for o in page.get("Contents", []) if pattern.match(o["Key"])
        )
    if not keys:
        return None
    latest = sorted(keys)[-1]
    dest = Path(tempfile.mkdtemp(prefix="tvs-")) / "transcript.md"
    s3.download_file(bucket(), latest, str(dest))
    print(f"Fetched s3://{bucket()}/{latest}")
    return dest


def _is_missing(exc: Exception) -> bool:
    code = getattr(exc, "response", {}).get("Error", {}).get("Code", "")
    return code in {"404", "NoSuchKey", "NotFound"}


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in {"pull-db", "push-db"}:
        sys.exit("usage: python objstore.py pull-db|push-db [path]")
    if not configured():
        sys.exit("OBJECT_STORE_BUCKET is not set")
    path = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "db.json"
    if sys.argv[1] == "pull-db":
        found = pull_db(path)
        print(f"{'✓ pulled' if found else '– no store copy of'} {DB_KEY} → {path}")
    else:
        push_db(path)
        print(f"✓ pushed {path} → {DB_KEY}")


if __name__ == "__main__":
    main()
