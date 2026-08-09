# Design: add-cmg-local-deploy

## Architecture

```
                         ~/opt/cmg/orchestrator (Claude Agent SDK, venv)
                         main agent ── Task ──► transcriber subagent
                              │                   │ start_transcription(url) ──► POST :8001/transcribe
                              │                   │ wait_for_job(job_id)     ──► GET  :8001/jobs/{id} (internal 10s poll)
                              │
                              └───── Task ──► stats subagent
                                                │ extract_stats(video_id) ──► docker run --rm talk-value-stats extract.py
                                                │ build_site()            ──► docker run --rm talk-value-stats build.py

~/opt/cmg/youtube-transcriber        ~/opt/cmg/talk-value-stats
  docker-compose.yml (GHCR image)      .env (ANTHROPIC_API_KEY, MODEL_STATS_EXTRACTOR)
  8001:8000, restart unless-stopped    run-extract.sh / run-build.sh (manual wrappers)
  ./runs  ──► /app/runs   ────────────► mounted :ro at /data/runs (TRANSCRIBER_RUNS)
  ./cache ──► /app/.cache               dist/  (site copied out of the container)
```

The **filesystem is the A2A data plane** (transcripts flow through the shared
`runs/` mount); the **orchestrator is the control plane** (sequences the two
agents, carries only ids and statuses between them).

## Decisions

### D1 — `~/opt/cmg/<agent>` layout; `db.json` bind-mounted from the git working tree

Each deployed agent gets one directory holding its compose/env/state. The
stats container mounts the repo's `agents/talk-value-stats/db.json` directly
(`-v $REPO/agents/talk-value-stats/db.json:/app/db.json`), so upserts land in
the working tree where the Pages commit expects them — no copy-back sync, no
drift. **Constraint:** this file-level bind is safe because `extract.py`
writes in place (`path.write_text`, inode preserved). If extract.py ever moves
to atomic temp+rename, the mount must become a directory mount. (Verified at
extract.py:160 on 2026-08-09.)

### D2 — transcript handoff via shared runs/ mount

`pipeline/config.py` resolves `runs_dir`/`cache_dir` relative to
`AGENT_ROOT` → `/app/runs`, `/app/.cache` in the container. Host binds:
`~/opt/cmg/youtube-transcriber/runs:/app/runs` (and `cache:/app/.cache` so the
opus audio cache survives restarts). The stats container mounts the same host
dir read-only at `/data/runs` with `TRANSCRIBER_RUNS=/data/runs`;
`extract.py` globs `$TRANSCRIBER_RUNS/*-<videoId>/transcript.md` and takes
the latest — so the orchestrator passes only the 11-char video id, never a
path.

### D3 — talk-value-stats ships as a one-shot image, not a service

`extract.py` and `build.py` are stateless batch functions; nothing to keep
warm (unlike the transcriber's resident ~1 GB model). A FastAPI wrapper would
add code, tests, and a *resident* process holding `ANTHROPIC_API_KEY` — all to
reproduce what `docker run --rm --env-file` provides. The key touches the
container only for the seconds an extraction runs. `build.py` calls
`shutil.rmtree(dist)`, so `/app/dist` is **never bind-mounted**; the build
runs inside the container and copies `dist/.` out to `/out` (the mounted
`~/opt/cmg/talk-value-stats/dist`).

### D4 — orchestrator code lives in-repo (`agents/cmg-orchestrator/`), deployment lives in `~/opt/cmg/orchestrator`

Same split as `infra/firecracker/`: versioned tooling in the repo, host state
outside it. Python `claude-agent-sdk`; subagents via `AgentDefinition`; tools
via in-process MCP (`create_sdk_mcp_server`). `wait_for_job` polls **inside
the tool** (10 s interval, 90-min cap) — agent-turn polling would burn tokens
across a ~12-min-per-hour-of-video ASR run. Fallback recorded: if the
installed SDK version does not expose in-process MCP tools to subagents,
collapse to a single agent holding all four tools (functionally identical;
subagent split remains the target shape).

### D5 — GHCR-first images; CI grows multi-arch

Deployment pulls `ghcr.io/senthilsweb/{youtube-transcriber,talk-value-stats}`.
The transcriber workflow's amd64-only restriction existed because the weights
bake must not run under emulation; a **native** arm64 job on the
`ubuntu-24.04-arm` runner removes that objection, and a manifest merge
publishes one multi-arch tag. talk-value-stats is a tiny pure-Python image —
buildx amd64+arm64 under QEMU is fine in one job. Local `docker build` on the
Mac (arm64-native) is the dev fallback while CI hasn't run.

### D6 — ports

Transcriber host port **8001** (container 8000; 8000 is the docs' default and
other agents' examples), static site preview **8080**, no port for the
one-shot stats image. 6006/6007 are taken by Phoenix in the root compose.

## Security baseline

- **Key handling:** `ANTHROPIC_API_KEY` lives only in `~/opt/cmg/*/.env`
  (mode 600, outside the repo); it reaches the stats container via
  `--env-file` for the duration of a run and is never baked into an image,
  never in compose files, never in the repo.
- **Transcript containment:** transcripts are verbatim third-party speech.
  They exist only under `~/opt/cmg/youtube-transcriber/runs/` on the owner's
  machine. The transcriber agent's repo `runs/` stays gitignored; CI and the
  published site never see a transcript — only `db.json`'s extracted numbers
  and short grounded quotes are committed, as today.
- **Orchestrator containment:** strict tool allowlist (`Task` + the four
  `mcp__cmg__*` tools); `Bash`, `Write`, `Edit`, `WebFetch`, `WebSearch`
  disallowed; `permission_mode="default"`. The orchestrator cannot run
  arbitrary commands, cannot edit files, and **cannot commit or push** —
  publishing to Pages is a human-run `git add/commit/push` after eyeballing
  the `db.json` diff.
- **Input boundary:** every video reference still passes through
  `resolve.parse_video_ref` (host allowlist, id regex, query-param strip,
  duration cap) inside the transcriber service — the orchestrator adds no
  bypass. The stats tool accepts only an 11-char video id (validated in the
  tool before the docker command is built; the id is interpolated as a single
  argv token, not shell-parsed).
- **Model resolution:** `MODEL_CMG_ORCHESTRATOR → MODEL → startup error`;
  `MODEL_STATS_EXTRACTOR → MODEL → exit` (existing). No hard-coded defaults.

## Risks

- **YouTube IP blocking:** datacenter IPs are blocked; the Mac's residential
  IP is normally fine. Fallback: mount a cookies file and set
  `YT_COOKIES_FILE=/app/cookies.txt` (never committed).
- **ASR runtime:** ~4.8× realtime on native CPU, slower inside Docker
  Desktop's VM. `wait_for_job` caps at 90 min; `MAX_DURATION_MIN=180` caps
  input length at the resolver.
- **arm64 CI runner availability:** if `ubuntu-24.04-arm` is unavailable on
  the repo's plan, the multi-arch job degrades to amd64-only publishing and
  the Mac keeps using a local arm64 build.
- **GHCR package visibility:** a first-push package is private; flipping
  `talk-value-stats` public is a one-time manual step (a workflow cannot).
- **Concurrency:** the transcriber has one worker; the orchestrator submits
  one video at a time.
