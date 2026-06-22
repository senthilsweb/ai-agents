import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Save the final Markdown digest under reports/ in the agent sandbox workspace.",
  inputSchema: z.object({
    from: z.string(),
    to: z.string(),
    markdown: z.string().min(1),
  }),
  async execute({ from, to, markdown }, ctx) {
    const safe = (value: string) => value.replace(/[^0-9A-Za-z_.-]+/g, "_");
    const path = `reports/${safe(from)}_to_${safe(to)}.md`;
    const sandbox = await ctx.getSandbox();
    await sandbox.run({ command: "mkdir -p reports" });
    await sandbox.writeTextFile({ path, content: markdown.endsWith("\n") ? markdown : `${markdown}\n` });
    return { path, bytes: Buffer.byteLength(markdown, "utf8") };
  },
});
