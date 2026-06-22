import { defineTool } from "eve/tools";
import { z } from "zod";
import { modelIdFor } from "shared/lib/model.js";
import { readUsage } from "shared/lib/usage.js";

export default defineTool({
  description:
    "Write the orchestrate phase trace by reading current token usage and " +
    "writing it to <run_dir>/phases/orchestrate.json. Call this after " +
    "validate_image, before rendering the report. Pass the started_at " +
    "timestamp from create_run's return value.",
  inputSchema: z.object({
    run_dir: z.string().describe("The run directory, e.g. runs/2026-06-21T17-09-53Z"),
    started_at: z.string().describe("ISO 8601 timestamp from create_run's started_at field"),
  }),
  async execute({ run_dir, started_at }, ctx) {
    const sandbox = await ctx.getSandbox();
    const ended_at = new Date().toISOString();
    const duration_s = Math.round(
      (Date.now() - new Date(started_at).getTime()) / 1000,
    );

    // Read usage for the current (orchestrator) session from the shared store.
    const usage = readUsage(ctx.session.id);
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const source = usage ? "runtime" : "unavailable";

    const model = modelIdFor("orchestrator");
    const trace = {
      phase: "orchestrate",
      model,
      started_at,
      ended_at,
      duration_s,
      tokens: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
        source,
      },
    };
    await sandbox.writeTextFile({
      path: `${run_dir}/phases/orchestrate.json`,
      content: JSON.stringify(trace, null, 2) + "\n",
    });
    return { trace, phase_path: `${run_dir}/phases/orchestrate.json` };
  },
});
