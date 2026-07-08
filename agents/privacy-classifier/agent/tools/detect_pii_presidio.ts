import { defineTool } from "eve/tools";
import { z } from "zod";

import { sandboxRunDir } from "shared/lib/run.js";

import { analyzeWithPresidio } from "#lib/presidio.js";

export default defineTool({
  description:
    "Run Presidio (local, statistical/NER-based, no GenAI) against a run's " +
    "extracted text and return raw findings. Standalone tool for testing the " +
    "presidio engine in isolation — detect_privacy_entities calls the same " +
    "underlying function directly as part of the full pipeline.",
  inputSchema: z.object({
    run_dir: z
      .string()
      .min(1)
      .describe("The run directory, e.g. runs/2026-07-05T14-26-27Z"),
    language: z
      .string()
      .regex(/^[a-z]{2}$/, "Expected a 2-letter ISO 639-1 language code, e.g. 'en'.")
      .optional(),
    score_threshold: z.number().min(0).max(1).optional(),
  }),
  async execute({ run_dir, language, score_threshold }, ctx) {
    const runId = run_dir.replace(/^runs\//, "").replace(/\/+$/, "");
    if (!runId || runId.includes("..") || runId.includes("/")) {
      throw new Error(`Invalid run_dir: ${run_dir}`);
    }
    const sandboxDir = sandboxRunDir(runId);
    const findings = await analyzeWithPresidio(ctx, {
      sandboxTextPath: `${sandboxDir}/extracted.txt`,
      sandboxOutputPath: `${sandboxDir}/pii_raw/presidio.json`,
      language,
      scoreThreshold: score_threshold,
    });
    return { findings, count: findings.length };
  },
});
