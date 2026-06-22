import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Sandbox container cleanup ──────────────────────────────────────────────
//
// See openspec/adr/0001-shared-agent-runtime-kit.md §2.
//
// In the local Docker dev topology, each Eve session (orchestrator + every
// subagent) runs in its own `eve-sbx-*` container. When a session ends the
// container STOPS but is not removed, so corpses accumulate and must be reaped
// by hand. This helper removes only NON-running Eve sandbox containers
// (exited / created / dead) — it never touches a running container, so it is
// safe to call mid-run (it reaps already-finished subagent sandboxes) and at
// the start of a run (it reaps the previous run's now-stopped containers).
//
// It is a no-op when the docker CLI is unavailable (e.g. a hosted sandbox
// backend) or when disabled via the EVE_SANDBOX_CLEANUP env var.

export interface SandboxCleanupResult {
  /** False when disabled by env; true when the sweep ran (even if it removed nothing). */
  enabled: boolean;
  removed: string[];
  skipped: string[];
  reason?: "disabled" | "docker-unavailable";
}

export interface SandboxCleanupOptions {
  /** Container name substring to match. Defaults to `eve-sbx`. */
  namePrefix?: string;
  /** Env var that toggles cleanup (values off/false/0 disable). Defaults to EVE_SANDBOX_CLEANUP. */
  enabledEnv?: string;
}

function isDisabled(enabledEnv: string): boolean {
  const setting = (process.env[enabledEnv] ?? "on").trim().toLowerCase();
  return setting === "off" || setting === "false" || setting === "0";
}

/**
 * Remove stopped Eve sandbox containers. Running containers are never removed.
 * Resolves to a structured result; never throws (docker errors → no-op).
 */
export async function sweepIdleSandboxContainers(
  options: SandboxCleanupOptions = {},
): Promise<SandboxCleanupResult> {
  const namePrefix = options.namePrefix ?? "eve-sbx";
  const enabledEnv = options.enabledEnv ?? "EVE_SANDBOX_CLEANUP";

  if (isDisabled(enabledEnv)) {
    return { enabled: false, removed: [], skipped: [], reason: "disabled" };
  }

  let ids: string[] = [];
  try {
    // Multiple `--filter status=` values are OR-ed by docker, so this lists
    // every non-running container whose name contains the prefix.
    const { stdout } = await execFileAsync("docker", [
      "ps",
      "-aq",
      "--filter",
      `name=${namePrefix}`,
      "--filter",
      "status=exited",
      "--filter",
      "status=created",
      "--filter",
      "status=dead",
    ]);
    ids = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return { enabled: true, removed: [], skipped: [], reason: "docker-unavailable" };
  }

  if (ids.length === 0) {
    return { enabled: true, removed: [], skipped: [] };
  }

  const removed: string[] = [];
  const skipped: string[] = [];
  await Promise.all(
    ids.map(async (id) => {
      try {
        await execFileAsync("docker", ["rm", id]);
        removed.push(id);
      } catch {
        skipped.push(id);
      }
    }),
  );

  return { enabled: true, removed, skipped };
}
