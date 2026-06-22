import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { defineTool } from "eve/tools";
import { z } from "zod";

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
    "Write a run artifact into the Eve sandbox and mirror it into the host workspace.",

  inputSchema,

  async execute({ path: relativePath, content }, ctx) {
    const normalizedPath = relativePath
      .replace(/^\/workspace\//, "")
      .replace(/^\/+/, "");

    if (
      normalizedPath.includes("..") ||
      !/^runs\/[^/]+\/.+/.test(normalizedPath)
    ) {
      throw new Error(
        "Output path must be inside a timestamped runs/<run-id>/ directory.",
      );
    }

    const sandbox = await ctx.getSandbox();
    const sandboxPath = `/workspace/${normalizedPath}`;
    const sandboxDirectory = path.posix.dirname(sandboxPath);

    await sandbox.run({
      command: `mkdir -p ${JSON.stringify(sandboxDirectory)}`,
    });

    await sandbox.writeTextFile({
      path: sandboxPath,
      content,
    });

    const projectRoot = process.env.HOST_REPORT_ROOT ?? process.cwd();
    const hostWorkspaceRoot = path.resolve(
      projectRoot,
      "agent",
      "sandbox",
      "workspace",
    );
    const hostPath = path.resolve(hostWorkspaceRoot, normalizedPath);

    if (!hostPath.startsWith(`${hostWorkspaceRoot}${path.sep}`)) {
      throw new Error("Resolved host path escapes the workspace.");
    }

    await mkdir(path.dirname(hostPath), {
      recursive: true,
    });
    await writeFile(hostPath, content, "utf8");

    return {
      sandboxPath,
      hostPath,
      bytes: Buffer.byteLength(content, "utf8"),
    };
  },
});
