# Tasks

> Implementation starts in a new session. Order is incremental and verifiable;
> each phase ends in a typecheck + `eve build`.

## Phase 1 — Add the Blob upload tool

- [ ] Add `@vercel/blob` to `agents/linkedin-cover-generator/package.json`.
- [ ] Add `agent/tools/upload_run_artifacts.ts`:
      - Input: `{ run_dir: string, files?: string[] }` (`files` default
        `["cover.png"]`).
      - Reads each file from the host run mirror via `shared/lib/run.ts`
        helpers (`hostRunDir`, `readHostRunArtifact` or an equivalent binary
        read).
      - No-ops (returns `{ uploaded: [], skipped: [{ path, reason:
        "BLOB_READ_WRITE_TOKEN not configured" }] }`) when
        `process.env.BLOB_READ_WRITE_TOKEN` is unset.
      - Otherwise uploads via `put("runs/<runId>/<filename>", bytes, { access:
        "public", token })` and returns `{ uploaded: [{ path, url, size }],
        skipped: [] }`.
- [ ] `npm -w linkedin-cover-generator run typecheck` clean.

## Phase 2 — Wire into the orchestrator procedure

- [ ] Update `agent/instructions.md`: add step 11 calling
      `upload_run_artifacts` after `sync_run_to_host`, with guidance to surface
      the returned URL(s) in the final message when present, and to say
      nothing extra when the tool reports everything skipped.
- [ ] Extend `shared/lib/summary.ts` (`buildRunSummary`) with an optional
      `artifacts.blob` array so `summary.json` carries the URL(s) without
      requiring the caller to parse the assistant's free-text message.

## Phase 3 — Provision and verify

- [ ] Attach a Blob store to the `linkedin-cover-generator` Vercel project
      (Storage tab → Create → Blob → Connect to Project), which provisions
      `BLOB_READ_WRITE_TOKEN` automatically for all environments.
- [ ] Redeploy (`vercel deploy --prod`).
- [ ] Run the same GoRules-article smoke test used to validate the
      `HOST_REPORT_ROOT` fix, confirm the final message and `summary.json`
      both include a working Blob URL, and confirm the URL actually serves the
      PNG (`curl -I <url>` → `200`, `content-type: image/png`).
- [ ] Confirm local dev (`npx eve dev`) is unaffected: `upload_run_artifacts`
      reports `skipped` (no token locally) and the existing host-mirror path
      still works exactly as before.

## Phase 4 — Documentation

- [ ] Update `README.md`: document the `@vercel/blob` dependency, that it's a
      no-op without `BLOB_READ_WRITE_TOKEN`, and how to retrieve the cover
      image URL from a remote/deployed run (both from the final assistant
      message and from `summary.json`).

## Verification (Definition of Done)

- [ ] A remote deployment (`eve dev <url>` or a raw HTTP session) can retrieve
      a working image URL for a generated cover, with zero manual steps beyond
      attaching the Blob store once.
- [ ] Local dev behavior and artifacts are unchanged.
- [ ] `eve build` and `npx tsgo` both clean.
