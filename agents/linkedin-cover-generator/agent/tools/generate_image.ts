import { defineTool } from "eve/tools";
import { z } from "zod";

import { withSpan } from "shared/lib/telemetry.js";

export default defineTool({
  description: "Generate one image with the configured image model and save it in the run folder. Also writes a phase trace to <run_dir>/phases/generate.json automatically.",
  inputSchema: z.object({ prompt: z.string(), width: z.number().int(), height: z.number().int(), output_path: z.string(), run_dir: z.string().describe("The run directory, e.g. runs/2026-06-21T17-09-53Z"), reference_path: z.string().optional() }),
  async execute({ prompt, width, height, output_path, run_dir, reference_path }, ctx) {
    const started_at = new Date().toISOString();
    const apiKey = process.env.IMAGE_API_KEY ?? process.env.MODEL_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Set IMAGE_API_KEY, MODEL_API_KEY, or OPENAI_API_KEY.");
    const model = process.env.IMAGE_MODEL ?? "gpt-image-2";
    const base = process.env.IMAGE_BASE_URL ?? process.env.MODEL_BASE_URL ?? "https://api.openai.com/v1";
    const snap = (n: number) => Math.max(256, Math.round(n / 16) * 16);
    const w = snap(width);
    const h = snap(height);
    const body: any = { model, prompt, size: `${w}x${h}`, quality: process.env.IMAGE_QUALITY ?? "high", output_format: "png" };
    if (reference_path) throw new Error("Reference-image editing requires provider-specific multipart support; use the documented adapter extension point.");
    // Custom span: this plain-HTTP call is invisible to the automatic AI SDK
    // spans, yet it is usually the slowest step of a run. No-op when
    // telemetry is off (see shared/lib/telemetry.ts).
    const res = await withSpan(
      "cover.image_generation",
      { "cover.image_model": model, "cover.width": w, "cover.height": h },
      () => fetch(`${base.replace(/\/$/,"")}/images/generations`, { method: "POST", headers: { "content-type":"application/json", authorization:`Bearer ${apiKey}` }, body: JSON.stringify(body) }),
    );
    const json: any = await res.json();
    if (!res.ok) throw new Error(`Image generation failed: ${res.status} ${JSON.stringify(json)}`);
    const b64 = json.data?.[0]?.b64_json;
    const url = json.data?.[0]?.url;
    let bytes: Uint8Array;
    if (b64) bytes = Buffer.from(b64, "base64");
    else if (url) bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    else throw new Error("Provider returned neither b64_json nor url.");
    const sandbox = await ctx.getSandbox();
    await sandbox.writeBinaryFile({ path: output_path, content: bytes });
    const ended_at = new Date().toISOString();
    const duration_s = Math.round((Date.now() - new Date(started_at).getTime()) / 1000);
    // Auto-write phase trace
    const trace = { phase: "generate", model, started_at, ended_at, duration_s, tokens: { input: 0, output: 0, total: 0, source: "runtime" } };
    await sandbox.writeTextFile({ path: `${run_dir}/phases/generate.json`, content: JSON.stringify(trace, null, 2) + "\n" });
    return { output_path, model, bytes: bytes.byteLength, actual_width: w, actual_height: h, started_at, ended_at, duration_s };
  }
});
