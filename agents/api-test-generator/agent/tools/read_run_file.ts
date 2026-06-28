import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description:
    "Read a text artifact from within a run folder in the sandbox. Use to " +
    "retrieve subagent outputs (factors_model.json, assertion_scripts.json) or " +
    "intermediate tool outputs for inspection.",
  inputSchema: z.object({
    path: z
      .string()
      .describe("Sandbox path, e.g. '/workspace/runs/<id>/factors_model.json'."),
  }),
  async execute({ path }, ctx) {
    const sandboxPath = path.startsWith("/workspace/") ? path : `/workspace/${path}`;
    const sandbox = await ctx.getSandbox();
    const raw = await sandbox.readTextFile({ path: sandboxPath });
    const content =
      typeof raw === "string"
        ? raw
        : raw && typeof raw === "object" && "content" in raw
          ? String((raw as { content: unknown }).content)
          : String(raw ?? "");
    return { path: sandboxPath, content, bytes: Buffer.byteLength(content, "utf8") };
  },
});
