# Tasks: add-object-store-state

## Gate

Owner directed this change in-session 2026-08-09 ("Make this change first in
automode"), supplying the env-var contract and live MinIO credentials.
Construction proceeds immediately after authoring; push to main still waits
for owner confirmation (session convention).

## Bolt 1 — youtube-transcriber upload

- [x] `pipeline/objectstore.py` — env-driven config (`OBJECT_STORE_*`),
      lazy boto3 client, `upload_run_dir(run_dir)` →
      `youtube-transcriber/runs/<run-dir-name>/…`; clear error if configured
      but boto3 missing.
- [x] `pipeline/graph.py` — `upload_artifacts` node + conditional edge after
      `write_outputs`; non-fatal on failure (metrics `upload_error`).
- [x] `pyproject.toml` — `objectstore = ["boto3>=1.34"]` extra;
      `Dockerfile` installs `.[objectstore]`.
- [x] Tests: node skipped when unconfigured; upload called with the right
      keys (stubbed client); failure is non-fatal. Existing 90 stay green.

## Bolt 2 — talk-value-stats store I/O

- [x] `objstore.py` — same env contract; `configured()`, `pull_db(path)`,
      `push_db(path)`, `find_transcript_s3(video_id) -> Path` (list prefix,
      latest `*-<id>/transcript.md`, download to temp); CLI
      `python objstore.py pull-db|push-db [path]`.
- [x] `extract.py` — S3-aware `find_transcript` (explicit path → S3 when
      configured → local glob fallback); pull db before load, push after
      write.
- [x] `build.py` — pull db.json when configured before rendering.
- [x] `pyproject.toml` — add `boto3`; py-modules gain `objstore`.
- [x] Tests: resolution order, latest-run-wins on S3 keys, pull/push around
      upsert, filesystem mode untouched (all with a stubbed client).

## Bolt 3 — orchestrator + infra/cmg

- [x] `agents/cmg-orchestrator/core.py` — `Settings.object_store` (from
      `OBJECT_STORE_BUCKET` presence); S3-mode `extract_cmd`/`build_site_cmd`
      drop the runs/, db.json mounts and `TRANSCRIBER_RUNS`; tests for both
      modes.
- [x] `infra/cmg/env/*.env.example` — `OBJECT_STORE_*` placeholder blocks
      (transcriber, talk-value-stats, orchestrator-flag).
- [x] `infra/cmg/sync-db.sh` — refresh the repo working-tree db.json from
      the store for the human publish; `run-extract.sh`/`run-build.sh` gain
      the mount-free S3 shape (kept in sync with core.py).
- [x] `infra/cmg/README.md` + agent READMEs — document the mode and the
      endpoint-name quirk (console hostname = S3 API, verified).

## Migration (one-time, before the first store-mode extract)

- [x] Seed the store from the repo copy — `docker run … python objstore.py
      push-db /app/db.json` with the repo db.json mounted read-only.
      Without the seed, the first extract would build a one-page db and a
      later sync-db.sh would clobber the repo's talks. (Done 2026-08-09.)

## Verification

- [x] All three test suites green locally (no network, stubbed clients).
- [x] Live store check: signed ListObjects against the `ai-agents` bucket
      (done at design time; re-run at construction end).
- [x] Rebuild both images locally (arm64); update installed `~/opt/cmg`
      `.env`s with the real `OBJECT_STORE_*` values (never committed).
- [x] E2E in S3 mode: one orchestrator prompt with **no state mounts** —
      artifacts appear under `s3://ai-agents/youtube-transcriber/runs/…`,
      `talk-value-stats/db.json` updated in the store, site builds from the
      store copy.
- [x] `sync-db.sh` refreshes the repo db.json — VERIFIED 2026-08-09 after
      fixing a real defect it surfaced: boto3 download_file's
      temp-then-rename cannot land on a bind-mounted file (EBUSY); pull_db
      now streams and writes in place. Diff review + push remain with the
      owner.
- [ ] Governance: `.openspec.yaml` → `implemented` after construction,
      `verified` after the E2E + publish checks.
