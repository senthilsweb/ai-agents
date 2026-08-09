# Design: add-object-store-state

## Data flow (S3 mode)

```
transcriber container                          MinIO  s3://ai-agents/
  write_outputs → runs/<stamp>-<id>/…   ┌────►   youtube-transcriber/runs/<stamp>-<id>/
  upload_artifacts (new node) ──────────┘            transcript.{json,md,srt}, metrics.json
                                                 talk-value-stats/db.json
stats container (no state mounts)        ▲   │
  extract.py: pull db.json ──────────────┼───┘
              list+download transcript ──┘
              upsert → push db.json ─────►
  build.py:   pull db.json ──────────────┘   (dist/ still copies out via /out — output, not state)

publish (human, repo checkout):  sync-db.sh → objstore.py pull-db → git diff/commit/push
```

## Decisions

### D1 — additive upload, filesystem stays the source layout

The transcriber keeps writing `runs/` locally (CLI contract, server artifact
endpoints, zero behavior change when the env is absent). `upload_artifacts`
is a separate graph node after `write_outputs` with a conditional edge
(configured → upload → END; else → END), mirroring the existing
audio-cache conditional. Upload failure marks the run's metrics with
`upload_error` but does not fail the run — the transcript exists locally;
losing the mirror is a warning, not a loss. (Env-gated behavior over new
CLI flags; same pattern as telemetry.)

### D2 — object keys mirror the run-dir naming

`youtube-transcriber/runs/<run_dir_name>/<artifact>` where `run_dir_name`
is the existing `<UTCstamp>-<videoId>` (built from validated id + clock
only — the path-safety argument in `outputs.py` carries over verbatim).
The stats agent's S3 resolution lists prefix `youtube-transcriber/runs/`,
filters `*-<videoId>/transcript.md`, sorts by key (timestamp prefix ⇒
lexicographic = chronological), takes the last — behavior-identical to the
local glob. `talk-value-stats/db.json` is a single well-known key.

### D3 — db.json: store copy is authoritative in S3 mode, git copy is the publish gate

In S3 mode `extract.py` pulls the store copy, upserts, pushes back; the
container touches no mount. The **git working-tree copy remains the only
path to Pages** — `infra/cmg/sync-db.sh` (wrapping `objstore.py pull-db`)
refreshes it, then the human reviews and pushes as ever. This removes the
in-place-write fragility flagged in add-cmg-local-deploy D1: no file-bind,
so extract.py's write style no longer matters to anyone.
Divergence rule: the store copy wins at sync time; git history is the
audit trail of what was actually published.

### D4 — boto3, config, and the endpoint quirk

One tiny client wrapper per agent (no shared package — the agents stay
independently deployable; the wrapper is ~40 lines). Config from the
owner-specified env names; `OBJECT_STORE_FORCE_PATH_STYLE=true` maps to
`s3={'addressing_style': 'path'}` (MinIO requirement). Verified live
2026-08-09: the S3 API answers at `https://minio-console.nathansweb.com`
(the `minio.` hostname is the web console — the names are swapped; the
runbooks say so explicitly so nobody "fixes" the env var into breakage).
boto3 is an optional extra for the transcriber (kept out of minimal CLI
installs; the Dockerfile installs `.[objectstore]`) and a plain dependency
for talk-value-stats (its image is small).

### D5 — orchestrator shapes argv by one boolean

`Settings.object_store` = `OBJECT_STORE_BUCKET` present in the
orchestrator's env. True ⇒ `extract_cmd`/`build_site_cmd` emit no state
mounts; the stats container reads its own `OBJECT_STORE_*` from its
`--env-file`. The orchestrator itself never holds the store credentials —
only the flag. Filesystem mode remains the default and the fallback.

## Security baseline

- **Secrets:** `OBJECT_STORE_*` values live in the installed chmod-600
  `.env`s beside `ANTHROPIC_API_KEY`; the repo carries `.env.example`
  placeholders only. The credentials were shared by the owner in-session;
  they are the MinIO **root** user on a public endpoint — recommendation
  (recorded, non-blocking): create a scoped user limited to the
  `ai-agents` bucket and rotate the root password.
- **Transport:** HTTPS end-to-end (Cloudflare-fronted endpoint).
- **Containment:** transcripts move from "one host's disk" to "owner's
  MinIO bucket" — same custody, still never committed to git; the public
  endpoint is credential-gated.
- **Orchestrator authority unchanged:** it gains no new tools; it only
  stops passing mounts.

## Risks

- **Bucket is shared** with another project's prefixes (`runs/`,
  `results/` observed) — our keys are namespaced under agent-name
  prefixes; nothing lists or writes outside them.
- **Upload adds seconds and a failure mode** to transcription — mitigated
  by D1's non-fatal handling.
- **Two db.json copies** (store + git) — D3's sync rule; the human diff
  review before push is unchanged and remains the integrity gate.
- **Cloudflare in front of MinIO** may cap large uploads (transcripts are
  KBs–MBs; irrelevant today, noted for audio if ever added).
