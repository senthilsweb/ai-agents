# Design: Store Run Artifacts in Vercel Blob for Remote Deployments

> Conforms to [`ai-agents/openspec/adr/0001-shared-agent-runtime-kit.md`](../../../../../openspec/adr/0001-shared-agent-runtime-kit.md).

## 1. Problem recap

```
Local dev:
  sandbox /workspace/runs/<id>/cover.png
        │  sync_run_to_host (shared/lib/run.ts)
        ▼
  ${HOST_REPORT_ROOT}/agent/sandbox/workspace/runs/<id>/cover.png
        = developer's own disk (HOST_REPORT_ROOT defaults to cwd)
        → immediately viewable, no extra step needed.

Vercel deployment (current state):
  sandbox /workspace/runs/<id>/cover.png
        │  sync_run_to_host
        ▼
  ${HOST_REPORT_ROOT}/agent/sandbox/workspace/runs/<id>/cover.png
        = /tmp/agent/sandbox/workspace/runs/<id>/cover.png
        (HOST_REPORT_ROOT=/tmp, set as a Vercel env var so create_run
        doesn't fail on the read-only /var/task bundle)
        → ephemeral, Function-local, never reaches the caller.
```

The gap is the last hop: from "somewhere on the Function's disk" to "a URL the
caller can fetch." eve's session/stream protocol only carries JSON events
(`message.*`, `action.*`, `step.*`, …) between server and client — there is no
generic binary-attachment channel in that protocol today.

## 2. Approach

Add a durable-storage hop using [Vercel Blob](https://vercel.com/docs/storage/vercel-blob),
which is the standard Vercel-native object store and requires no extra
infrastructure decisions (it's provisioned per-project and authenticates via a
single `BLOB_READ_WRITE_TOKEN` env var that Vercel injects automatically once a
Blob store is attached to the project).

```
sandbox /workspace/runs/<id>/cover.png
     │  sync_run_to_host (unchanged)
     ▼
${HOST_REPORT_ROOT}/.../runs/<id>/cover.png   (local disk OR Function /tmp)
     │  upload_run_artifacts (NEW, conditional on BLOB_READ_WRITE_TOKEN)
     ▼
https://<blob-store>.public.blob.vercel-storage.com/runs/<id>/cover.png
     → returned in the final assistant message + summary.json
```

## 3. New tool: `upload_run_artifacts`

```ts
// agent/tools/upload_run_artifacts.ts
inputSchema: z.object({
  run_dir: z.string().describe("The run directory, e.g. runs/2026-07-05T14-26-27Z"),
  files: z.array(z.string()).default(["cover.png"]),
})
```

Behavior:
- Reads each requested file from the **host** run mirror (the same location
  `sync_run_to_host` already wrote to), via `hostRunDir(runId)` /
  `readHostRunArtifact` from `shared/lib/run.ts`.
- Skips (returns `{ uploaded: [], skipped: [...] }`) when
  `process.env.BLOB_READ_WRITE_TOKEN` is unset, so local dev runs are
  unaffected and nothing errors when the token isn't configured.
- Uploads each file via `@vercel/blob`'s `put(pathname, body, { access: "public", token })`,
  keyed as `runs/<runId>/<filename>` so URLs are stable and collisions across
  runs are impossible (run ids are timestamped).
- Returns `{ uploaded: [{ path, url, size }], skipped: [...] }`.

This is a **deterministic tool** — no model call, consistent with every other
correctness-critical step in this agent (ADR 0001 §2).

## 4. Orchestrator procedure change

Insert one conditional step after step 10 (`sync_run_to_host`) in
`instructions.md`:

> 11. Call `upload_run_artifacts` with `{ run_dir, files: ["cover.png"] }`. If
>     it reports `uploaded`, include the returned URL(s) in the final message
>     alongside the local paths. If it reports everything `skipped` (no Blob
>     token configured), omit the URL and keep reporting local paths only —
>     this is expected and normal for local dev.

`summary.json` gains an optional `artifacts.blob` array (URL + size per
uploaded file) via `buildRunSummary` in `shared/lib/summary.ts`, so
programmatic callers hitting `/eve/v1/session` don't have to scrape the
free-text assistant message to find the image.

## 5. Environment / setup

- New dependency: `@vercel/blob` in `agents/linkedin-cover-generator/package.json`.
- New env var (Vercel-managed, not hand-set): `BLOB_READ_WRITE_TOKEN` —
  provisioned automatically once a Blob store is attached to the
  `linkedin-cover-generator` Vercel project (Storage tab → Create → Blob →
  Connect to Project). No manual `vercel env add` needed for this one.
- No change to local `.env` / `.env.example` — the tool is a no-op without the
  token, so local dev needs nothing new.

## 6. File-by-file impact

### Added
- `agent/tools/upload_run_artifacts.ts` — the new deterministic tool described
  above.

### Modified
- `agent/instructions.md` — add step 11 (conditional Blob upload + surfacing
  the URL).
- `package.json` — add `@vercel/blob`.
- `README.md` — document the Blob store dependency, the conditional/no-op
  behavior in local dev, and how a remote caller retrieves the returned URL.

### Unchanged
- `shared/lib/run.ts` (`sync_run_to_host`, `hostRunDir`, `readHostRunArtifact`)
  — reused as-is; no shared-kit changes.
- Local dev flow, `HOST_REPORT_ROOT` default, sandbox definition.
