# Spec: cmg-orchestration

## ADDED Requirements

### Requirement: One prompt drives the full pipeline for any video
The orchestrator SHALL accept a natural-language prompt naming any YouTube
video URL or 11-char id and drive the full pipeline — transcription via the
deployed transcriber service, stats extraction into `db.json`, and a site
rebuild — with no video-specific configuration anywhere. Example ids used
during verification SHALL NOT appear in code, prompts, or templates.

#### Scenario: Arbitrary video
- **WHEN** the orchestrator is invoked with a prompt containing a YouTube link
  it has never seen
- **THEN** the same tool sequence runs (start_transcription → wait_for_job →
  extract_stats → build_site) parameterized only by that link's video id

### Requirement: A2A is subagent delegation over deployed capabilities
The orchestrator SHALL be a Claude Agent SDK application: a main agent that
delegates to a `transcriber` subagent and a `stats` subagent
(`AgentDefinition`), each holding only its own tools. The tools SHALL be
in-process MCP tools; the transcriber tools call the deployed service at
`$TRANSCRIBER_URL`, and the stats tools invoke the talk-value-stats container
one-shot. If the installed SDK cannot expose in-process MCP tools to
subagents, a single-agent fallback holding all four tools IS acceptable and
SHALL be recorded in the README.

#### Scenario: Handoff carries ids, not transcripts
- **WHEN** the transcriber subagent completes and the stats subagent starts
- **THEN** only the video id and job status cross the agent boundary; the
  transcript itself moves via the shared `runs/` mount on the filesystem

### Requirement: Polling happens inside the tool, not across agent turns
`wait_for_job` SHALL poll `GET /jobs/{id}` internally (approximately every
10 s, capped at 90 min) and return once the job reaches `done` or `error`.
The agent SHALL NOT be made to poll turn-by-turn.

#### Scenario: Long ASR run
- **WHEN** a video takes 20 minutes of ASR
- **THEN** exactly one `wait_for_job` tool call spans it, and the model
  consumes no tokens while the tool waits

### Requirement: The orchestrator's authority is a strict allowlist
The orchestrator SHALL run with an explicit tool allowlist (`Task` plus the
four cmg MCP tools) and with `Bash`, `Write`, `Edit`, `WebFetch`, and
`WebSearch` disallowed. It SHALL NOT be able to run arbitrary commands, edit
files, or perform git operations. The model SHALL resolve
`MODEL_CMG_ORCHESTRATOR → MODEL → startup error`.

#### Scenario: Publish stays human
- **WHEN** the pipeline finishes and `db.json` has been updated
- **THEN** the orchestrator prints the exact `git add/commit/push` command for
  the owner to run and does not execute it

### Requirement: Tool inputs are validated before they reach a subprocess
`extract_stats` SHALL accept only a syntactically valid 11-char YouTube video
id and SHALL pass it to the container as a single argv token (no shell string
interpolation). `start_transcription` SHALL rely on the service's
`resolve.parse_video_ref` boundary and surface its 4xx rejections as tool
errors.

#### Scenario: Malformed id
- **WHEN** `extract_stats` is called with a value that is not an 11-char id
- **THEN** the tool returns an error and no docker process is spawned
