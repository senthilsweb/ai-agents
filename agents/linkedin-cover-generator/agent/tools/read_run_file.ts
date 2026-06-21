import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description:
    "Read a text file from the sandbox workspace (e.g. phase traces, run-meta.json). " +
    "Returns the file content as a string.",
  inputSchema: z.object({
    path: z
      .string()
      .describe("Path relative to /workspace, e.g. runs/2026-06-21T14-37-49Z/phases/orchestrate.json"),
  }),
  async execute({ path }, ctx) {
    const sandbox = await ctx.getSandbox();
    const result = await sandbox.run({ command: `cat "/workspace/${path}"` });
    return { path, content: result.stdout };
  },
});
