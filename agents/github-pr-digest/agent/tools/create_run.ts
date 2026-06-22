import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  createRunId,
  ensureRunDirs,
  hostRunDir,
  runRelativeDir,
  sandboxRunDir,
  writeRunArtifact,
} from "shared/lib/run.js";
import { sweepIdleSandboxContainers } from "shared/lib/sandbox-cleanup.js";

const inputSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  repositories: z.array(z.string()).min(1),
});

export default defineTool({
  description:
    "Create one timestamped run directory and write request.json to the sandbox and host run folders.",

  inputSchema,

  async execute({ from, to, repositories }, ctx) {
    // Reap stopped sandbox containers left by previous runs before starting.
    await sweepIdleSandboxContainers();

    const runId = createRunId();

    await ensureRunDirs(ctx, runId, ["repositories"]);

    const request = {
      runId,
      createdAt: new Date().toISOString(),
      from,
      to,
      repositories,
    };

    await writeRunArtifact(
      ctx,
      runId,
      "request.json",
      JSON.stringify(request, null, 2),
    );

    return {
      runId,
      relativeRunDirectory: runRelativeDir(runId),
      sandboxRunDirectory: sandboxRunDir(runId),
      hostRunDirectory: hostRunDir(runId),
    };
  },
});
