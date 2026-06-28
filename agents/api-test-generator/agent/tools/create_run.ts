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
    "Create a timestamped run folder for an api-test-generator run (mirrored to " +
    "host + sandbox) and return its paths. Makes runs/<UTC-timestamp>/phases/ and " +
    "records the start epoch. Call this FIRST, before any other run work.",
  inputSchema: z.object({
    request: z
      .string()
      .describe("A short summary of the user's request, stored in run-meta.json."),
    options: z
      .record(z.string(), z.unknown())
      .default({})
      .describe("The resolved run options (spec, api_name, auth, strength, ...)."),
  }),
  async execute({ request, options }, ctx) {
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
        pairwise_designer: modelIdFor("pairwise_designer"),
        assertion_writer: modelIdFor("assertion_writer"),
      },
      host: "eve",
      agent: "api-test-generator",
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
