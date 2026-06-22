import { defineTool } from "eve/tools";
import { z } from "zod";

import { sweepIdleSandboxContainers } from "shared/lib/sandbox-cleanup.js";

// Canonical end-of-run infra cleanup: reap stopped Eve sandbox containers so
// they do not accumulate and require manual `docker rm`. See
// openspec/adr/0001-shared-agent-runtime-kit.md §2. Running containers are
// never removed; disable with EVE_SANDBOX_CLEANUP=off.

export default defineTool({
  description:
    "Remove stopped Eve sandbox (eve-sbx-*) containers left behind by finished sessions. Never removes running containers. No-op when docker is unavailable or EVE_SANDBOX_CLEANUP is off.",

  inputSchema: z.object({
    namePrefix: z.string().min(1).optional(),
  }),

  async execute({ namePrefix }) {
    const result = await sweepIdleSandboxContainers(
      namePrefix ? { namePrefix } : {},
    );
    return result;
  },
});
