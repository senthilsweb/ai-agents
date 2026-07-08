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

import { resolvePiiEngine, usesGenai } from "#lib/engine.js";

export default defineTool({
  description:
    "Create a timestamped run folder (mirrored to host + sandbox). Validates " +
    "PII_ENGINE. Call first.",
  inputSchema: z.object({
    request: z.string(),
    options: z.record(z.string(), z.unknown()).default({}),
  }),
  async execute({ request, options }, ctx) {
    await sweepIdleSandboxContainers();

    const runId = createRunId();
    const startedAt = new Date().toISOString();
    const engine = resolvePiiEngine();

    await ensureRunDirs(ctx, runId, ["pii_raw"]);

    const models: Record<string, string> = {
      orchestrator: modelIdFor("orchestrator"),
    };
    if (usesGenai(engine)) {
      models.pii_detector = modelIdFor("pii_detector");
    }

    const meta = {
      run_id: runId,
      request,
      options,
      started_at: startedAt,
      pii_engine: engine,
      models,
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
      pii_engine: engine,
      models,
    };
  },
});
