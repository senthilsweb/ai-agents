# Proposal: CMG local deploy — an A2A pipeline from YouTube video to published stats page

> Status: **APPROVED** — drafted 2026-08-09. Owner: @senthilsweb.
> Use case: **One prompt, any YouTube link → transcript → talk-value-stats page → GitHub Pages.**

## Why

The owner wants `agents/youtube-transcriber` and `agents/talk-value-stats` to
run as locally *deployed* agents — long-lived, addressable capabilities under
`~/opt/cmg/<agent>` ("claude managed agents, local") — and to drive them with a
single natural-language prompt such as *"transcribe
https://youtu.be/Z47vatpsGPI and add it to talk-value-stats"*, for **any**
video, with an agent-to-agent (A2A) handoff between the two.

Today that flow is four manual steps across two agents (`run.py` →
find the run dir → `extract.py` → `build.py`), and talk-value-stats has no
container at all. Two clarifications shaped the scope:

- Anthropic's **Managed Agents** product is cloud-hosted only — there is no
  local mode, and Anthropic has no "A2A" protocol (that name belongs to
  Google's interop protocol). So `~/opt/cmg/` is **our own** local deployment
  convention, and the A2A layer is the **Claude Agent SDK**: one orchestrator
  agent delegating to a `transcriber` subagent and a `stats` subagent.
- Deployment pulls **CI-published GHCR images**, not ad-hoc local builds. CI
  currently publishes `ghcr.io/senthilsweb/youtube-transcriber` as
  **linux/amd64 only** (the Firecracker target); the deployment host here is
  an **arm64 Mac**, where an amd64 image would run CPU ASR under emulation.
  CI therefore grows multi-arch, and talk-value-stats gets its first image.

The example video id above is exactly that — an example. Every part of the
pipeline is parameterized by URL/id at invocation time; nothing video-specific
is hard-coded anywhere.

## What changes

1. **`agents/talk-value-stats/Dockerfile`** (new) — minimal one-shot image
   (`python:3.12-slim`, `pip install .`, no CMD, no secrets baked). The image
   is invoked per-call (`docker run --rm --env-file …`) for `extract.py` and
   `build.py`; there is deliberately **no server**: both are stateless batch
   functions with nothing to keep warm, and a resident container would hold
   `ANTHROPIC_API_KEY` for no benefit.

2. **CI image publishing** — a new
   `.github/workflows/talk-value-stats-image.yml` (same shape as the other
   `*-image.yml`: tests on every push touching the agent, GHCR push on main)
   publishing `ghcr.io/senthilsweb/talk-value-stats` for amd64+arm64; and
   `.github/workflows/youtube-transcriber-image.yml` extended to **multi-arch**
   with a native arm64 build on the `ubuntu-24.04-arm` runner (native, so the
   ~1 GB weights bake never runs under emulation — the reason it was
   amd64-only).

3. **`agents/cmg-orchestrator/`** (new) — the A2A layer, a small Python
   `claude-agent-sdk` app. A main agent with two `AgentDefinition` subagents;
   all real capability lives in four in-process MCP tools
   (`@tool` + `create_sdk_mcp_server`): `start_transcription(url)` and
   `wait_for_job(job_id)` call the deployed transcriber's REST API
   (`$TRANSCRIBER_URL`); `extract_stats(video_id)` and `build_site()` invoke
   the talk-value-stats image one-shot. The agent's tool surface is a strict
   allowlist (`Task` + the four tools); `Bash`, file-edit, and web tools are
   disallowed. Model resolves `MODEL_CMG_ORCHESTRATOR → MODEL → error`
   (repo rule). **Publishing is not a tool** — the orchestrator ends by
   printing the exact `git add/commit/push` for the human to run.

4. **`infra/cmg/`** (new, top-level, mirrors the `infra/firecracker/`
   precedent for generic host tooling) — `install.sh` builds the
   `~/opt/cmg/{youtube-transcriber,talk-value-stats,orchestrator}` tree from
   committed templates: a compose file for the transcriber service (GHCR
   image, host port 8001, `runs/` + `cache/` bind mounts), `.env.example`
   files, `run-extract.sh`/`run-build.sh` manual wrappers, and the
   orchestrator venv + `run.sh`.

## Impact

- New: `agents/talk-value-stats/Dockerfile`, `agents/cmg-orchestrator/`,
  `infra/cmg/`, `.github/workflows/talk-value-stats-image.yml`, two new
  capability specs (`cmg-orchestration`, `talk-value-stats-container`).
  Updated: `.github/workflows/youtube-transcriber-image.yml` (multi-arch),
  root `AGENTS.md` (cmg-orchestrator entry).
- Unchanged: **both existing agents' code.** The transcriber's
  pipeline/server/Dockerfile are untouched (its image is reused as-is);
  talk-value-stats' `extract.py`/`build.py`/`schema.py` are untouched — the
  container wraps them. The Firecracker path is unaffected (amd64 images keep
  publishing).
- The transcript handoff is the **filesystem**: the transcriber container
  writes `/app/runs` to `~/opt/cmg/youtube-transcriber/runs/`; the stats
  container mounts that read-only with `TRANSCRIBER_RUNS=/data/runs`. The two
  services never talk to each other directly; the orchestrator sequences them.
- `db.json` is bind-mounted **from the git working tree** into the stats
  container, so an upsert lands exactly where the Pages publish flow
  (`git add agents/talk-value-stats/db.json` → push → the unified
  `job-scout-docs.yml` deploy) expects it. Safe because `extract.py` writes
  in place; recorded as a constraint in design.md.
- Privacy/legal: unchanged and reinforced. Transcripts (verbatim third-party
  speech) stay under `~/opt/cmg/` on the owner's machine — never committed,
  never uploaded; only `db.json`'s extracted stats + short grounded quotes are
  published, same as today. The orchestrator cannot commit anything.
- New prerequisites (deployment host only): Docker Desktop, Node 18+ (the
  Claude Agent SDK drives the Claude Code runtime), Python ≥3.10,
  `ANTHROPIC_API_KEY` for the extractor and the orchestrator.
