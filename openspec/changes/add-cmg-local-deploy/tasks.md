# Tasks: add-cmg-local-deploy

## Gate

Owner approved the plan 2026-08-09 (plan review in-session) with three
directions recorded: (1) the pipeline is **parameterized** — any YouTube
URL/id, the Z47vatpsGPI link is only the first verification run; (2) the plan
itself lands as this openspec change; (3) deployment consumes **GHCR-published
CI images**, extending CI to multi-arch rather than defaulting to local
builds.

## Bolt 1 — talk-value-stats container

- [x] `agents/talk-value-stats/Dockerfile` — `python:3.12-slim`, copies
      `pyproject.toml schema.py extract.py build.py export.py prompts/
      templates/`, `pip install .`, no CMD, no secrets baked.
- [x] `.github/workflows/talk-value-stats-image.yml` — tests on every push
      touching the agent; on `main`, buildx amd64+arm64 push of
      `ghcr.io/senthilsweb/talk-value-stats` (GITHUB_TOKEN auth).

## Bolt 2 — transcriber image goes multi-arch

- [x] `.github/workflows/youtube-transcriber-image.yml` — add a native arm64
      image job on `ubuntu-24.04-arm` (weights bake stays native, never
      emulated) and a manifest-merge job publishing one multi-arch `latest`.

## Bolt 3 — cmg-orchestrator (the A2A layer)

- [x] `agents/cmg-orchestrator/pyproject.toml` — `claude-agent-sdk`, `httpx`,
      `python-dotenv`; dev extra `pytest`.
- [x] `agents/cmg-orchestrator/orchestrator.py` — main agent + `transcriber` /
      `stats` subagents; four in-process MCP tools
      (`start_transcription(url)`, `wait_for_job(job_id)` with internal 10 s
      poll + 90 min cap, `extract_stats(video_id)` with 11-char id
      validation, `build_site()`); tool allowlist, no Bash/Write/Edit/web;
      `MODEL_CMG_ORCHESTRATOR → MODEL → error`; prints the publish command at
      the end instead of running it.
- [x] `agents/cmg-orchestrator/tests/test_core.py` — settings/validation/
      command-builder/poll-loop logic with injected fakes; no network, no
      docker, no key, no SDK import. (Renamed from the planned test_tools.py:
      the SDK-free surface lives in core.py.)
- [x] `agents/cmg-orchestrator/README.md`.

## Bolt 4 — infra/cmg host tooling

- [x] `infra/cmg/install.sh` — creates `~/opt/cmg/{youtube-transcriber,
      talk-value-stats,orchestrator}`, copies templates, chmod 600 the .envs,
      builds the orchestrator venv (`pip install -e $REPO/agents/cmg-orchestrator`).
- [x] `infra/cmg/youtube-transcriber.compose.yml` — GHCR image, `8001:8000`,
      `./runs:/app/runs`, `./cache:/app/.cache`, `env_file: .env`,
      `restart: unless-stopped`.
- [x] `infra/cmg/env/*.env.example` — one per component.
- [x] `infra/cmg/run-extract.sh`, `infra/cmg/run-build.sh` — the exact docker
      commands the orchestrator tools run, for manual use/dry-checks.
- [x] Root `AGENTS.md`: add the cmg-orchestrator entry.

## Verification

- [x] Orchestrator unit tests green (`pytest`, no network/docker/key).
- [x] `bash -n` on all infra/cmg scripts; compose file validates
      (`docker compose config`).
- [x] Local arm64 images build on the Mac (dev fallback path).
- [x] `install.sh` produces the tree; transcriber `/healthz` →
      `ready:true, model_loaded:true` on :8001.
- [x] Dry-check: `run-extract.sh` + `run-build.sh` work standalone against an
      existing transcript before the agentic path runs.
- [x] E2E: one prompt with the Z47vatpsGPI link → transcript artifacts under
      `~/opt/cmg/youtube-transcriber/runs/<stamp>-Z47vatpsGPI/`, `db.json`
      upsert in the working tree, site in `~/opt/cmg/talk-value-stats/dist`,
      eyeballed on :8080.
- [ ] Parameterization proof: a second, different video id runs through the
      identical prompt shape (no duplicates in db.json; second page added).
- [ ] CI: both image workflows green on main; multi-arch manifest confirmed
      (`docker manifest inspect` shows amd64 + arm64); talk-value-stats
      package flipped public (manual, one-time).
- [ ] Pages publish: human-run `git add db.json` → push → `job-scout-docs.yml`
      deploys; new page live under `/ai-native-numbers/`.
- [ ] Governance: `.openspec.yaml` → `implemented` after construction,
      `verified` after the E2E + CI + Pages checks above.
