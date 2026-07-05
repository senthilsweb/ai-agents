# Design: Store Run Artifacts in S3-Compatible Object Storage for Remote Deployments

> Conforms to [`ai-agents/openspec/adr/0001-shared-agent-runtime-kit.md`](../../../../../openspec/adr/0001-shared-agent-runtime-kit.md).

## 1. Problem recap

```
Local dev:
  sandbox /workspace/runs/<id>/**
        │  sync_run_to_host (shared/lib/run.ts)
        ▼
  ${HOST_REPORT_ROOT}/agent/sandbox/workspace/runs/<id>/**
        = developer's own disk (HOST_REPORT_ROOT defaults to cwd)
        → immediately viewable, no extra step needed.

Vercel deployment (current state):
  sandbox /workspace/runs/<id>/**
        │  sync_run_to_host
        ▼
  ${HOST_REPORT_ROOT}/agent/sandbox/workspace/runs/<id>/**
        = /tmp/agent/sandbox/workspace/runs/<id>/**
        (HOST_REPORT_ROOT=/tmp, set as a Vercel env var so create_run
        doesn't fail on the read-only /var/task bundle)
        → ephemeral, Function-local, never reaches the caller.
```

The gap is the last hop: from "somewhere on the Function's disk" to a
retrievable location. eve's session/stream protocol only carries JSON events
(`message.*`, `action.*`, `step.*`, …) between server and client — there is no
generic binary-attachment channel in that protocol today.

## 2. Approach

Add a durable-storage hop using an **S3-compatible object store**. The user
will supply connection details for either a real AWS S3 bucket or a
self-hosted MinIO endpoint — both implement the same S3 API, so one client
configuration (`@aws-sdk/client-s3`) covers both, differing only in
`endpoint` / `forcePathStyle` / credentials.

```
sandbox /workspace/runs/<id>/**
     │  sync_run_to_host (unchanged)
     ▼
${HOST_REPORT_ROOT}/.../runs/<id>/**   (local disk OR Function /tmp)
     │  upload_run_to_object_store (NEW, conditional on OBJECT_STORE_* env vars)
     │  recursively uploads every file under runs/<id>/, preserving structure
     ▼
s3://<bucket>/runs/<id>/**             (AWS S3 or MinIO — same code path)
```

Every timestamped run folder (`run-meta.json`, `cover-spec.json`, `cover.png`,
`phases/*.json`, `report.md`, `summary.json`) is uploaded as a unit, not just
the cover image — the whole point is that the bucket becomes the durable,
remotely-reachable copy of what `sync_run_to_host` already assembles locally.

## 3. New shared tool: `upload_run_to_object_store`

The tool is **shared-kit code**, not agent code — run folders,
`hostRunDir`, and `sync_run_to_host` are all shared concepts, so their
durable-upload counterpart lives beside them and is adopted per agent by
re-export (the established `sync_run_to_host` / `read_usage` pattern):

```ts
// shared/tools/upload_run_to_object_store.ts   (single implementation)
inputSchema: z.object({
  run_dir: z.string().describe("The run directory, e.g. runs/2026-07-05T14-26-27Z"),
})
```

```ts
// agent/tools/upload_run_to_object_store.ts    (per-agent adoption, one line)
export { default } from "shared/tools/upload_run_to_object_store.js";
```

Behavior:
- Resolves the host run folder via `hostRunDir(runId)` (`shared/lib/run.ts`) —
  the same location `sync_run_to_host` already wrote to.
- Walks that directory recursively and uploads **every file** it finds, one
  `PutObject` per file, keyed as `runs/<runId>/<relative-path>` in the target
  bucket (so the bucket layout mirrors the local `runs/` layout exactly).
- Skips (returns `{ uploaded: [], skipped: [{ reason: "object store not configured" }] }`)
  when the required env vars are unset, so local dev runs are unaffected and
  nothing errors when object storage isn't configured.
- Infers `content-type` per file from its extension (`image/png` for
  `cover.png`, `application/json` for `*.json`, `text/markdown` for
  `report.md`, else `text/plain`).
- Returns `{ bucket, prefix: "runs/<runId>/", uploaded: [{ path, size }], skipped: [] }`,
  plus a `publicUrl` per file only when `OBJECT_STORE_PUBLIC_BASE_URL` is
  configured (the bucket/CDN is publicly reachable); otherwise callers are
  expected to fetch objects using their own S3 credentials/signing.

This is a **deterministic tool** — no model call, consistent with every other
correctness-critical step in this agent (ADR 0001 §2).

## 4. Connection configuration (generic S3-compatible contract)

| Env var | Required | Notes |
|---|---|---|
| `OBJECT_STORE_BUCKET` | yes | Target bucket name. |
| `OBJECT_STORE_REGION` | yes | e.g. `us-east-1`; MinIO accepts any non-empty value. |
| `OBJECT_STORE_ACCESS_KEY_ID` | yes | |
| `OBJECT_STORE_SECRET_ACCESS_KEY` | yes | |
| `OBJECT_STORE_ENDPOINT` | no | Set for MinIO / any non-AWS S3-compatible endpoint (e.g. `https://minio.internal:9000`); omit for real AWS S3. |
| `OBJECT_STORE_FORCE_PATH_STYLE` | no | `true` for MinIO (path-style addressing); omit/`false` for AWS S3 virtual-hosted-style. |
| `OBJECT_STORE_PUBLIC_BASE_URL` | no | Set when the bucket/CDN is publicly reachable, to compute `publicUrl` per uploaded file. Omit to return bucket/key only. |

The tool treats the whole group as present-or-absent: if
`OBJECT_STORE_BUCKET` is unset, it no-ops regardless of the other vars — this
keeps local dev requiring zero new configuration.

## 5. Orchestrator procedure change

Insert one conditional step after step 10 (`sync_run_to_host`) in
`instructions.md`:

> 11. Call `upload_run_to_object_store` with `{ run_dir }`. If it reports
>     `uploaded` entries, mention the bucket + prefix (and any `publicUrl`s) in
>     the final message alongside the local paths. If it reports everything
>     `skipped` (object storage not configured), omit this and keep reporting
>     local paths only — this is expected and normal for local dev.

`summary.json` gains an optional `artifacts.objectStore` object (`bucket`,
`prefix`, and an array of uploaded file paths/sizes/URLs) via `buildRunSummary`
in `shared/lib/summary.ts`, so programmatic callers hitting
`/eve/v1/session` don't have to scrape the free-text assistant message to find
where the run landed.

## 6. Environment / setup

- New dependency: `@aws-sdk/client-s3` in `shared/package.json` (the tool is
  shared-kit code; agents pick it up through the `shared` workspace package,
  not by declaring the SDK themselves).
- New env vars (see table above) — set via `vercel env add` per environment
  for a Vercel deployment, or in `.env` for local dev (though local dev has no
  need to configure these; the host-mirror path already gives direct disk
  access).
- No change to local `.env.example` defaults — the tool is a no-op without
  `OBJECT_STORE_BUCKET`, so local dev needs nothing new.

## 7. File-by-file impact

### Added (shared kit)
- `shared/tools/upload_run_to_object_store.ts` — the single deterministic
  implementation described above.

### Added (this agent, first adopter)
- `agent/tools/upload_run_to_object_store.ts` — one-line re-export of the
  shared tool.

### Modified (shared kit)
- `shared/package.json` — add `@aws-sdk/client-s3`.
- `shared/lib/summary.ts` (`buildRunSummary`) — optional
  `artifacts.objectStore` field. **This is a shared-kit delta** consumed by
  every agent; the field is optional and absent when no upload happened, so
  existing agents are unaffected until they adopt the tool.

### Modified (this agent)
- `agent/instructions.md` — add step 11 (conditional object-store upload +
  surfacing the bucket/prefix/URLs).
- `README.md` — document the object-store connection env vars (AWS S3 and
  MinIO example configurations) and how a remote caller learns where the run
  folder landed.

### Unchanged
- `shared/lib/run.ts` (`sync_run_to_host`, `hostRunDir`, `readHostRunArtifact`)
  — reused as-is.
- Local dev flow, `HOST_REPORT_ROOT` default, sandbox definition.
- Other agents (diagram-generator, api-test-generator, github-pr-digest,
  job-scout) — they adopt later by adding the same one-line re-export and
  orchestrator step; nothing changes for them in this delta.

## 8. Open implementation questions

Two risks surfaced in review; the implementer must resolve both:

1. **`summary.json` sequencing.** `render_and_save_report` writes
   `summary.json` at step 9, but the `artifacts.objectStore` content only
   exists after step 11's upload. As specified, the block can never appear in
   the summary that was already written — and the copy uploaded to the bucket
   can't describe its own upload. Preferred resolution: the upload tool
   uploads all files first, then patches the *host* `summary.json` with
   `artifacts.objectStore` and re-uploads that one file last (the bucket copy
   then describes the upload, minus itself).
2. **`/tmp` durability between steps on Vercel.** The tool reads from
   `hostRunDir()`, which is `/tmp` on Vercel. Under Workflows' durable
   execution, step 11 is not guaranteed to run on the same Function instance
   as step 10's `sync_run_to_host`, in which case `/tmp` is empty. Preferred
   resolution: the shared tool falls back to reading files from the sandbox
   (the same source `sync_run_to_host` copies from) when the host mirror is
   missing or incomplete.

