# Proposal: Store Run Artifacts in S3-Compatible Object Storage for Remote Deployments

> Conforms to [`ai-agents/openspec/adr/0001-shared-agent-runtime-kit.md`](../../../../../openspec/adr/0001-shared-agent-runtime-kit.md).
> Follow-up to [`adopt-shared-kit-and-rebalance`](../archive/adopt-shared-kit-and-rebalance/proposal.md)
> (archived), which introduced the shared `sync_run_to_host` copy-back.

## Why

`sync_run_to_host` (from `shared/lib/run.ts`) copies each run's artifacts
(`cover.png`, `cover-spec.json`, `report.md`, `summary.json`, and phase traces)
from the sandbox to a "host" mirror at `hostWorkspaceRoot()`, which resolves to
`${HOST_REPORT_ROOT}/agent/sandbox/workspace`. That helper was designed for
**local development**, where `HOST_REPORT_ROOT` defaults to the developer's own
disk — the mirrored files are immediately visible in
`agent/sandbox/workspace/runs/`.

Deployed on Vercel, the agent's own runtime process has no writable location
under its deployment bundle (`/var/task` is read-only), so `HOST_REPORT_ROOT`
must instead point at `/tmp` (see the deployment fix already applied to this
project's Vercel environment variables). That keeps `create_run` /
`sync_run_to_host` from throwing, but `/tmp` is:

- **Ephemeral** — cleared whenever the Function's execution environment
  recycles; nothing guarantees it survives past the current invocation.
- **Local to the Function instance** — never reachable by the caller. eve's
  session/stream protocol carries only JSON events between the deployed agent
  and a remote caller (browser, `eve dev <url>`, or a raw HTTP client); there is
  no built-in channel for the server to hand back a binary file.

Net effect: a remote deployment can run the full pipeline and *report* that
`cover.png` was generated and validated, but there is no way for the caller to
actually retrieve the image or any other run artifact. This was confirmed
while testing the deployed `linkedin-cover-generator` project — the run
completed successfully and the final message referenced `runs/<id>/cover.png`,
but that file only ever existed inside the sandbox and the Function's `/tmp`.

## What changes

- Add a deterministic **shared-kit tool**,
  `shared/tools/upload_run_to_object_store.ts`, re-exported by this agent as
  `agent/tools/upload_run_to_object_store.ts` — the same
  implement-once-re-export-per-agent pattern already used by
  `sync_run_to_host` and `read_usage`. Every agent in the monorepo gets the
  same upload behavior by adding a one-line re-export; this agent is the
  first adopter. The tool uploads the **entire timestamped run folder**
  (`run-meta.json`, `cover-spec.json`, `cover.png`, `phases/*.json`,
  `report.md`, `summary.json` — every file under `runs/<run-id>/`) to an
  **S3-compatible object store** after `sync_run_to_host`, preserving the
  run's relative folder structure under a `runs/<run-id>/...` key prefix in
  the target bucket.
- Use the AWS SDK v3 S3 client (`@aws-sdk/client-s3`) configured generically
  enough to work against **either real AWS S3 or a self-hosted MinIO
  instance**, since both speak the same S3 API — the only difference is the
  `endpoint` / `forcePathStyle` configuration.
- Call this tool as the final orchestrator step **only when object-store
  credentials are configured**; local dev keeps using the existing
  host-mirror path unchanged, since a developer already has direct filesystem
  access to the synced run folder.
- Include the resulting bucket/prefix (and, when a public base URL is
  configured, direct object URLs) in the final assistant message and in
  `summary.json`, so both interactive (`eve dev <url>`) and programmatic
  (HTTP API) callers know where the full run folder landed.
- Document the object-store connection env vars (endpoint, region, bucket,
  credentials, path-style flag) in the agent README, covering both an AWS S3
  bucket and a MinIO endpoint as example configurations.

## Scope

### In scope
- One new deterministic **shared-kit** tool
  (`shared/tools/upload_run_to_object_store.ts`) that uploads a full run
  folder (all files, recursively) to an S3-compatible bucket — implemented
  once in `shared/`, consumed per agent via a one-line re-export under
  `agent/tools/`. This agent is the first adopter; other agents opt in by
  adding the re-export and the orchestrator step.
- Generic S3-compatible configuration (works with AWS S3 or MinIO — or any
  other S3-compatible provider — via the same env-var contract).
- Wiring it into the orchestrator procedure as a conditional final step.
- README documentation for the object-store connection env vars and the
  remote-retrieval flow.

### Out of scope
- Changing the local-dev host-mirror behavior (`sync_run_to_host` stays as is).
- Building a UI/gallery for browsing past runs.
- Automatic cleanup/expiry/lifecycle policy for uploaded runs (left as a
  bucket-level/lifecycle-rule concern, not something this agent manages).
- Any change to the cover generation pipeline itself (spec authoring, prompt
  building, image generation, validation).
- Vercel Blob, or any other non-S3-compatible storage backend.

## Design principle

Keep the artifact-retrieval concern a deterministic, environment-gated code
tool — no LLM involvement, and no change to the single bounded creative pass
that already exists for `cover-spec.json`. Because run folders and
`sync_run_to_host` are shared-kit concepts common to every agent, the upload
tool is shared-kit code too (ADR 0001): one implementation in `shared/`,
per-agent adoption via re-export, never a per-agent fork. Local development and remote
deployments diverge only in *where* the run folder ends up (developer disk vs.
a durable object-store bucket); the orchestrator procedure and cover
generation logic are otherwise identical in both environments. The upload
targets the S3 API surface generically so the same code and env-var contract
works unchanged against AWS S3, MinIO, or any other S3-compatible provider —
no provider-specific SDK or lock-in.
