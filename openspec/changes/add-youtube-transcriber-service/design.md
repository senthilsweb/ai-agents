# Design: youtube-transcriber REST service on a Firecracker microVM

## Shape

Three layers, each independent:

```
  caller ──HTTP──▶  FastAPI service  ──calls──▶  pipeline.graph.run_one
   (host/            (server/app.py)              (UNCHANGED)
    other agent)      resident model
                      async job queue
        │
        └── runs inside ──▶  Firecracker microVM  (rootfs = the Docker image)
                             built + booted by infra/firecracker/ (generic)
```

The service is a thin adapter. It does not re-implement any pipeline logic; it
adds HTTP, an async job lifecycle, and a warm model. The microVM is just where
the container runs — the same image runs identically under `docker run`.

## Layer 1 — the FastAPI service (`server/app.py`)

### Model stays resident
`lifespan` startup calls `transcribe.load_model(cfg)` once. That function
already caches one model per `(asr_model, compute_type)` in a module-level
dict (`pipeline/transcribe.py:_MODEL_CACHE`), so the first real request finds
the model already loaded — no new caching code, no change to `transcribe.py`.
Startup also calls `ytdlp.ensure_available()` and fails fast if `ffmpeg` or
`yt-dlp` is missing (same check the CLI does).

### Async jobs, not blocking requests
A 60-minute video is ~12 minutes of CPU. A synchronous request would time out
behind any proxy, so:

- `POST /transcribe {url|video_id, model?, language?}` validates the input
  through `resolve.parse_video_ref` (the security boundary — 11-char id regex,
  host allowlist), creates a job, returns `202 {job_id, status:"queued"}`.
- A single background worker (concurrency 1 for v1; CPU-bound work does not
  benefit from more) pulls jobs off an `asyncio.Queue` and runs
  `run_one(raw, cfg)` in a thread (`asyncio.to_thread`) so the event loop stays
  responsive for status polls.
- `GET /jobs/{id}` returns `{status, video_id, error?, result?}` where status
  is `queued | running | done | error`. On `done`, `result` carries the
  metrics and output paths from the returned `TranscriptState`.
- `GET /jobs/{id}/transcript.{md,srt,json}` streams the artifact file from
  `state.run_dir`.
- `GET /healthz` reports `{model_loaded, ready}`.

The job registry is an in-memory dict. For v1 (single VM, single owner) that is
acceptable and is stated as a limitation in the spec — a restart loses job
history, not any written transcript (those are on disk in `runs/`).

### What is reused, verbatim
`pipeline.config.Config`, `pipeline.graph.run_one`,
`pipeline.resolve.parse_video_ref`, `pipeline.transcribe.load_model`,
`pipeline.ytdlp.ensure_available`, `pipeline.state.TranscriptState`,
`pipeline.telemetry`. No new business logic is added to `pipeline/`.

## Layer 2 — the Dockerfile (baked weights)

Mirrors `agents/job-pilot/Dockerfile`: `python:3.12-slim`, copy `pyproject.toml`
+ `pipeline/` + `server/`, `pip install .`. Additions:

- `apt-get install -y --no-install-recommends ffmpeg` — the pipeline shells out
  to it; `yt-dlp` arrives via pip (already a dependency).
- **Bake the weights.** A build step runs
  `python -c "from faster_whisper import WhisperModel; WhisperModel('distil-large-v3', device='cpu', compute_type='int8')"`
  which downloads the ~1 GB weights into the image's HuggingFace cache layer.
  First boot then has zero weight download and no dependency on network reach
  to HuggingFace. Image lands ~2.5 GB.
- `CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8000"]`.

No secrets are baked. ASR is fully local (no API key). Only the optional
telemetry OTLP endpoint arrives as env at run time, matching `.env.example`.

### CI publish
`.github/workflows/youtube-transcriber-image.yml` runs the tests on every push
touching the agent and, on `main`, builds and pushes the image to GHCR
(`ghcr.io/senthilsweb/youtube-transcriber`) via buildx with a `gha` cache so the
1 GB weights layer is not re-downloaded each run. It is amd64-only (the
Firecracker target is x86_64, and the weights bake should not run twice under
arm64 emulation). GHCR auth is the built-in `GITHUB_TOKEN` — there is no custom
build secret, because nothing secret is baked. The host then `docker pull`s the
image and `build-rootfs.sh` turns it into the microVM rootfs, rather than
building on the host.

## Layer 3 — generic Firecracker tooling (`infra/firecracker/`)

There is no existing home for host-provisioning infra: `shared/` is a
TypeScript/npm workspace the Python agents do not use. So a new top-level
`infra/firecracker/`, sibling to the root `docker-compose.yml` and `utils/`, is
the convention-following location. It is **agent-agnostic** — every script is
parameterized by `(image, vcpus, mem_mib, ip)` and knows nothing about the
transcriber. The reference for the known-good networking recipe is pyro's
`deploy/setup-bridge.sh` (evaluated in the conversation that raised this
change).

- `install-firecracker.sh` — preflight `/dev/kvm`; download the Firecracker
  binary from GitHub releases into `/usr/local/bin`; fetch a **prebuilt guest
  `vmlinux`** (no kernel compile).
- `setup-net.sh <tap> <host-ip/cidr> <guest-ip>` — create the tap device,
  enable `ip_forward`, add a NAT MASQUERADE rule out the default-route WAN
  interface. Idempotent.
- `build-rootfs.sh <docker-image> <out.ext4> <size-mb>` — `docker create` +
  `docker export` the image filesystem into an `ext4` file. Generic over any
  image; used here with the transcriber image.
- `vm-config.json.tmpl` + `boot.sh` — render the Firecracker machine config
  (kernel path, rootfs drive, tap network, vcpus, mem, static guest IP on the
  kernel cmdline) and run `firecracker --config-file`. One command to boot.

v1 runs without the jailer (single trusted service, single tenant); this is
documented in the README as a deliberate simplification, with the jailer noted
as the hardening step if the VM ever runs untrusted images.

## Constraints carried from the 2026-07-23 gate (unchanged)

- **Copyright / republication.** Transcripts are verbatim third-party speech
  and the repo is public. `runs/`, `.cache/`, `logs/` stay gitignored; the
  microVM's `runs/` stays inside the VM; the service returns a transcript only
  to the caller that asked for it and never commits or publishes one.
- **No new secrets.** No API key on the ASR path. Telemetry OTLP endpoint is
  optional and env-only.
- **Model default unchanged.** `distil-large-v3` at int8, the value pinned in
  `pipeline/config.py`, is what gets baked.

## Security notes specific to the service

The original security baseline (subprocess argument-lists, path-traversal
safety, host allowlist, size/duration caps, no prompt injection) is inherited
from the pipeline and still holds because the pipeline is unchanged. The
service adds one new surface — the HTTP input — and closes it the same way the
CLI does: **every** request value that could reach a subprocess or a path goes
through `resolve.parse_video_ref` first, so only a validated 11-char id ever
flows into `run_one`. The service binds to the VM's private IP; exposing it
beyond the host is out of scope for v1 and would need auth added first (noted
as a non-goal).

## Verification

See `tasks.md`. Bottom-up: server unit tests (no network/model) → local uvicorn
e2e with the two seed videos → container run (confirm no weight download at
startup) → microVM boot on an Ubuntu 24.04 KVM host.

## Non-goals (v1)

- **Auth / public exposure** — the service binds to the private VM IP; putting
  it on the internet needs an auth layer first.
- **Durable job store** — in-memory registry; a restart loses job history, not
  transcripts.
- **Multi-VM / autoscaling / snapshot pools** — one VM, one worker.
- **The jailer / untrusted images** — v1 runs one trusted image.
- Everything already listed as a non-goal in `add-youtube-transcriber`
  (summarization, diarization, translation, playlist crawling, non-YouTube
  sources, caption fallback) remains out of scope.
