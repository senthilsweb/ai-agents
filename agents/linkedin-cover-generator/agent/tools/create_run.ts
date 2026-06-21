import { defineTool } from "eve/tools";
import { z } from "zod";
export default defineTool({
  description: "Create a timestamped run folder. Call first.",
  inputSchema: z.object({ run_root: z.string().default("runs"), request: z.string(), options: z.record(z.string(), z.unknown()).default({}) }),
  async execute({ run_root, request, options }, ctx) {
    const sandbox = await ctx.getSandbox();
    const ts = (await sandbox.run({ command: "date -u +%Y-%m-%dT%H-%M-%SZ" })).stdout.trim();
    const run_dir = `${run_root}/${ts}`;
    await sandbox.run({ command: `mkdir -p "${run_dir}/outputs" "${run_dir}/phases"` });
    await sandbox.writeTextFile({ path: `${run_dir}/run-meta.json`, content: JSON.stringify({ run_id: ts, request, options, started_at: ts }, null, 2)+"\n" });
    return { run_dir, run_id: ts };
  }
});
