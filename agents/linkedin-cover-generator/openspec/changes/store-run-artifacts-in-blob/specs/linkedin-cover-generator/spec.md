# LinkedIn Cover Generator Specification (delta)

> Conforms to [`ai-agents/openspec/adr/0001-shared-agent-runtime-kit.md`](../../../../../../openspec/adr/0001-shared-agent-runtime-kit.md).
> This delta adds durable, remotely-retrievable artifact storage for Vercel
> deployments. The cover generation pipeline (spec authoring, prompt building,
> image generation, validation, reporting) is unchanged and out of scope.

## ADDED Requirements

### Requirement: Upload run artifacts to durable storage on Vercel

The system SHALL upload the generated cover image (and optionally the other
run artifacts) to Vercel Blob as the final orchestrator step, when running in
an environment with a Blob store configured.

- The system SHALL use a deterministic tool (`upload_run_artifacts`) — no LLM
  call — to perform the upload.
- The tool SHALL read artifacts from the existing host run mirror (the same
  location `sync_run_to_host` writes to), not from the sandbox directly.
- The tool SHALL be a no-op, returning a `skipped` result with a reason, when
  `BLOB_READ_WRITE_TOKEN` is not set in the environment. Local development
  SHALL NOT require any new configuration to keep working exactly as before.
- On success, the tool SHALL return a public (or signed) URL and byte size for
  each uploaded artifact.

### Requirement: Surface the artifact URL to the caller

The system SHALL make the uploaded artifact URL available to both interactive
and programmatic callers.

- The final assistant message SHALL include the returned URL(s) when the
  upload tool reports `uploaded` entries.
- `summary.json` SHALL include an `artifacts.blob` array (URL + size per
  uploaded file) when any artifact was uploaded, so a caller consuming the
  session via the HTTP API does not need to parse free-text output to locate
  the image.
- When the upload tool reports everything `skipped` (no Blob token
  configured), the system SHALL report local run paths only, with no
  broken or placeholder URL.

## Notes

This delta does not change:
- The single bounded LLM reasoning pass that authors `cover-spec.json`.
- `sync_run_to_host`, `HOST_REPORT_ROOT` resolution, or any other shared-kit
  behavior from `shared/lib/run.ts`.
- Local development's existing host-mirror artifact location.
