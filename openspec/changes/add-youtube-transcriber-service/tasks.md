# Tasks: add-youtube-transcriber-service

## Gate (amends add-youtube-transcriber, 2026-07-23)

This change reopens the following items of the original Inception gate:

- Item (3) *CLI-only, no CI, no server* → a REST server **and** a CI image
  publish (GHCR) are now in scope.
- Item (6) *no Docker in v1* → a Dockerfile + microVM deployment are in scope.

All other original gate decisions stand (local ASR, distil-large-v3 int8
default, `runs/` gitignored, zero LLM tokens).

**Sign-off:** owner approved and directed Construction 2026-07-24. Three
decisions taken at raise time: (1) full openspec change; (2) generic
`infra/firecracker/`; (3) weights baked into the rootfs.

## Bolt 1 — REST service

- [x] `server/__init__.py` + `server/app.py` (FastAPI, lifespan warms the model
      via `transcribe.load_model`, calls `ytdlp.ensure_available`).
- [x] Async job queue: `asyncio.Queue` + one background worker running
      `run_one` via `asyncio.to_thread`; in-memory job registry.
- [x] Endpoints: `POST /transcribe`, `GET /jobs/{id}`,
      `GET /jobs/{id}/transcript.{md,srt,json}`, `GET /healthz`.
- [x] Every request input validated through `resolve.parse_video_ref` before it
      reaches `run_one`.
- [x] `pyproject.toml`: add `fastapi`, `uvicorn[standard]`; add a `server`
      package to `[tool.setuptools] packages`.

## Bolt 2 — container

- [x] `Dockerfile` at the agent root (mirrors `agents/job-pilot/Dockerfile`):
      slim base, `apt-get install ffmpeg`, `pip install .`, bake
      distil-large-v3 int8 weights, `CMD uvicorn`.

## Bolt 2b — CI image publish (added 2026-07-24, owner request)

- [x] `.github/workflows/youtube-transcriber-image.yml` — tests on every push
      touching the agent; on `main`, build and push
      `ghcr.io/senthilsweb/youtube-transcriber` (buildx, amd64-only, gha cache
      for the weights layer). GHCR auth via the built-in `GITHUB_TOKEN`; no
      custom build secret. Mirrors `job-pilot-image.yml` / `job-scout-image.yml`.
      This further amends the original gate's "no CI" item (item 3).

## Bolt 3 — generic Firecracker tooling

- [x] `infra/firecracker/README.md` — Ubuntu 24.04 host recipe.
- [x] `install-firecracker.sh`, `setup-net.sh`, `build-rootfs.sh`,
      `vm-config.json.tmpl`, `boot.sh` — all agent-agnostic, parameterized.

## Bolt 4 — tests + docs

- [x] `tests/test_server.py` — FastAPI `TestClient`, `run_one` stubbed, no
      network/model: job lifecycle (queued→running→done), bad-id rejection,
      artifact 404-before-done. Existing tests stay green (90 total).
- [x] Update root `AGENTS.md` youtube-transcriber entry: note the service, the
      microVM deployment, the CI image, and the gate amendment.

## Verification

- [x] `pytest tests/test_server.py -v` green; full suite still green (90 passed).
- [x] Shell scripts pass `bash -n`; `vm-config.json.tmpl` renders to valid JSON.
- [ ] Local `uvicorn server.app:app --port 8000`: `POST /transcribe` for
      `EQuCyrwyfXU`, poll to `done`, fetch `transcript.md`; confirm one model
      load at startup, resident across requests. **(pending Ubuntu VM)**
- [ ] `docker build` + `docker run -p 8000:8000`: repeat the e2e; confirm **no
      weight download** at startup (baked). **(pending Ubuntu VM)**
- [ ] microVM: `infra/firecracker/` scripts in order, hit `/healthz` and repeat
      the e2e against the VM; confirm `runs/` stays inside the VM. **(pending
      Ubuntu VM)**
- [x] Governance: `.openspec.yaml` moved `proposed → implemented`; note records
      Construction complete and what `verified` awaits on the host.
