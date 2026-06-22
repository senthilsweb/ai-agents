import { defineTool } from "eve/tools";
import { z } from "zod";

import { modelIdFor } from "shared/lib/model.js";
import {
  createRunId,
  ensureRunDirs,
  hostRunDir,
  runRelativeDir,
  sandboxRunDir,
  writeRunArtifact,
} from "shared/lib/run.js";
import { sweepIdleSandboxContainers } from "shared/lib/sandbox-cleanup.js";

export default defineTool({
  description:
    "Create a timestamped run folder for a diagram run (mirrored to host + " +
    "sandbox) and return its path. Makes runs/<UTC-timestamp>/phases/ and " +
    "records the start epoch. Call this FIRST, before any other run work.",
  inputSchema: z.object({
    request: z
      .string()
      .describe("A short summary of the user's request, stored in run-meta.json."),
    options: z
      .record(z.string(), z.unknown())
      .default({})
      .describe("The resolved run options (theme, variations, genericize, allow_cost, ...)."),
  }),
  async execute({ request, options }, ctx) {
    // Reap stopped sandbox containers left by previous runs before starting.
    await sweepIdleSandboxContainers();

    const runId = createRunId();
    const startedAt = new Date().toISOString();
    const startEpoch = Math.floor(Date.parse(startedAt) / 1000);

    await ensureRunDirs(ctx, runId, ["phases"]);

    const meta = {
      run_id: runId,
      started_at: startedAt,
      start_epoch: startEpoch,
      request,
      options,
      models: {
        orchestrator: modelIdFor("orchestrator"),
        renderer: modelIdFor("renderer"),
      },
      host: "eve",
    };
    await writeRunArtifact(
      ctx,
      runId,
      "run-meta.json",
      JSON.stringify(meta, null, 2) + "\n",
    );

    return {
      run_dir: runRelativeDir(runId),
      run_id: runId,
      sandbox_run_dir: sandboxRunDir(runId),
      host_run_dir: hostRunDir(runId),
      started_at: startedAt,
      start_epoch: startEpoch,
    };
  },
});
