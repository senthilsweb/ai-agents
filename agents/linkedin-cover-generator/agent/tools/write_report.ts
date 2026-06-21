import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description:
    "Sync the run folder from the Docker sandbox back to the local workspace so " +
    "artifacts (cover.png, report.md, summary.json, phase traces) are visible on " +
    "the host. Call this as the final step after the reporter has returned and " +
    "all files have been written to the run dir.",
  inputSchema: z.object({
    run_dir: z.string().describe("The run directory path, e.g. runs/2026-06-21T14-37-49Z"),
  }),
  async execute({ run_dir }, ctx) {
    const sandbox = await ctx.getSandbox();
    const localWorkspace = `${process.cwd()}/agent/sandbox/workspace`;
    await sandbox.run({
      command:
        `mkdir -p "${localWorkspace}/${run_dir}" && ` +
        `cp -r /workspace/${run_dir}/* "${localWorkspace}/${run_dir}/" 2>/dev/null; true`,
    });
    return {
      synced: true,
      local_path: `${localWorkspace}/${run_dir}`,
      run_dir,
    };
  },
});
