# Tasks: deploy-stats-managed-agent

## Gate

Owner directed spec+build in automode 2026-08-09, choosing service-level
API-key auth and the call topology (public transcriber via
`*.nathansweb.com`). Deployment steps requiring owner action are marked.

## Bolt 1 — transcriber auth

- [x] `server/app.py`: `X-API-Key` middleware, env-gated on
      `TRANSCRIBER_API_KEY` (unset ⇒ open; set ⇒ 401 without the key on
      everything except `GET /healthz`); `secrets.compare_digest`.
- [x] `tests/test_server.py`: open-when-unset, 401/200-when-set, healthz
      always open.
- [x] `infra/cmg/env/youtube-transcriber.env.example`: `TRANSCRIBER_API_KEY`
      entry; rebuild image; set a generated key in the installed `.env`;
      restart; verify 401 without / 200 with the key.

## Bolt 2 — managed-agent control plane (`agents/talk-value-stats/agent/`)

- [x] `environment.yaml` — minimal cloud sandbox, no networking.
- [x] `stats-extractor.agent.yaml` — model `{id, effort}`,
      `agent_toolset_20260401` deny-by-default, four `type: custom` tools
      (`start_transcription`, `check_job`, `fetch_transcript`,
      `persist_page`) with JSON schemas, `system: "@./system_prompt.md"`.
- [x] `system_prompt.md` — trajectory (transcribe → fetch → extract →
      persist → summarize), the extraction contract from
      `prompts/extract.md`, schema-retry behavior, hard rule: report tool
      errors verbatim, never fabricate.

## Bolt 3 — host-side driver (`agents/talk-value-stats/client/`)

- [x] `tools.py` — the four handlers (credential boundary): transcriber
      HTTPS with `X-API-Key`; MinIO via existing `objstore.py`;
      `persist_page` pydantic-validates `ExtractedContent`, builds
      `TranscriptStatsPage` (authoritative `VideoSource` from the
      transcript header via `extract.parse_source`), upserts, pushes
      db.json to the store. All failures → `(message, is_error=True)`.
- [x] `session.py` — sessions.create + event loop with the three
      pii-discovery fixes (stream-before-replay, terminal in both, echo
      `session_thread_id`); driver-side 10 s poll sleep, 90-min cap.
- [x] `run.py` — CLI: `python -m client.run <video-url-or-id>`; loads
      `agent/applied.json`, env from `.env`; documents
      `unset ANTHROPIC_API_KEY`.
- [x] `tests/test_client_tools.py` — handler logic with stubbed HTTP/S3;
      validation-retry path; no network, no key.

## Bolt 4 — apply script

- [x] `agents/talk-value-stats/scripts/apply_stats_agent.sh` — create-or-
      update env + agent via `ant`, write `agent/applied.json` (mirrors
      pii-discovery's `apply_control_plane.sh`).

## Deployment (owner actions marked ✋)

- [x] ✋ `ant auth login` done 2026-08-09 (default workspace).
- [x] `apply_stats_agent.sh` run 2026-08-09 — env_01UVzu6u7j8W4xfqQFqbxme7 +
      agent_011tiYLunn7WqXsCg2bL6iDm v1 (one API fix surfaced: networking
      type `none` doesn't exist; zero-network = `limited` + no hosts).
- [ ] ✋ Cloudflare route `transcriber.nathansweb.com` → the box running the
      transcriber (laptop now; static-IP server per
      `deploy-cmg-remote-server` later). Until it exists, the driver can
      point `TRANSCRIBER_URL` at `http://localhost:8001` for local E2E.
- [x] Driver `.env` written (gitignored, chmod 600), localhost transcriber
      for now.

## Verification

- [x] Auth: 401 without key, 200 with, healthz open — live against the
      deployed container.
- [x] Serverless stats E2E — VERIFIED 2026-08-09, session
      sesn_01PDyQb7EVQHbRGm3kdJyUZ5: agent chose fetch_transcript-first
      (no transcription job), schema-valid persist on the FIRST attempt,
      store db.json updated (extractedBy: tvs-stats-extractor). Parity vs
      container path: 8 examples/15 metrics/1 speaker vs 9/17/2 — slightly
      conservative with defensible editorial calls (unnamed interviewer not
      attributed; non-AI-outcome number excluded).
- [ ] Full E2E once the public route exists: one session from a fresh
      YouTube URL through transcriber → store → extraction → persist.
- [ ] `sync-db.sh` → diff → ✋ owner push → Pages green.
- [ ] Governance: `.openspec.yaml` → `implemented` after construction,
      `verified` after the E2Es above.
