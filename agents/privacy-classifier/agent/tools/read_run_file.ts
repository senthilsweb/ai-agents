import { defineTool } from "eve/tools";
import { z } from "zod";

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "content" in value) {
    const content = (value as { content: unknown }).content;
    if (typeof content === "string") return content;
  }
  return String(value ?? "");
}

export default defineTool({
  description:
    "Read a text file from the sandbox workspace (e.g. result.json, run-meta.json). " +
    "Returns the file content as a string.",
  inputSchema: z.object({
    path: z
      .string()
      .refine((p) => !p.startsWith("/") && !p.split("/").includes(".."), {
        message: "path must be relative to /workspace and must not contain '..'",
      })
      .describe(
        "Path relative to /workspace, e.g. runs/2026-06-21T14-37-49Z/result.json",
      ),
  }),
  async execute({ path }, ctx) {
    const sandbox = await ctx.getSandbox();
    const content = textOf(await sandbox.readTextFile({ path: `/workspace/${path}` }));
    return { path, content };
  },
});
