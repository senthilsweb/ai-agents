import { defineTool } from "eve/tools";
import { z } from "zod";
import sharp from "sharp";
export default defineTool({
  description: "Deterministically validate output dimensions and aspect ratio. No model call.",
  inputSchema: z.object({ path: z.string(), expected_width: z.number().int(), expected_height: z.number().int() }),
  async execute({ path, expected_width, expected_height }, ctx) {
    const started_at = new Date().toISOString();
    const sandbox = await ctx.getSandbox();
    const data = await sandbox.readBinaryFile({ path });
    if (!data) throw new Error(`Image not found in sandbox: ${path}`);
    const meta = await sharp(Buffer.from(data)).metadata();
    const width=meta.width ?? 0, height=meta.height ?? 0;
    const SNAP_TOLERANCE = 16;
    const withinSnap = Math.abs(width - expected_width) <= SNAP_TOLERANCE && Math.abs(height - expected_height) <= SNAP_TOLERANCE;
    const exact = width===expected_width && height===expected_height;
    const ratioError = Math.abs(width/height - expected_width/expected_height);
    const passed = exact || withinSnap;
    const issues: string[] = [];
    if (!passed) issues.push(`Expected ${expected_width}x${expected_height}; received ${width}x${height}`);
    else if (!exact) issues.push(`Snapped: expected ${expected_width}x${expected_height}; received ${width}x${height} (within 16px tolerance)`);
    const ended_at = new Date().toISOString();
    const duration_s = Math.round((Date.now() - new Date(started_at).getTime()) / 1000);
    return { passed, hardFailure: !passed, width, height, expected_width, expected_height, ratioError, issues, started_at, ended_at, duration_s };
  }
});
