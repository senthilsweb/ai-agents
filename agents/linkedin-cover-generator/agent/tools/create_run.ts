import { defineTool } from "eve/tools";
import { z } from "zod";
import { modelIdFor, MODEL_ORCHESTRATOR, MODEL_REPORTER } from "#lib/model.js";

export default defineTool({
  description: "Create a timestamped run folder. Call first.",
  inputSchema: z.object({ run_root: z.string().default("runs"), request: z.string(), options: z.record(z.string(), z.unknown()).default({}) }),
  async execute({ run_root, request, options }, ctx) {
    const sandbox = await ctx.getSandbox();
    const ts = (await sandbox.run({ command: "date -u +%Y-%m-%dT%H-%M-%SZ" })).stdout.trim();
    const epoch = (await sandbox.run({ command: "date -u +%s" })).stdout.trim();
    const run_dir = `${run_root}/${ts}`;
    await sandbox.run({ command: `mkdir -p "${run_dir}/outputs" "${run_dir}/phases"` });
    const imageModel = process.env.IMAGE_MODEL ?? "gpt-image-2";
    const meta = {
      run_id: ts,
      request,
      options,
      started_at: ts,
      start_epoch: parseInt(epoch, 10),
      models: {
        orchestrator: modelIdFor(MODEL_ORCHESTRATOR),
        image: imageModel,
        reporter: modelIdFor(MODEL_REPORTER),
      },
    };
    await sandbox.writeTextFile({ path: `${run_dir}/run-meta.json`, content: JSON.stringify(meta, null, 2)+"\n" });
    return { run_dir, run_id: ts, start_epoch: parseInt(epoch, 10) };
  }
});
