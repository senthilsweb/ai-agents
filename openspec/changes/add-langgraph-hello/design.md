# Design: langgraph-hello

## Goal

The smallest honest LangGraph agent that (a) is a real, instructive `StateGraph`
example and (b) is a clean Firecracker microVM smoke test. Everything below
serves "tiny, self-contained, and proves where it runs."

## The graph (`pipeline/graph.py`)

`StateGraph(GraphState)` with five nodes and one conditional edge:

- `normalize` — collapse whitespace, apply the `MAX_INPUT_CHARS` cap.
- `route` (conditional) — `empty` if the normalized text is blank, else `text`.
  This is the one branch, and per ADR 0003 §3 it is justified: empty input
  takes a trivial path, real text takes the analysis path.
- `echo_empty` / `analyze` — the two branches; `analyze` computes word/char
  counts, a reversed string, and a short sha256 checksum.
- `probe` — gathers the environment (see below).
- `assemble` — builds a one-line human result.

Each node returns a full `model_dump()`, mirroring youtube-transcriber, so the
`steps` trace accumulates without per-field reducers. `cfg` is bound into nodes
by closure. The graph is compiled once (at CLI start or in the server lifespan),
never per request.

## State (`pipeline/state.py`)

Pydantic `GraphState`: `text`, `steps` (visit trace), `normalized`, `stats`,
`env`, `result`. Pydantic (not TypedDict) so the input cap and validation live
on the model.

## The probe (`pipeline/probe.py`) — the smoke-test evidence

`gather_env()` returns `hostname`, `kernel` (`platform.uname().release`),
`system`, `machine`, `cpu_count`, `pid`, `uptime_s` (`/proc/uptime`), `ip` (the
route-selected source address, obtained without sending a packet), and
`containerized`. Inside a Firecracker microVM these are the *guest's* values —
a kernel different from the host's, the VM's hostname, and the eth0 IP set from
the kernel `ip=` boot arg — which is exactly how we confirm the microVM booted
and is isolated. On a dev macOS box the Linux-only bits (uptime) are simply
omitted.

## Surfaces

- `run.py` — CLI, prints the state as JSON.
- `server/app.py` — FastAPI. `GET /healthz` (ready + graph compiled), `POST
  /run {text}` (synchronous — the graph does no I/O), `GET /whoami` (the probe
  alone, the endpoint you curl after booting the microVM).

## Container (`Dockerfile`)

`python:3.12-slim` + `pip install .`, `CMD uvicorn`. No `ffmpeg`, no weights, no
secrets — image is ~200 MB, so the `image → rootfs.ext4` step and the boot are
fast. This is the property that makes it a good Firecracker test.

## Deployment / microVM (reuses `infra/firecracker/`, unchanged)

The generic tooling already exists and is agent-agnostic. On a KVM-capable host:

```
docker build -t langgraph-hello .            # or pull the CI image from GHCR
sudo infra/firecracker/build-rootfs.sh langgraph-hello /opt/firecracker/lgh.ext4 1024
sudo ROOTFS=/opt/firecracker/lgh.ext4 infra/firecracker/boot.sh
curl http://172.16.0.2:8000/whoami           # kernel/hostname/ip are the guest's
```

**Host requirement — the open item.** Firecracker needs `/dev/kvm`. The current
host (Hetzner Cloud) is a KVM guest with nested virt off, so it has none. The
microVM boot therefore awaits a bare-metal / nested-virt KVM host; until then
the agent runs as a plain container (identical service).

## CI

`.github/workflows/langgraph-hello-image.yml` — tests on push, GHCR image on
`main` (buildx, amd64, `GITHUB_TOKEN`), same pattern as the other agents. The
pytest `pythonpath=["."]` and (n/a here — no telemetry extra) lessons from
youtube-transcriber's CI are already applied in `pyproject.toml`.

## Non-goals

- No LLM, no async job queue (the graph is instant), no persistence, no auth.
- Not a general code-runner — it processes only text input through a fixed
  graph. A sandboxed code-runner would be a separate, larger change.
