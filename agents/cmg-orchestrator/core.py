"""SDK-free core of the cmg orchestrator: settings, validation, command
builders, and the job-poll loop. orchestrator.py wraps these as Claude Agent
SDK tools; tests exercise this module with no network, no docker, no key."""

from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from pathlib import Path

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

POLL_INTERVAL_S = 10
POLL_TIMEOUT_S = 90 * 60

TERMINAL_STATUSES = {"done", "error"}


class SettingsError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    model: str
    transcriber_url: str
    cmg_root: Path
    repo: Path
    stats_image: str
    # add-object-store-state D5: when the store is configured, state moves
    # via S3/MinIO and the docker commands carry no state mounts. The stats
    # container reads its own OBJECT_STORE_* from its --env-file; the
    # orchestrator holds only this flag, never the credentials.
    object_store: bool = False

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Settings":
        env = os.environ if env is None else env
        # Repo rule: MODEL_<ROLE> -> MODEL -> startup error, no hard-coded model.
        model = env.get("MODEL_CMG_ORCHESTRATOR") or env.get("MODEL")
        if not model:
            raise SettingsError(
                "Set MODEL_CMG_ORCHESTRATOR (or MODEL) — no default model."
            )
        transcriber_url = env.get("TRANSCRIBER_URL")
        if not transcriber_url:
            raise SettingsError("Set TRANSCRIBER_URL, e.g. http://localhost:8001")
        repo = env.get("REPO")
        if not repo:
            raise SettingsError("Set REPO to the ai-agents monorepo path.")
        cmg_root = Path(env.get("CMG_ROOT") or Path.home() / "opt" / "cmg")
        stats_image = env.get(
            "STATS_IMAGE", "ghcr.io/senthilsweb/talk-value-stats:latest"
        )
        return cls(
            model=model,
            transcriber_url=transcriber_url.rstrip("/"),
            cmg_root=cmg_root,
            repo=Path(repo),
            stats_image=stats_image,
            object_store=bool(env.get("OBJECT_STORE_BUCKET", "").strip()),
        )

    @property
    def runs_dir(self) -> Path:
        return self.cmg_root / "youtube-transcriber" / "runs"

    @property
    def stats_env_file(self) -> Path:
        return self.cmg_root / "talk-value-stats" / ".env"

    @property
    def dist_dir(self) -> Path:
        return self.cmg_root / "talk-value-stats" / "dist"

    @property
    def db_json(self) -> Path:
        return self.repo / "agents" / "talk-value-stats" / "db.json"


def validate_video_id(video_id: str) -> str:
    vid = video_id.strip()
    if not VIDEO_ID_RE.match(vid):
        raise ValueError(f"not an 11-char YouTube video id: {video_id!r}")
    return vid


def extract_cmd(s: Settings, video_id: str) -> list[str]:
    """docker argv for a one-shot extract.py run. The id is a single argv
    token — validated first, never shell-interpolated.

    Object-store mode: no state mounts — the container pulls the transcript
    and db.json from S3/MinIO and pushes db.json back (its OBJECT_STORE_*
    comes from the --env-file)."""
    vid = validate_video_id(video_id)
    if s.object_store:
        return [
            "docker", "run", "--rm",
            "--env-file", str(s.stats_env_file),
            s.stats_image,
            "python", "extract.py", vid,
        ]
    return [
        "docker", "run", "--rm",
        "--env-file", str(s.stats_env_file),
        "-v", f"{s.runs_dir}:/data/runs:ro",
        "-e", "TRANSCRIBER_RUNS=/data/runs",
        # File-level bind of the repo's db.json: safe because extract.py
        # writes in place (see add-cmg-local-deploy design.md D1).
        "-v", f"{s.db_json}:/app/db.json",
        s.stats_image,
        "python", "extract.py", vid,
    ]


def build_site_cmd(s: Settings) -> list[str]:
    """docker argv for a one-shot build.py run. build.py rmtree's /app/dist,
    so the host dist/ is mounted at /out and the result is copied out.
    Object-store mode: db.json comes from the store (build.py pulls it);
    the dist copy-out mount remains — it is a local output, not state."""
    cmd = ["docker", "run", "--rm"]
    if s.object_store:
        cmd += ["--env-file", str(s.stats_env_file)]
    else:
        cmd += ["-v", f"{s.db_json}:/app/db.json:ro"]
    cmd += [
        "-v", f"{s.dist_dir}:/out",
        s.stats_image,
        "sh", "-c", "python build.py && rm -rf /out/* && cp -r dist/. /out/",
    ]
    return cmd


def poll_job(
    get_job,
    job_id: str,
    interval_s: float = POLL_INTERVAL_S,
    timeout_s: float = POLL_TIMEOUT_S,
    sleep=time.sleep,
    clock=time.monotonic,
) -> dict:
    """Poll get_job(job_id) -> job dict until a terminal status or timeout.
    Injectable sleep/clock so tests run instantly."""
    deadline = clock() + timeout_s
    while True:
        job = get_job(job_id)
        if job.get("status") in TERMINAL_STATUSES:
            return job
        if clock() >= deadline:
            raise TimeoutError(
                f"job {job_id} still {job.get('status')!r} after {timeout_s:.0f}s"
            )
        sleep(interval_s)


def publish_hint(s: Settings) -> str:
    """The human-run publish command — deliberately NOT a tool (see spec:
    cmg-orchestration 'Publish stays human')."""
    return (
        "To publish to GitHub Pages, review and run:\n"
        f"  cd {s.repo}\n"
        "  git diff agents/talk-value-stats/db.json\n"
        "  git add agents/talk-value-stats/db.json\n"
        '  git commit -m "talk-value-stats: add <title> (<video-id>)"\n'
        "  git push origin main"
    )
