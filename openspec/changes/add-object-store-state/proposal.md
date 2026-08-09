# Proposal: object-store (MinIO/S3) results and state for the cmg pipeline

> Status: **APPROVED** — drafted 2026-08-09, owner directed same-session ("automode").
> Builds on: `add-cmg-local-deploy` (verified 2026-08-09).
> Use case: **Transcripts and db.json flow through the owner's MinIO instead of bind mounts.**

## Why

The cmg A2A pipeline hands data between agents through the filesystem: the
transcriber writes `runs/` to a host directory, the stats container mounts it
read-only, and the repo's `db.json` is file-bind-mounted into the stats
container. The owner judges the mounts a poor coupling ("IMHO not a good
option") — they pin both containers to one host, make the pending remote
deployment (`deploy-cmg-remote-server`) host-bound, and the db.json file-bind
is already flagged fragile in `add-cmg-local-deploy` design D1 (safe only
while `extract.py` writes in place).

The owner runs a **MinIO** deployment (local, publicly reachable, S3 API at
`https://minio-console.nathansweb.com` — hostname says console but it IS the
S3 API; verified live 2026-08-09 with a signed ListObjects against the
existing `ai-agents` bucket). Storing results/state there decouples the two
agents completely: any host that can reach MinIO can run either agent, no
shared disk, no mounts carrying state.

## What changes

1. **youtube-transcriber uploads run artifacts** — a new `pipeline/
   objectstore.py` and an `upload_artifacts` graph node after
   `write_outputs`, active only when `OBJECT_STORE_*` env is configured.
   Uploads the four artifacts to
   `s3://$OBJECT_STORE_BUCKET/youtube-transcriber/runs/<run-dir-name>/`.
   Local `runs/` keeps being written (it is the working dir and the CLI
   contract); the upload is additive. No LLM enters the pipeline; `boto3`
   arrives as an optional `objectstore` extra, installed in the Docker image.

2. **talk-value-stats reads and writes through the store** — a new
   `objstore.py`: when `OBJECT_STORE_*` is configured, `find_transcript`
   resolves a video id by listing `youtube-transcriber/runs/*-<id>/
   transcript.md` in the bucket (latest run wins, mirroring the local glob)
   and downloading to a temp file; `extract.py` pulls
   `talk-value-stats/db.json` from the bucket before the upsert and pushes
   it back after, so the container needs **no mounts at all** for state.
   `build.py` likewise pulls db.json when configured. A small CLI
   (`python objstore.py pull-db|push-db [path]`) syncs the store copy with
   the repo working-tree copy for the human git publish.

3. **Orchestrator drops the state mounts in S3 mode** — `core.py` gains an
   object-store flag (from the orchestrator env): `extract_cmd` loses the
   `runs/` and `db.json` mounts and the `TRANSCRIBER_RUNS` override;
   `build_site_cmd` loses the db mount (the `dist/` copy-out mount remains —
   that is a local output artifact, not state). The stats container gets its
   `OBJECT_STORE_*` values via its own `--env-file`, exactly like the API
   key: **env/secrets instead of mounts**, as the owner specified.

4. **infra/cmg follows** — `.env.example`s gain the `OBJECT_STORE_*`
   variables (placeholders in the repo; real values only in the installed
   chmod-600 `.env`s), a `sync-db.sh` publish helper wraps `pull-db` into
   the repo working tree, and the README documents the mode. Filesystem
   mode stays the default when `OBJECT_STORE_*` is absent — fully
   backwards compatible; the laptop deployment keeps working unchanged
   until its `.env`s opt in.

## Impact

- New: `agents/youtube-transcriber/pipeline/objectstore.py` (+ node in
  `graph.py`, fields in `config.py`, `objectstore` extra in `pyproject.toml`,
  one Dockerfile line), `agents/talk-value-stats/objstore.py` (+ hooks in
  `extract.py`/`build.py`, `boto3` dep), orchestrator `core.py` argv shaping,
  `infra/cmg/sync-db.sh`, env examples, tests in all three agents.
- Unchanged: ASR, extraction logic, scoring of nothing (no numbers move),
  the site generator, all CI workflows' shape (images rebuild on push as
  usual), the publish-stays-human convention.
- Env contract (owner-specified names): `OBJECT_STORE_BUCKET`,
  `OBJECT_STORE_REGION`, `OBJECT_STORE_ACCESS_KEY_ID`,
  `OBJECT_STORE_SECRET_ACCESS_KEY`, `OBJECT_STORE_ENDPOINT`,
  `OBJECT_STORE_FORCE_PATH_STYLE`.
- Security: credentials live only in the installed `.env`s (600, outside the
  repo) — the repo carries placeholders. The shared credentials are the MinIO
  **root** user on a publicly reachable endpoint: design.md recommends a
  scoped service user + rotation (recorded, not blocking). Transcripts gain a
  second resting place (the owner's own MinIO) — same custody, still never
  in git; the bucket already hosts other agent state (`runs/`, `results/`
  prefixes from another project), so pipeline keys are namespaced under
  `youtube-transcriber/` and `talk-value-stats/`.
