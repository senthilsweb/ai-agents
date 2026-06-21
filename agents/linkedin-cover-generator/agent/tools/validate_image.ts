import { defineTool } from "eve/tools";
import { z } from "zod";
import sharp from "sharp";
export default defineTool({
  description: "Deterministically validate output dimensions and aspect ratio. No model call.",
  inputSchema: z.object({ path: z.string(), expected_width: z.number().int(), expected_height: z.number().int() }),
  async execute({ path, expected_width, expected_height }, ctx) {
    const sandbox = await ctx.getSandbox();
    const data = await sandbox.readBinaryFile({ path });
    if (!data) throw new Error(`Image not found in sandbox: ${path}`);
    const meta = await sharp(Buffer.from(data)).metadata();
    const width=meta.width ?? 0, height=meta.height ?? 0;
    const exact = width===expected_width && height===expected_height;
    const ratioError = Math.abs(width/height - expected_width/expected_height);
    return { passed: exact, hardFailure: !exact, width, height, expected_width, expected_height, ratioError, issues: exact?[]:[`Expected ${expected_width}x${expected_height}; received ${width}x${height}`] };
  }
});
