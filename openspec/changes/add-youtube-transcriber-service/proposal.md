# Proposal: youtube-transcriber as a Firecracker-microVM REST service

> Status: **PROPOSED** — drafted 2026-07-24. Owner: @senthilsweb.
> Amends: `add-youtube-transcriber` (2026-07-23 gate, items 3 & 6).
> Use case: **Call the transcriber over HTTP, with the model already warm.**

## Why

The `add-youtube-transcriber` change shipped a local CLI: `run.py <video-id>`
runs the LangGraph pipeline once per video. That gate (2026-07-23) explicitly
said *local CLI only — no Docker, no CI, no server*. That was the right call
for a personal reading aid invoked by hand.

The requirement has grown: the owner wants to **call transcription from
elsewhere** (another agent, a script, a browser) without shelling out to
`run.py`, and wants the ~1 GB `distil-large-v3` weights **loaded once and held
resident** rather than paid on every invocation. That is a long-lived service,
not a CLI.

The owner also wants the deployment target to be a **hand-crafted Firecracker
microVM on a plain KVM Linux host** — not Kubernetes, not Kata, not a
third-party sandbox platform (pyro was evaluated and rejected: it is
ephemeral-exec shaped and caps VMs at 2 GB, which fights a resident-model
service). A microVM is just a VM, so it hosts a persistent HTTP service fine.

Nothing about the transcription itself changes. There is still **no LLM, no
token spend, no API key, and no audio leaving the box.** The service is HTTP
plumbing and job orchestration around the existing pipeline.

## What changes

1. **A REST service inside the agent** — `agents/youtube-transcriber/server/`
   (FastAPI). It imports the existing pipeline unchanged: `run_one`, `Config`,
   `resolve.parse_video_ref` (the input-validation boundary),
   `transcribe.load_model` (reused to warm the model at startup). Because a
   60-minute video is ~12 minutes of CPU (realtime factor ~4.8x, measured in
   the original change), the API is **async**: `POST /transcribe` enqueues a
   job and returns an id; the caller polls `GET /jobs/{id}` and fetches the
   artifacts. Transcription runs off the event loop in a bounded worker.

2. **A Dockerfile** at the agent root — same convention as
   `agents/job-pilot/Dockerfile` and `agents/job-scout/Dockerfile`
   (`python:3.12-slim`, `pip install .`), plus `ffmpeg` and the **baked
   weights**. This single image is the artifact the microVM rootfs is built
   from — "bake everything once" so boot is just kernel + disk + serve.

3. **A CI image publish** — `.github/workflows/youtube-transcriber-image.yml`
   runs the tests on every push touching the agent and, on `main`, builds and
   pushes `ghcr.io/senthilsweb/youtube-transcriber` to GHCR (same pattern as
   `job-pilot-image.yml` / `job-scout-image.yml`). Auth is the built-in
   `GITHUB_TOKEN`; no custom secret. This is what makes the image pullable onto
   the deployment host instead of built there.

4. **Generic Firecracker host tooling** — a new top-level `infra/firecracker/`
   (agent-agnostic, parameterized by image/vcpus/mem/ip): install Firecracker
   + a prebuilt guest kernel, set up a tap device + NAT, turn any container
   image into a `rootfs.ext4`, and boot the VM from a templated config. This
   is reusable by any agent in the monorepo, not specific to the transcriber.

## Impact

- New: `agents/youtube-transcriber/server/`, `Dockerfile`, `tests/test_server.py`;
  a new top-level `infra/firecracker/`; a CI workflow
  `.github/workflows/youtube-transcriber-image.yml`; a new capability spec
  `transcript-service`. Updated `pyproject.toml` (fastapi, uvicorn) and the
  root `AGENTS.md` entry (note the gate amendment + the new deployment path).
- Unchanged: `pipeline/*.py` (graph, resolve, audio, ytdlp, transcribe,
  outputs, state, telemetry), `run.py`. The CLI keeps working; the pipeline is
  imported, not modified. Every other agent is untouched.
- Gate items amended: (3) no server / no CI → a REST server **and** a GHCR
  image-publish workflow are now in scope; (6) no Docker → a Dockerfile +
  microVM deployment are now in scope. The other gate decisions (local ASR,
  distil-large-v3 int8 default, runs/ gitignored) stand.
- New external prerequisites for the **deployment host only** (not for
  building or for the CLI): a Linux KVM host with `/dev/kvm`, Firecracker, and
  Docker (to build the rootfs). The dev machine still needs only `ffmpeg` +
  weights, as before.
- Privacy/legal: unchanged and reinforced. Transcripts are third-party
  copyrighted speech. `runs/` stays gitignored and stays inside the VM; the
  service returns a transcript only to the caller that requested it and never
  publishes or commits one.
