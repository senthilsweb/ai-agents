---
title: Upload Results to Object Store
description: Persist every run folder to S3-compatible object storage (AWS S3 or MinIO) — configuration, verification, and failure semantics.
order: 3
updated: 2026-07-05
---

# Upload Results to Object Store

On a deployed environment (Vercel), the run folder only ever exists in the
sandbox and the Function's ephemeral `/tmp` — a remote caller can never
retrieve `cover.png`. The shared-kit tool `upload_run_to_object_store`
(re-exported at `agent/tools/upload_run_to_object_store.ts`) closes that
gap: as the final orchestrator step it uploads the **entire**
`runs/<run-id>/` folder to an S3-compatible bucket.

**It is a no-op unless `OBJECT_STORE_BUCKET` is set.** Local dev needs no
configuration and keeps working off the host mirror.

## Configuration

```dotenv
# AWS S3
OBJECT_STORE_BUCKET=my-agent-runs
OBJECT_STORE_REGION=us-east-1
OBJECT_STORE_ACCESS_KEY_ID=...
OBJECT_STORE_SECRET_ACCESS_KEY=...

# MinIO — same code path; only endpoint + path style differ
OBJECT_STORE_ENDPOINT=https://minio.example.com
OBJECT_STORE_FORCE_PATH_STYLE=true

# Optional: public bucket/CDN → publicUrl computed per uploaded file
# OBJECT_STORE_PUBLIC_BASE_URL=https://cdn.example.com
```

> **Endpoint gotchas (learned the hard way):**
> - Use the **S3 API** endpoint, not the MinIO console UI URL — and never
>   include a path like `/login`. The SDK appends bucket/key paths to
>   whatever you provide. A quick probe: `curl https://<endpoint>/` should
>   return an XML `<Error>` with `x-amz-*` headers (S3 API), not an HTML
>   login page.
> - Some reverse-proxy setups serve the S3 API on the console hostname with
>   no port — that works fine; just drop any path suffix.
> - MinIO needs `OBJECT_STORE_FORCE_PATH_STYLE=true`.

For a Vercel deployment set the same vars per environment via
`vercel env add`.

## What it does

1. Reads the run folder from the host mirror (`sync_run_to_host` output).
   If the mirror is missing or empty — possible on serverless, where `/tmp`
   may not survive between workflow steps — it **re-syncs from the sandbox**
   first.
2. Uploads every file recursively, keyed `runs/<run-id>/<relative-path>`,
   with content-type inferred per extension.
3. Uploads `summary.json` **last**, patched with an `artifacts.objectStore`
   block (`bucket`, `prefix`, uploaded file list) — so both the local and
   bucket copies record where the run landed. Machine consumers read that
   block instead of parsing the assistant's message.

## Verifying

After a run, three places agree:

- the tool result / final assistant message: bucket, prefix, per-file list;
- `summary.json` → `artifacts.objectStore`;
- the bucket itself: `runs/<run-id>/` should contain `cover.png`,
  `cover-spec.json`, `report.md`, `summary.json`, `run-meta.json`, and
  `phases/*.json` (`aws s3 ls s3://<bucket>/runs/<run-id>/` or the MinIO
  console).

Last verified end-to-end 2026-07-05 against a MinIO deployment: 9 files,
zero failures. With telemetry enabled, each upload also appears as an
`http PUT` span in the trace.

## Failure semantics

- Per-file failures land in the tool result's `failed` array (path +
  error) and are mentioned in the final message — **they never fail the
  run**. There are no retries by design.
- Missing configuration returns `skipped: [{reason: "object store not
  configured"}]` — expected and silent in local dev.
- Credentials are read from env only and never logged.

## Security notes

Prefer a **dedicated, minimally-scoped key** (write-only to this bucket),
and treat `OBJECT_STORE_PUBLIC_BASE_URL` with care — a public bucket
exposes article-derived content. Details in
[Secure the Endpoints](./secure-the-endpoints.md).
