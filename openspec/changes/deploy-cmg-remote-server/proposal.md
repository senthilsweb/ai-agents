# Proposal: re-host the cmg A2A pipeline on the static-IP Mac server

> Status: **PROPOSED** — drafted 2026-08-09. Owner: @senthilsweb.
> Builds on: `add-cmg-local-deploy` (verified 2026-08-09).
> Use case: **The pipeline runs on an always-available box, triggered over SSH — the dev laptop can sleep.**

## Why

`add-cmg-local-deploy` proved the full A2A pipeline (youtube-transcriber
service → talk-value-stats extraction → site build → human-reviewed Pages
publish) end-to-end on the owner's dev laptop. But a laptop deployment dies
with the lid: the owner wants the pipeline on their **other Mac — a local
server with a static IP** — so any machine can trigger a run and the
transcriber's residential egress keeps working.

Cloud alternatives were evaluated and declined (2026-08-09):

- **Anthropic Managed Agents** — its cloud sandbox has no `ffmpeg`, no
  documented way to add system binaries, and no subagent feature; the
  transcription leg cannot run there at all.
- **Claude Code cloud sessions** — technically viable for the stats half
  (repo-native `.claude/agents/`, setup scripts, GitHub flow), but the
  transcriber leg still breaks: YouTube blocks datacenter egress IPs, a
  failure this repo has already recorded live (Firecracker bring-up,
  `add-youtube-transcriber-service`).
- **Split architectures** (transcriber on the server, stats in either cloud
  surface) — workable but adds internet exposure of the transcriber plus
  cloud-side git plumbing for zero functional gain over one server.

Re-hosting everything on the server is the smallest change that gets an
always-on pipeline: **no agent code changes at all** — the multi-arch GHCR
images and `infra/cmg/` tooling from `add-cmg-local-deploy` deploy as-is.

## What changes

1. **One hardening edit** — `infra/cmg/youtube-transcriber.compose.yml`
   publishes `8001:8000` on all interfaces today. On a machine with a public
   static IP that would expose an **unauthenticated** transcription service
   (CPU DoS + transcript exfiltration surface) to the internet. The template
   changes to `127.0.0.1:8001:8000`: the orchestrator is always co-located,
   and the remote trigger is SSH, so nothing needs the port off-box. The
   already-installed compose on the dev laptop gets the same edit.

2. **A remote-deployment runbook** — a "Deploying to a remote Mac server"
   section in `infra/cmg/README.md`: Homebrew prereqs (colima, docker,
   docker-compose, gh), compose-plugin registration, `brew services start
   colima` for reboot persistence, repo clone + `gh auth` for the db.json
   publish, then the existing `install.sh` flow unchanged, and an SSH-alias
   trigger from any other machine.

3. **The deployment itself** — executed on the server per the runbook
   (tasks.md is the checklist), verified by the same E2E used for
   `add-cmg-local-deploy` plus two server-specific checks: port 8001 is
   unreachable from outside the box, and the pipeline survives a reboot
   unattended.

## Impact

- Changed (at execution time, not in this authoring): `infra/cmg/
  youtube-transcriber.compose.yml` (one line), `infra/cmg/README.md`
  (runbook section). **No agent code, no images, no workflows change.**
- New capability spec: none — an existing verified capability is re-hosted;
  the port-bind hardening is recorded as design decision D1.
- One-time manual prerequisite: flip `ghcr.io/senthilsweb/talk-value-stats`
  to public (or `docker login ghcr.io` on the server with a `gh` token).
- Privacy/security: improved. Transcripts now live only on the server
  (still never committed); the service port becomes loopback-only; API keys
  exist in chmod-600 `.env` files on one more host — same posture as the
  laptop, and the publish flow keeps its human-review gate (`gh auth` on the
  server, push after eyeballing the diff).
- The laptop deployment keeps working; the two hosts share `db.json` through
  git (upserts are keyed by `videoId`, so even a crossed re-extraction
  converges — pull before committing to avoid rebases).
