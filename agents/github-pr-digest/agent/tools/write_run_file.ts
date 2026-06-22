import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { defineTool } from "eve/tools";
import { z } from "zod";

const inputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("Relative output path, for example runs/report.md"),
  content: z.string(),
});

export default defineTool({
  description:
    "Write a report into the Eve sandbox and mirror it into the local host workspace.",

  inputSchema,

  async execute({ path: relativePath, content }, ctx) {
    const normalizedPath = relativePath
      .replace(/^\/workspace\//, "")
      .replace(/^\/+/, "");

    if (
      normalizedPath.includes("..") ||
      !normalizedPath.startsWith("runs/")
    ) {
      throw new Error(
        "Output path must be underneath runs/ and must not contain '..'.",
      );
    }

    /*
     * 1. Write inside the Eve sandbox.
     */
    const sandbox = await ctx.getSandbox();
    const sandboxPath = `/workspace/${normalizedPath}`;
    const sandboxDirectory = sandboxPath.slice(
      0,
      sandboxPath.lastIndexOf("/"),
    );

    await sandbox.run({
      command: `mkdir -p ${JSON.stringify(sandboxDirectory)}`,
    });

    await sandbox.writeTextFile({
      path: sandboxPath,
      content,
    });

    /*
     * 2. Mirror to the local host.
     *
     * Run Eve from the github-pr-digest project root, or explicitly set
     * HOST_REPORT_ROOT to that project directory.
     */
    const projectRoot =
      process.env.HOST_REPORT_ROOT ?? process.cwd();

    const hostWorkspaceRoot = path.resolve(
      projectRoot,
      "agent",
      "sandbox",
      "workspace",
    );

    const hostPath = path.resolve(
      hostWorkspaceRoot,
      normalizedPath,
    );

    /*
     * Prevent paths from escaping the expected host workspace.
     */
    if (
      hostPath !== hostWorkspaceRoot &&
      !hostPath.startsWith(`${hostWorkspaceRoot}${path.sep}`)
    ) {
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