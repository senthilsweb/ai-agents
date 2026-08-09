# Proposal: talk-value-stats as a Claude Managed Agent (serverless), transcriber authenticated and public

> Status: **APPROVED** — drafted 2026-08-09, owner directed spec+build in automode.
> Builds on: `add-object-store-state` (implemented 2026-08-09), `add-cmg-local-deploy` (verified).
> Use case: **The stats/orchestration half runs on Anthropic's serverless infra; the transcriber stays on owner hardware behind `*.nathansweb.com`.**

## Why

Moving pipeline state into MinIO (`add-object-store-state`) was done precisely
to make the agents host-independent. The owner now wants the half that *can*
run serverlessly — orchestration + stats extraction — deployed as a **Claude
Managed Agent**, while `youtube-transcriber` stays on owner hardware (settled
earlier: no ffmpeg/apt in the managed sandbox, YouTube blocks datacenter
egress, 15-min CPU ASR fits serverless badly) and becomes reachable through
the owner's existing public `*.nathansweb.com` front (Cloudflare), same as
MinIO already is.

The owner's `agent-pii-discovery` repo is a working Managed Agents deployment
on this same platform; this change deliberately mirrors its proven control
plane (`ant` CLI + YAML definitions + `applied.json` registry + host-side
custom tools as the credential boundary) and its recorded gotchas.

## What changes

1. **Transcriber API-key auth** — `server/app.py` gains an `X-API-Key`
   middleware, env-gated on `TRANSCRIBER_API_KEY`: unset ⇒ open (local
   deployments unchanged); set ⇒ every endpoint except `GET /healthz`
   requires the key. This is the mandatory precondition for exposing the
   service publicly (today it is unauthenticated: job submission is CPU
   DoS, artifact endpoints are transcript exfiltration). Public DNS/tunnel
   (`transcriber.nathansweb.com` or similar) is owner-side Cloudflare
   config, out of repo scope but in the runbook.

2. **A Managed Agent for stats** — control plane as YAML under
   `agents/talk-value-stats/agent/` (mirroring pii-discovery):
   `environment.yaml` (minimal sandbox), `stats-extractor.agent.yaml`
   (single agent — Managed Agents has no subagent feature; the
   single-agent shape is our documented fallback), `system_prompt.md`.
   The agent performs extraction with **its own inference** (it *is* the
   model — no in-sandbox `anthropic` client, no API key anywhere in the
   sandbox), returning `ExtractedContent` JSON through a custom tool.

3. **A thin host-side session driver** — `agents/talk-value-stats/client/`
   (`run.py`, `session.py`, `tools.py`), the credential boundary exactly as
   pii-discovery's ADR 0003 prescribes: the four custom-tool handlers run
   host-side holding the secrets — `start_transcription`/`check_job`
   (HTTPS + `X-API-Key` to the public transcriber), `fetch_transcript`
   (MinIO read), `persist_page` (schema-validate with pydantic, upsert,
   MinIO write of `db.json`). Validation failures return `is_error=true`
   so the agent retries until the JSON passes — the schema is the gate,
   replacing `messages.parse`'s structured-output guarantee.

4. **Apply script + registry** — `scripts/apply_stats_agent.sh` (create-or-
   update via `ant beta:environments|beta:agents`, writes
   `agent/applied.json`), following `apply_control_plane.sh`.

## Impact

- New: `agents/talk-value-stats/agent/`, `agents/talk-value-stats/client/`,
  `agents/talk-value-stats/scripts/apply_stats_agent.sh`, auth middleware +
  tests in `agents/youtube-transcriber/server/`, env-example entries.
- Unchanged: `extract.py` CLI (both extraction paths coexist — container/CLI
  and managed-agent), the pipeline, publish flow (`sync-db.sh` → human git
  push → Pages), the cmg local deployment.
- Secrets: **nothing new enters the sandbox.** `TRANSCRIBER_API_KEY`,
  `OBJECT_STORE_*`, and the Anthropic auth (the `ant` OAuth profile) all
  live host-side with the driver. Known gotcha honored: `ANTHROPIC_API_KEY`
  in env outranks the OAuth profile and 404s cross-workspace — the driver
  documents `unset ANTHROPIC_API_KEY`.
- Prerequisites: `ant auth login` (owner, one-time, interactive);
  owner-side Cloudflare route for the transcriber; the transcriber deployed
  where that route points (laptop today, static-IP server per
  `deploy-cmg-remote-server` when executed).
