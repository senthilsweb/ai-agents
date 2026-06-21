import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description:
    "Write a file into a run folder in the sandbox workspace (e.g. spec.json, " +
    "diagram-dark.html, phases/render-dark.json, report.md). Use this for every " +
    "artifact the harness produces so they all land under the run folder.",
  inputSchema: z.object({
    path: z
      .string()
      .describe("Path relative to the workspace, e.g. 'runs/<id>/spec.json'."),
    content: z.string().describe("The full file contents to write."),
  }),
  async execute({ path, content }, ctx) {
    const sandbox = await ctx.getSandbox();
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
    if (dir) await sandbox.run({ command: `mkdir -p "${dir}"` });
    await sandbox.writeTextFile({ path, content });
    const bytes = Buffer.byteLength(content, "utf8");
    return { path, bytes };
  },
});
