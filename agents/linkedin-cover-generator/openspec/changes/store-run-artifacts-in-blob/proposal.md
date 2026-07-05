# Proposal: Store Run Artifacts in Vercel Blob for Remote Deployments

> Conforms to [`ai-agents/openspec/adr/0001-shared-agent-runtime-kit.md`](../../../../../openspec/adr/0001-shared-agent-runtime-kit.md).
> Follow-up to [`adopt-shared-kit-and-rebalance`](../archive/adopt-shared-kit-and-rebalance/proposal.md)
> (archived), which introduced the shared `sync_run_to_host` copy-back.

## Why

`sync_run_to_host` (from `shared/lib/run.ts`) copies each run's artifacts
(`cover.png`, `cover-spec.json`, `report.md`, `summary.json`) from the sandbox
to a "host" mirror at `hostWorkspaceRoot()`, which resolves to
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
actually retrieve the image. This was confirmed while testing the deployed
`linkedin-cover-generator` project — the run completed successfully and the
final message referenced `runs/<id>/cover.png`, but that file only ever existed
inside the sandbox and the Function's `/tmp`.

## What changes

- Add a deterministic tool, `upload_run_artifacts`, that uploads the run's
  binary/text artifacts (`cover.png` at minimum; optionally `cover-spec.json`,
  `report.md`, `summary.json`) to **Vercel Blob** after `sync_run_to_host`, and
  returns public (or signed) URLs.
- Call this tool as the final orchestrator step **only when running on
  Vercel** (i.e. `BLOB_READ_WRITE_TOKEN` is configured); local dev keeps using
  the existing host-mirror path unchanged, since a developer already has direct
  filesystem access to the synced run folder.
- Include the returned URL(s) in the final assistant message and in
  `summary.json`, so both interactive (`eve dev <url>`) and programmatic
  (HTTP API) callers can retrieve the cover image from a remote deployment.
- Document the Blob store setup (project-level `BLOB_READ_WRITE_TOKEN`,
  provisioned automatically once a Blob store is attached to the Vercel
  project) in the agent README.

## Scope

### In scope
- One new deterministic tool for uploading run artifacts to Vercel Blob.
- Wiring it into the orchestrator procedure as a conditional final step.
- README documentation for the Blob store dependency and the remote-retrieval
  flow.

### Out of scope
- Changing the local-dev host-mirror behavior (`sync_run_to_host` stays as is).
- Building a UI/gallery for browsing past runs.
- Automatic cleanup/expiry policy for uploaded blobs (left as a manual/Vercel
  dashboard concern for now).
- Any change to the cover generation pipeline itself (spec authoring, prompt
  building, image generation, validation).

## Design principle

Keep the artifact-retrieval concern a deterministic, environment-gated code
tool — no LLM involvement, and no change to the single bounded creative pass
that already exists for `cover-spec.json`. Local development and Vercel
deployments diverge only in *where* the final artifact ends up (developer disk
vs. a durable, publicly reachable URL); the orchestrator procedure and cover
generation logic are otherwise identical in both environments.
