import { defineTool } from "eve/tools";
import { z } from "zod";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { modelIdFor, MODEL_ORCHESTRATOR } from "#lib/model.js";

const USAGE_DIR = join(tmpdir(), "eve-usage");

export default defineTool({
  description:
    "Write the orchestrate phase trace by reading current token usage and " +
    "writing it to <run_dir>/phases/orchestrate.json. Call this after " +
    "validate_image, before delegating to the reporter. Pass the started_at " +
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

    // Read usage for current session
    const current_session_id = ctx.session.id;
    let inputTokens = 0;
    let outputTokens = 0;
    let source = "runtime";

    if (existsSync(USAGE_DIR)) {
      const p = join(USAGE_DIR, `${current_session_id}.json`);
      if (existsSync(p)) {
        const data = JSON.parse(readFileSync(p, "utf8"));
        inputTokens = data.inputTokens ?? 0;
        outputTokens = data.outputTokens ?? 0;
      } else {
        source = "unavailable";
      }
    } else {
      source = "unavailable";
    }

    const model = modelIdFor(MODEL_ORCHESTRATOR);
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
