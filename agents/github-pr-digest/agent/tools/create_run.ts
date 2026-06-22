import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { defineTool } from "eve/tools";
import { z } from "zod";

const inputSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  repositories: z.array(z.string()).min(1),
});

function createRunId(): string {
  return new Date()
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "-");
}

export default defineTool({
  description:
    "Create one timestamped run directory and write request.json to the sandbox and host workspace.",

  inputSchema,

  async execute({ from, to, repositories }, ctx) {
    const runId = createRunId();
    const relativeRunDirectory = `runs/${runId}`;
    const sandboxRunDirectory = `/workspace/${relativeRunDirectory}`;

    const sandbox = await ctx.getSandbox();

    await sandbox.run({
      command: `mkdir -p ${JSON.stringify(
        `${sandboxRunDirectory}/repositories`,
      )}`,
    });

    const projectRoot = process.env.HOST_REPORT_ROOT ?? process.cwd();
    const hostRunDirectory = path.resolve(
      projectRoot,
      "agent",
      "sandbox",
      "workspace",
      relativeRunDirectory,
    );

    await mkdir(path.join(hostRunDirectory, "repositories"), {
      recursive: true,
    });

    const request = {
      runId,
      createdAt: new Date().toISOString(),
      from,
      to,
      repositories,
    };

    const requestJson = JSON.stringify(request, null, 2);

    await sandbox.writeTextFile({
      path: `${sandboxRunDirectory}/request.json`,
      content: requestJson,
    });

    await writeFile(
      path.join(hostRunDirectory, "request.json"),
      requestJson,
      "utf8",
    );

    return {
      runId,
      relativeRunDirectory,
      sandboxRunDirectory,
      hostRunDirectory,
    };
  },
});
