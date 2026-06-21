import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description:
    "Read a file from the sandbox workspace (e.g. a phase trace, run-meta.json, " +
    "or an existing report). Returns the file contents.",
  inputSchema: z.object({
    path: z.string().describe("Path relative to the workspace, e.g. 'runs/<id>/report.md'."),
  }),
  async execute({ path }, ctx) {
    const sandbox = await ctx.getSandbox();
    const content = await sandbox.readTextFile({ path });
    return { path, content };
  },
});
