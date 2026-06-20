import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description:
    "Create a timestamped run folder for a diagram run and return its path. " +
    "Makes <run_root>/<UTC-timestamp>/phases/ inside the sandbox workspace and " +
    "records the start epoch. Call this FIRST, before any other run work.",
  inputSchema: z.object({
    run_root: z
      .string()
      .default("runs")
      .describe("Where to create the run folder, relative to the workspace (default 'runs')."),
    request: z
      .string()
      .describe("A short summary of the user's request, stored in run-meta.json."),
    options: z
      .record(z.string(), z.unknown())
      .default({})
      .describe("The resolved run options (theme, variations, genericize, allow_cost, ...)."),
  }),
  async execute({ run_root, request, options }, ctx) {
    const sandbox = await ctx.getSandbox();
    const tsRes = await sandbox.run({ command: "date -u +%Y-%m-%dT%H-%M-%SZ" });
    const run_id = tsRes.stdout.trim();
    const epochRes = await sandbox.run({ command: "date -u +%s" });
    const start_epoch = epochRes.stdout.trim();
    const run_dir = `${run_root}/${run_id}`;

    await sandbox.run({ command: `mkdir -p "${run_dir}/phases"` });

    const meta = {
      run_id,
      started_at: run_id,
      request,
      options,
      models: {
        // The orchestrator and its renderer/reporter copies all share the single
        // agent model (configured via MODEL env in agent.ts).
        orchestrator: process.env.MODEL ?? "deepseek-v4-pro",
      },
      host: "eve",
    };
    await sandbox.writeTextFile({
      path: `${run_dir}/run-meta.json`,
      content: JSON.stringify(meta, null, 2) + "\n",
    });

    return { run_dir, run_id, start_epoch };
  },
});
