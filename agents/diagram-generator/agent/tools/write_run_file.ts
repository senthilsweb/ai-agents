import { defineTool } from "eve/tools";
import { z } from "zod";

import { writeRunArtifact } from "shared/lib/run.js";

export default defineTool({
  description:
    "Write a text artifact under a run folder (e.g. spec.json, diagram-dark.html, " +
    "phases/render-dark.json). Mirrors the file into the Eve sandbox and the host " +
    "run folder. Use this for every text artifact the harness produces.",
  inputSchema: z.object({
    path: z
      .string()
      .describe("Timestamped relative path, e.g. 'runs/<id>/spec.json'."),
    content: z.string().describe("The full file contents to write."),
  }),
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
      path: relativePath,
      sandboxPath: result.sandboxPath,
      hostPath: result.hostPath,
      bytes: result.bytes,
    };
  },
});
