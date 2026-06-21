import { defineTool } from "eve/tools";
import { z } from "zod";
import { execSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export default defineTool({
  description:
    "Sync the run folder from the Docker sandbox back to the local workspace so " +
    "artifacts (cover.png, report.md, summary.json, phase traces) are visible on " +
    "the host, then remove the Docker container to free resources. Call this as " +
    "the final step after the reporter has returned and all files have been " +
    "written to the run dir.",
  inputSchema: z.object({
    run_dir: z
      .string()
      .describe("The run directory path, e.g. runs/2026-06-21T14-37-49Z"),
  }),
  async execute({ run_dir }, ctx) {
    const sandbox = await ctx.getSandbox();
    const containerId = sandbox.id;
    const localWorkspace = join(process.cwd(), "agent", "sandbox", "workspace");
    const localRunDir = join(localWorkspace, run_dir);

    // Create the local directory
    mkdirSync(localRunDir, { recursive: true });

    // Use docker cp from the HOST to copy files from the container.
    // sandbox.run() executes inside the container where host paths don't exist,
    // so we must use execSync on the host to run docker cp.
    const containerPath = `/workspace/${run_dir}`;
    let synced = false;
    let cleanupError: string | undefined;

    try {
      execSync(
        `docker cp "${containerId}:${containerPath}/." "${localRunDir}/"`,
        { stdio: "pipe", timeout: 30_000 },
      );
      synced = true;
    } catch (err) {
      // Fallback: try reading files individually via sandbox API
      try {
        const listing = await sandbox.run({
          command: `find "${containerPath}" -type f`,
        });
        const files = listing.stdout.trim().split("\n").filter(Boolean);
        for (const file of files) {
          const relPath = file.replace(`/workspace/`, "");
          const content = await sandbox.run({ command: `cat "${file}"` });
          const localPath = join(localWorkspace, relPath);
          const dir = localPath.slice(0, localPath.lastIndexOf("/"));
          mkdirSync(dir, { recursive: true });
          // Write text files; binary files (png) need special handling
          if (file.endsWith(".png")) {
            const base64 = (
              await sandbox.run({ command: `base64 "${file}"` })
            ).stdout.trim();
            execSync(
              `echo "${base64}" | base64 -d > "${localPath}"`,
              { stdio: "pipe" },
            );
          } else {
            execSync(
              `cat > "${localPath}" <<'__EOF__'\n${content.stdout}__EOF__`,
              { stdio: "pipe" },
            );
          }
        }
        synced = true;
      } catch (fallbackErr) {
        throw new Error(
          `Failed to sync run artifacts: ${err}. Fallback also failed: ${fallbackErr}`,
        );
      }
    }

    // Remove the Docker container after successful sync
    try {
      execSync(`docker rm -f "${containerId}"`, {
        stdio: "pipe",
        timeout: 15_000,
      });
    } catch (err) {
      cleanupError = `Container cleanup failed: ${err}`;
    }

    // Also clean up any lingering eve sandbox containers (reporter subagent, etc.)
    try {
      execSync(
        `docker ps -a --filter "ancestor=ghcr.io/vercel/eve:latest" ` +
          `--format "{{.ID}}" | xargs -r docker rm -f 2>/dev/null || true`,
        { stdio: "pipe", timeout: 30_000 },
      );
    } catch {
      // best-effort
    }

    return {
      synced,
      local_path: localRunDir,
      run_dir,
      container_id: containerId,
      container_removed: !cleanupError,
      ...(cleanupError ? { cleanup_error: cleanupError } : {}),
    };
  },
});
