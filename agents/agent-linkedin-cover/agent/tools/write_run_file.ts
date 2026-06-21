import { defineTool } from "eve/tools";
import { z } from "zod";
export default defineTool({
  description: "Write a text artifact under a run folder.",
  inputSchema: z.object({ path: z.string(), content: z.string() }),
  async execute({ path, content }, ctx) { const s=await ctx.getSandbox(); await s.writeTextFile({ path, content }); return { path, bytes: Buffer.byteLength(content) }; }
});
