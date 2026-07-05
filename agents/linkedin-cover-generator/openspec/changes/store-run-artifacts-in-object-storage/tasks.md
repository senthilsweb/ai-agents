# Tasks

> Implementation starts in a new session. Order is incremental and verifiable;
> each phase ends in a typecheck + `eve build`.

## Phase 1 — Add the object-store upload tool

- [ ] Add `@aws-sdk/client-s3` to `agents/linkedin-cover-generator/package.json`.
- [ ] Add `agent/tools/upload_run_to_object_store.ts`:
      - Input: `{ run_dir: string }`.
      - Resolves the host run folder via `hostRunDir(runId)`
        (`shared/lib/run.ts`).
      - Walks the folder recursively and uploads every file found, keyed as
        `runs/<runId>/<relative-path>`.
      - No-ops (returns `{ uploaded: [], skipped: [{ reason: "object store not
        configured" }] }`) when `OBJECT_STORE_BUCKET` is unset.
      - Configures the S3 client from `OBJECT_STORE_REGION`,
        `OBJECT_STORE_ACCESS_KEY_ID`, `OBJECT_STORE_SECRET_ACCESS_KEY`, and
        optionally `OBJECT_STORE_ENDPOINT` / `OBJECT_STORE_FORCE_PATH_STYLE`
        (for MinIO).
      - Infers `content-type` per file from its extension.
      - Returns `{ bucket, prefix, uploaded: [{ path, size, publicUrl? }],
        skipped: [] }`; `publicUrl` only when `OBJECT_STORE_PUBLIC_BASE_URL` is
        configured.
- [ ] `npm -w linkedin-cover-generator run typecheck` clean.

## Phase 2 — Wire into the orchestrator procedure

- [ ] Update `agent/instructions.md`: add step 11 calling
      `upload_run_to_object_store` after `sync_run_to_host`, with guidance to
      surface the bucket/prefix (and any `publicUrl`s) in the final message
      when present, and to say nothing extra when the tool reports everything
      skipped.
- [ ] Extend `shared/lib/summary.ts` (`buildRunSummary`) with an optional
      `artifacts.objectStore` object (`bucket`, `prefix`, uploaded file
      list) so `summary.json` carries the location without requiring the
      caller to parse the assistant's free-text message.

## Phase 3 — Provision and verify

- [ ] Obtain S3 or MinIO connection details (bucket, region, endpoint if
      MinIO, access key, secret key) and set them as Vercel env vars
      (production, preview, development) via `vercel env add`.
- [ ] Redeploy (`vercel deploy --prod`).
- [ ] Run the same GoRules-article smoke test used to validate the
      `HOST_REPORT_ROOT` fix, confirm the final message and `summary.json`
      both reference the uploaded run folder, and confirm the files actually
      landed in the bucket (`aws s3 ls s3://<bucket>/runs/<run-id>/` or the
      MinIO console/`mc ls`).
- [ ] Confirm local dev (`npx eve dev`) is unaffected:
      `upload_run_to_object_store` reports `skipped` (no bucket configured
      locally) and the existing host-mirror path still works exactly as
      before.

## Phase 4 — Documentation

- [ ] Update `README.md`: document the `@aws-sdk/client-s3` dependency, the
      `OBJECT_STORE_*` env-var contract (with one example configuration for
      AWS S3 and one for MinIO), that it's a no-op without
      `OBJECT_STORE_BUCKET`, and how to find an uploaded run's files from a
      remote/deployed run (both from the final assistant message and from
      `summary.json`).

## Verification (Definition of Done)

- [ ] A remote deployment (`eve dev <url>` or a raw HTTP session) results in
      the full timestamped run folder landing in the configured bucket, with
      zero manual steps beyond setting the `OBJECT_STORE_*` env vars once.
- [ ] The same code and env-var contract works against both AWS S3 and MinIO.
- [ ] Local dev behavior and artifacts are unchanged.
- [ ] `eve build` and `npx tsgo` both clean.

