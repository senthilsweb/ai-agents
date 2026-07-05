# LinkedIn Cover Generator Specification (delta)

> Conforms to [`ai-agents/openspec/adr/0001-shared-agent-runtime-kit.md`](../../../../../../openspec/adr/0001-shared-agent-runtime-kit.md).
> This delta adds durable, remotely-retrievable run-folder storage in an
> S3-compatible object store (AWS S3 or MinIO) for deployed environments. The
> cover generation pipeline (spec authoring, prompt building, image
> generation, validation, reporting) is unchanged and out of scope.

## ADDED Requirements

### Requirement: Upload the full run folder to S3-compatible object storage

The system SHALL upload every file in the generated run's folder — not only
the cover image — to an S3-compatible bucket as the final orchestrator step,
when object-store credentials are configured.

- The system SHALL use a deterministic tool (`upload_run_to_object_store`) —
  no LLM call — to perform the upload.
- The tool SHALL read artifacts from the existing host run mirror (the same
  location `sync_run_to_host` writes to), not from the sandbox directly.
- The tool SHALL upload every file found under the run's folder recursively,
  preserving the relative path as the object key under a `runs/<run-id>/`
  prefix in the target bucket.
- The tool SHALL work against any S3-compatible provider — including AWS S3
  and self-hosted MinIO — using the same code path and env-var contract,
  differing only in endpoint/path-style/credential configuration.
- The tool SHALL be a no-op, returning a `skipped` result with a reason, when
  `OBJECT_STORE_BUCKET` is not set in the environment. Local development
  SHALL NOT require any new configuration to keep working exactly as before.
- On success, the tool SHALL return the bucket name, the `runs/<run-id>/`
  prefix, and the list of uploaded file paths and sizes. When
  `OBJECT_STORE_PUBLIC_BASE_URL` is configured, it SHALL also return a public
  URL per uploaded file.

### Requirement: Surface the object-store location to the caller

The system SHALL make the uploaded run folder's location available to both
interactive and programmatic callers.

- The final assistant message SHALL include the bucket and prefix (and any
  public URLs) when the upload tool reports `uploaded` entries.
- `summary.json` SHALL include an `artifacts.objectStore` object (bucket,
  prefix, and the uploaded file list) when any artifact was uploaded, so a
  caller consuming the session via the HTTP API does not need to parse
  free-text output to locate the run folder.
- When the upload tool reports everything `skipped` (object storage not
  configured), the system SHALL report local run paths only, with no
  broken or placeholder location.

## Notes

This delta does not change:
- The single bounded LLM reasoning pass that authors `cover-spec.json`.
- `sync_run_to_host`, `HOST_REPORT_ROOT` resolution, or any other shared-kit
  behavior from `shared/lib/run.ts`.
- Local development's existing host-mirror artifact location.

