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
  description: "Create a timestamped run folder (mirrored to host + sandbox). Call first.",
  inputSchema: z.object({
    request: z.string(),
    options: z.record(z.string(), z.unknown()).default({}),
  }),
  async execute({ request, options }, ctx) {
    // Reap stopped sandbox containers left by previous runs before starting.
    await sweepIdleSandboxContainers();

    const runId = createRunId();
    const startedAt = new Date().toISOString();
    const startEpoch = Math.floor(Date.parse(startedAt) / 1000);

    await ensureRunDirs(ctx, runId, ["outputs", "phases"]);

    const imageModel = process.env.IMAGE_MODEL ?? "gpt-image-2";
    const meta = {
      run_id: runId,
      request,
      options,
      started_at: startedAt,
      start_epoch: startEpoch,
      models: {
        orchestrator: modelIdFor("orchestrator"),
        image: imageModel,
      },
    };
    await writeRunArtifact(
      ctx,
      runId,
      "run-meta.json",
      JSON.stringify(meta, null, 2) + "\n",
    );

    return {
      run_id: runId,
      run_dir: runRelativeDir(runId),
      sandbox_run_dir: sandboxRunDir(runId),
      host_run_dir: hostRunDir(runId),
      started_at: startedAt,
      start_epoch: startEpoch,
    };
  },
});
