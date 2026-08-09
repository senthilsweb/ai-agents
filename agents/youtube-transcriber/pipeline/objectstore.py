"""Optional S3/MinIO mirror of run artifacts.

Active only when OBJECT_STORE_* env is configured; otherwise the pipeline is
byte-for-byte unchanged. Keys mirror the run-dir naming
(`youtube-transcriber/runs/<UTCstamp>-<videoId>/<artifact>`), which is built
from the validated video id and a timestamp only — the path-safety argument
in outputs.py carries over. boto3 lives in the `objectstore` extra; a
configured store without boto3 installed is a hard, actionable error.

Endpoint quirk (verified 2026-08-09): the owner's S3 API answers on the
`minio-console.` hostname; the `minio.` hostname is the web console. Do not
"correct" the env value. See openspec/changes/add-object-store-state/.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

KEY_PREFIX = "youtube-transcriber/runs"


@dataclass(frozen=True)
class ObjectStoreConfig:
    bucket: str
    endpoint: str
    region: str
    access_key_id: str
    secret_access_key: str
    force_path_style: bool

    @classmethod
    def from_env(cls, env=None) -> "ObjectStoreConfig | None":
        env = os.environ if env is None else env
        bucket = env.get("OBJECT_STORE_BUCKET", "").strip()
        if not bucket:
            return None
        return cls(
            bucket=bucket,
            endpoint=env.get("OBJECT_STORE_ENDPOINT", "").strip(),
            region=env.get("OBJECT_STORE_REGION", "us-east-1").strip(),
            access_key_id=env.get("OBJECT_STORE_ACCESS_KEY_ID", ""),
            secret_access_key=env.get("OBJECT_STORE_SECRET_ACCESS_KEY", ""),
            force_path_style=env.get("OBJECT_STORE_FORCE_PATH_STYLE", "")
            .strip()
            .lower()
            in {"1", "true", "yes", "on"},
        )


def make_client(store: ObjectStoreConfig):
    try:
        import boto3
        from botocore.config import Config as BotoConfig
    except ImportError as exc:  # pragma: no cover - exercised only without extra
        raise RuntimeError(
            "OBJECT_STORE_* is configured but boto3 is not installed — "
            "install the agent with the [objectstore] extra"
        ) from exc
    return boto3.client(
        "s3",
        endpoint_url=store.endpoint or None,
        region_name=store.region,
        aws_access_key_id=store.access_key_id,
        aws_secret_access_key=store.secret_access_key,
        config=BotoConfig(
            s3={"addressing_style": "path" if store.force_path_style else "auto"}
        ),
    )


def upload_run_dir(run_dir: Path, store: ObjectStoreConfig, client=None) -> list[str]:
    """Upload every file in the run dir; returns the object keys written."""
    client = client or make_client(store)
    keys: list[str] = []
    for path in sorted(run_dir.iterdir()):
        if not path.is_file():
            continue
        key = f"{KEY_PREFIX}/{run_dir.name}/{path.name}"
        client.upload_file(str(path), store.bucket, key)
        keys.append(key)
    log.info("mirrored %d artifact(s) to s3://%s/%s/%s/",
             len(keys), store.bucket, KEY_PREFIX, run_dir.name)
    return keys
