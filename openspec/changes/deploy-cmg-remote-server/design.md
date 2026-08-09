# Design: deploy-cmg-remote-server

## Architecture

Identical to `add-cmg-local-deploy` — one host runs all three components —
with the host swapped and the trigger path made remote:

```
any machine ──ssh──► static-IP Mac server
                       ~/opt/cmg/orchestrator/run.sh "transcribe <url> …"
                          │ (Claude Agent SDK, subagents, 4 MCP tools)
                          ├──► youtube-transcriber container  127.0.0.1:8001
                          │      └─ writes ~/opt/cmg/youtube-transcriber/runs/
                          └──► talk-value-stats one-shot containers
                                 ├─ extract.py ─► ~/work/ai-agents/…/db.json
                                 └─ build.py  ─► ~/opt/cmg/talk-value-stats/dist/
                       git push (human-reviewed) ──► GitHub ──► Pages
```

## Decisions

### D1 — the service binds loopback-only

`ports: ["127.0.0.1:8001:8000"]` in the compose template. Rationale: the
orchestrator is always co-located with the service (the whole point of the
single-host design), and remote invocation rides SSH — no consumer ever
needs 8001 off-box. On a static-IP host the previous all-interfaces bind
would expose an unauthenticated FastAPI (job submission = CPU DoS; artifact
endpoints = transcript exfiltration). If an internet-facing transcriber is
ever actually wanted, that is a separate change: auth middleware + TLS
first (noted in the 2026-08-09 architecture discussion, deliberately not
built here).

### D2 — Colima, with `brew services` for reboot persistence

Same runtime the laptop deployment verified. `brew services start colima`
makes the VM start at boot; the container then self-starts via
`restart: unless-stopped`. Without this the pipeline silently stays down
after a power cycle — treated as a hard verification item (reboot test),
not a footnote.

### D3 — the server publishes db.json itself

`gh auth login` + `gh auth setup-git` on the server; after a run the owner
reviews `git diff agents/talk-value-stats/db.json` **on the server** (over
the same SSH session that triggered the run) and pushes. Keeps the
publish-stays-human convention with no new machinery. The laptop clone
pulls before its next data commit; `videoId`-keyed upserts make crossed
extractions converge rather than duplicate.

### D4 — multi-arch images make the server's CPU flavor irrelevant

`ghcr.io/senthilsweb/youtube-transcriber` publishes amd64+arm64 (native
arm64 CI runner since `add-cmg-local-deploy`), `talk-value-stats` likewise.
Intel or Apple Silicon server both pull native images; no emulated ASR.

## Security baseline

- **Port surface:** 8001 loopback-only (D1); no other port is published.
  Remote access is SSH only — whatever key policy the server already has.
- **Keys:** `ANTHROPIC_API_KEY` in chmod-600 `.env` files under `~/opt/cmg`
  on the server, outside any repo; reaches the extraction container via
  `--env-file` per run; never baked, never committed.
- **Transcripts:** verbatim third-party speech stays in
  `~/opt/cmg/youtube-transcriber/runs/` on the server, gitignored as ever;
  only `db.json`'s extracted numbers + grounded quotes are pushed.
- **Orchestrator authority:** unchanged — strict tool allowlist, no
  Bash/Write/Edit/web, cannot run git; publish requires the human's push.
- **GHCR:** flipping talk-value-stats public exposes only the image (code
  already public in the repo); the alternative keeps it private with a
  scoped token login on the server.

## Risks

- **Reboot dependency chain** (colima service → docker context → container):
  covered by the mandatory reboot verification item.
- **Key sprawl:** a second host now holds the API key; revocation story is
  unchanged (one key, rotate at console).
- **Two writers of db.json:** laptop and server both extract; convergent by
  design (D3) but pulls-before-push is the documented habit.
- **macOS auto-login/energy settings:** a Mac that sleeps or requires login
  before launchd user agents run can still take the pipeline down; the
  runbook tells the owner to set "prevent sleep" — outside this repo's
  control.
