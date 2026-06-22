import { defineTool } from "eve/tools";
import { z } from "zod";

import { syncRunToHost } from "shared/lib/run.js";

// See openspec/adr/0001-shared-agent-runtime-kit.md §2.
//
// Canonical end-of-run copy-back: pull every file in the sandbox run folder
// back to the host run folder in a single, backend-agnostic, idempotent call.

export default defineTool({
  description:
    "Copy every file in the sandbox run folder (runs/<runId>/) back to the host " +
    "workspace run folder. Call once at the end of a run. Idempotent and safe " +
    "to call even when the host mirror already exists.",
  inputSchema: z.object({
    runId: z.string().min(1),
  }),
  async execute({ runId }, ctx) {
    return syncRunToHost(ctx, runId);
  },
});
