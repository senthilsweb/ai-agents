import { defineTool } from "eve/tools";
import { z } from "zod";

import { writeRunArtifact } from "shared/lib/run.js";

const inputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      "Timestamped relative output path, for example runs/2026-06-22T02-15-30Z/report.md",
    ),
  content: z.string(),
});

export default defineTool({
  description:
    "Write a run artifact into the Eve sandbox and mirror it into the host run folder.",

  inputSchema,

  async execute({ path: relativePath, content }, ctx) {
    const normalizedPath = relativePath
      .replace(/^\/workspace\//, "")
      .replace(/^\/+/, "");

    const match = /^runs\/([^/]+)\/(.+)$/.exec(normalizedPath);
    if (!match || normalizedPath.includes("..")) {
      throw new Error(
        "Output path must be inside a timestamped runs/<run-id>/ directory.",
      );
    }

    const [, runId, withinRun] = match;
    const result = await writeRunArtifact(ctx, runId, withinRun, content);

    return {
      sandboxPath: result.sandboxPath,
      hostPath: result.hostPath,
      bytes: result.bytes,
    };
  },
});
