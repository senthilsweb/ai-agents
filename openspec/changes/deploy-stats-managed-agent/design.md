# Design: deploy-stats-managed-agent

## Architecture

```
owner machine (driver, holds ALL secrets)          Anthropic serverless
  client/run.py <video-url-or-id>                    Managed Agent "tvs-stats-extractor"
    └ sessions.create ──────────────────────────────►  (claude model, no sandbox secrets)
        custom-tool round-trips:                        │ 1. start_transcription(url)
  tools.py handlers:                             ◄──────┤ 2. check_job(job_id)   (driver sleeps
    start_transcription → https://transcriber.…         │      between polls; agent re-calls)
      nathansweb.com  X-API-Key: $TRANSCRIBER_API_KEY   │ 3. fetch_transcript(video_id)
    fetch_transcript  → MinIO (boto3, host-side)        │ 4. reads transcript, EXTRACTS with
    persist_page      → pydantic-validate               │      its own inference
      ExtractedContent → upsert → push db.json to MinIO │ 5. persist_page(page_json)
                                                        └ summary → session idle
publish (unchanged): sync-db.sh → git diff → push → Pages
```

## Decisions

### D1 — the managed agent extracts with its own inference

`extract.py` calls `client.messages.parse` because a CLI needs a model;
a Managed Agent *is* the model. The agent reads the transcript (returned by
`fetch_transcript` as tool-result text) and produces `ExtractedContent`
JSON directly, guided by the same `prompts/extract.md` contract (inlined
into `system_prompt.md`). Schema discipline moves from `messages.parse` to
the `persist_page` handler: host-side pydantic validation, `is_error=true`
with the validation errors on failure, so the agent iterates until the
schema passes. The page is stamped `extractedBy: <agent model id>`.
Consequence: no `ANTHROPIC_API_KEY` exists anywhere in this path — no
vault needed at all (pii-discovery provisioned a vault for a sandbox→API
call; we have none).

### D2 — custom tools are the credential boundary (pii-discovery ADR 0003)

S3 SigV4 signing cannot ride vault header-substitution, and the sandbox
must never hold MinIO root creds; the transcriber key likewise stays out.
All four tools execute in the driver on the owner's machine. The sandbox
needs **no networking, no git clone, no bootstrap** — the agent's toolset
is deny-by-default with nothing but the custom tools (a dramatic
simplification vs pii-discovery, possible because D1 removed the only
sandbox-side dependency).

### D3 — polling shape

`check_job` returns the job status once per call; the *driver* sleeps
10 s before answering a repeated `check_job` on a `running` job, so
wall-clock waits cost no tokens beyond one small round-trip per poll and
the session never hangs on a tool. 90-min cap enforced by the driver
(returns `is_error` so the agent reports failure gracefully).

### D4 — control plane mirrors agent-pii-discovery exactly

`ant beta:environments create|update`, `ant beta:agents create|update`
from YAML (model as `{id, effort}` object, `agent_toolset_20260401` with
`default_config.enabled: false`, `type: custom` tools with JSON schemas,
`system: "@./system_prompt.md"` applied from the `agent/` cwd), ids
recorded in `agent/applied.json` by the apply script. Session driver
copies the three encoded bug-fixes from pii-discovery's `session.py`:
stream-before-replay, terminal-detection in both replay and tail,
`session_thread_id` echoed on tool results.

### D5 — transcriber auth is env-gated in the service

`TRANSCRIBER_API_KEY` unset ⇒ middleware inert (local/loopback
deployments unchanged). Set ⇒ `X-API-Key` required on everything except
`GET /healthz` (monitoring stays open; it leaks only readiness). Constant-
time comparison (`secrets.compare_digest`). The public route
(`transcriber.nathansweb.com` → owner's box) is owner-side Cloudflare
config, documented in the runbook, out of repo scope.

## Security baseline

- Sandbox: zero secrets, zero networking, deny-by-default toolset — the
  agent can only talk through the four typed tools.
- Driver: holds `TRANSCRIBER_API_KEY` + `OBJECT_STORE_*` in env/.env
  (chmod 600); authenticates to Anthropic via the `ant` OAuth profile —
  `ANTHROPIC_API_KEY` must stay unset (workspace-404 gotcha, recorded).
- Transcriber: public endpoint requires the API key; `/healthz` open;
  input validation boundary (`parse_video_ref`) unchanged behind it.
- Transcript custody: transcript text transits the session as tool-result
  content (Anthropic session storage) — same custody class as sending it
  to the API for extraction, which `extract.py` already does today.
- Publish unchanged: human reviews the `db.json` diff before Pages.

## Risks

- **Extraction parity**: agent-native extraction may drift from
  `messages.parse` quality; mitigated by the same prompt contract +
  schema-gated retries, and measured at verification by comparing counts
  against the container path on the same transcript.
- **Session cost**: ~$0.08/active-hour + tokens; long ASR waits are
  driver-side sleeps (session idle between polls), not active time.
- **`ant` auth**: one-time interactive `ant auth login` required; nothing
  in this change can run before it.
- **Transcript size**: an 80-min talk ≈ 20k words ≈ ~30k tokens of tool
  result — well within context, but the driver truncates nothing; very
  long inputs raise cost linearly.
