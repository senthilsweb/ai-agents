# cmg-orchestrator

The A2A layer of the `~/opt/cmg` local deployment: a small Python
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/python) app where
one natural-language prompt drives the whole pipeline —

```
"transcribe <any YouTube url or 11-char id> and add it to talk-value-stats"
```

— through two locally *deployed* agents:

1. a `transcriber` subagent calling the youtube-transcriber REST service
   (`$TRANSCRIBER_URL`, Docker, resident ASR model), and
2. a `stats` subagent invoking one-shot `talk-value-stats` containers
   (extract → `db.json` upsert in the git working tree → site rebuild).

Fully parameterized: nothing video-specific is hard-coded anywhere. The
transcript itself never crosses the agent boundary — it flows through the
shared `~/opt/cmg/youtube-transcriber/runs/` mount; agents exchange only ids
and statuses.

## Architecture

```mermaid
flowchart TB
    subgraph host["Mac (~/opt/cmg — 'claude managed agents, local')"]
        subgraph orch["orchestrator/  (Claude Agent SDK, venv)"]
            MAIN["main agent<br/><i>sequences the pipeline</i>"]
            TSUB["transcriber subagent"]
            SSUB["stats subagent"]
            MAIN -- "Task: transcribe &lt;url&gt;" --> TSUB
            MAIN -- "Task: stats for &lt;video_id&gt;" --> SSUB
        end
        subgraph svc["youtube-transcriber/  (long-running container :8001)"]
            API["FastAPI + resident<br/>distil-large-v3 (local ASR)"]
        end
        subgraph oneshot["talk-value-stats  (one-shot containers)"]
            EX["extract.py<br/><i>the only GenAI call (Opus)</i>"]
            BS["build.py → site"]
        end
        RUNS[("runs/&lt;stamp&gt;-&lt;id&gt;/<br/>transcript.md")]
        DIST[("dist/ static site")]
    end
    DB[("repo db.json<br/><i>git working tree</i>")]
    YT["YouTube"]
    PAGES["GitHub Pages<br/>/ai-native-numbers/"]

    TSUB -- "POST /transcribe<br/>GET /jobs/{id} (poll in-tool)" --> API
    API -- "yt-dlp (allowlisted hosts)" --> YT
    API -- writes --> RUNS
    SSUB -- "docker run --rm" --> EX
    SSUB -- "docker run --rm" --> BS
    RUNS -- ":ro mount (TRANSCRIBER_RUNS)" --> EX
    EX -- "upsert by videoId" --> DB
    DB -- ":ro mount" --> BS
    BS -- "copy-out to /out" --> DIST
    DB -. "human-run git push<br/>(never a tool)" .-> PAGES
```

Only the 11-char `video_id` crosses the agent boundary — the transcript
itself moves through the shared `runs/` mount (the filesystem is the A2A
data plane; the orchestrator is the control plane).

```mermaid
sequenceDiagram
    actor U as owner
    participant M as main agent (Sonnet)
    participant T as transcriber subagent
    participant S as stats subagent
    participant Y as transcriber service :8001
    participant C as talk-value-stats container

    U->>M: "transcribe <url> and add it to talk-value-stats"
    M->>T: Task(transcribe <url>)
    T->>Y: start_transcription(url)
    Y-->>T: job_id (202)
    T->>Y: wait_for_job(job_id) — polls 10s in-tool, 0 tokens while ASR runs
    Y-->>T: done + video_id + word count
    T-->>M: video_id, status
    M->>S: Task(stats for video_id)
    S->>C: extract_stats(video_id) — docker run, Opus extraction
    C-->>S: upserted db.json (examples/metrics)
    S->>C: build_site() — docker run, copy-out dist/
    C-->>S: site rebuilt
    S-->>M: summary
    M-->>U: report + printed git publish command (human runs it)
```

## Design (see `openspec/changes/add-cmg-local-deploy/`)

- `core.py` — SDK-free: settings, 11-char id validation, the exact
  `docker run` argv builders, the in-tool poll loop (10 s / 90 min). This is
  the source of truth for the commands; `infra/cmg/run-*.sh` mirror them.
- `orchestrator.py` — SDK wiring: four in-process MCP tools
  (`start_transcription`, `wait_for_job`, `extract_stats`, `build_site`), two
  `AgentDefinition` subagents, strict tool allowlist (`Task` + the four
  tools; `Bash`/`Write`/`Edit`/web disallowed), and the CLI entry point.
- **Publish stays human**: the run ends by printing the
  `git add db.json … push` command; the orchestrator cannot execute git.
- Polling happens *inside* `wait_for_job` — the model consumes no tokens
  while ASR runs.

## Config (env, loaded from `~/opt/cmg/orchestrator/.env` by `run.sh`)

| var | meaning |
|---|---|
| `MODEL_CMG_ORCHESTRATOR` → `MODEL` → error | orchestrator model (repo rule: no default) |
| `ANTHROPIC_API_KEY` | for the SDK |
| `TRANSCRIBER_URL` | e.g. `http://localhost:8001` |
| `CMG_ROOT` | default `~/opt/cmg` |
| `REPO` | monorepo path (for the `db.json` bind mount) |
| `STATS_IMAGE` | default `ghcr.io/senthilsweb/talk-value-stats:latest` |

## Run

Deployed (normal): `~/opt/cmg/orchestrator/run.sh "transcribe … and add it to talk-value-stats"`

From the repo (dev): `cd agents/cmg-orchestrator && .venv/bin/pip install -e ".[dev]" && .venv/bin/cmg-orchestrator "…"`

Tests (no network, no docker, no key, no SDK import):
`.venv/bin/python -m pytest -q`

Prerequisites: Docker (the deployed services/images), Node 18+ (the SDK
drives the Claude Code runtime), Python ≥3.10.
