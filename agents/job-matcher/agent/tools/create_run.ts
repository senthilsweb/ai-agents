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
    "Create a timestamped run folder (mirrored to host + sandbox). Resolves " +
    "the job_analyst model and the fan-out concurrency limit. Call first.",
  inputSchema: z.object({
    request: z.string(),
    options: z.record(z.string(), z.unknown()).default({}),
  }),
  async execute({ request, options }, ctx) {
    await sweepIdleSandboxContainers();

    const runId = createRunId();
    const startedAt = new Date().toISOString();

    await ensureRunDirs(ctx, runId, ["jobs"]);

    const models: Record<string, string> = {
      orchestrator: modelIdFor("orchestrator"),
      job_analyst: modelIdFor("job_analyst"),
    };

    const fanoutConcurrency = Math.max(
      1,
      Number.parseInt(process.env.JOB_FANOUT_CONCURRENCY ?? "3", 10) || 3,
    );

    const meta = {
      run_id: runId,
      request,
      options,
      started_at: startedAt,
      models,
      fanout_concurrency: fanoutConcurrency,
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
      models,
      fanout_concurrency: fanoutConcurrency,
    };
  },
});
