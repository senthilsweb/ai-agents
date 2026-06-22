import { readFile } from "node:fs/promises";
import path from "node:path";

import { defineTool } from "eve/tools";
import { z } from "zod";

const inputSchema = z.object({
  runId: z.string().min(1),
});

export default defineTool({
  description:
    "Read the deterministic host report, copy it into the root Eve sandbox, and return the complete Markdown.",

  inputSchema,

  async execute({ runId }, ctx) {
    const projectRoot =
      process.env.HOST_REPORT_ROOT ?? process.cwd();

    const hostPath = path.resolve(
      projectRoot,
      "agent",
      "sandbox",
      "workspace",
      "runs",
      runId,
      "report.md",
    );

    const markdown = await readFile(hostPath, "utf8");

    if (
      !markdown.includes("## Summary") ||
      !markdown.includes("## Repository Activity")
    ) {
      throw new Error(
        "Host report is incomplete and will not be finalized.",
      );
    }

    const sandboxPath = `/workspace/runs/${runId}/report.md`;
    const sandbox = await ctx.getSandbox();

    await sandbox.run({
      command: `mkdir -p ${JSON.stringify(
        `/workspace/runs/${runId}`,
      )}`,
    });

    await sandbox.writeTextFile({
      path: sandboxPath,
      content: markdown,
    });

    return {
      runId,
      markdown,
      hostPath,
      sandboxPath,
      bytes: Buffer.byteLength(markdown, "utf8"),
    };
  },
});
