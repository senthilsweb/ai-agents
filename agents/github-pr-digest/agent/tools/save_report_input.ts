import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { defineTool } from "eve/tools";
import { z } from "zod";

const inputSchema = z.object({
  runId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  repositories: z.array(z.string()).min(1),
  results: z.array(z.unknown()),
  errors: z.array(z.unknown()).default([]),
});

export default defineTool({
  description:
    "Persist normalized collector results for the Reporter subagent in the timestamped host run directory.",

  inputSchema,

  async execute(
    { runId, from, to, repositories, results, errors },
    ctx,
  ) {
    const projectRoot = process.env.HOST_REPORT_ROOT ?? process.cwd();

    const hostRunDirectory = path.resolve(
      projectRoot,
      "agent",
      "sandbox",
      "workspace",
      "runs",
      runId,
    );

    await mkdir(hostRunDirectory, {
      recursive: true,
    });

    const payload = {
      runId,
      from,
      to,
      repositories,
      results,
      errors,
    };

    const content = JSON.stringify(payload, null, 2);
    const hostPath = path.join(hostRunDirectory, "report-input.json");

    await writeFile(hostPath, content, "utf8");

    const sandbox = await ctx.getSandbox();
    const sandboxPath = `/workspace/runs/${runId}/report-input.json`;

    await sandbox.run({
      command: `mkdir -p ${JSON.stringify(
        `/workspace/runs/${runId}`,
      )}`,
    });

    await sandbox.writeTextFile({
      path: sandboxPath,
      content,
    });

    return {
      runId,
      hostPath,
      sandboxPath,
      bytes: Buffer.byteLength(content, "utf8"),
    };
  },
});
