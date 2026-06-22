import { defineSandbox, defaultBackend } from "eve/sandbox";

// ── Base sandbox factory ───────────────────────────────────────────────────
//
// See openspec/adr/0001-shared-agent-runtime-kit.md §2.
//
// A minimal, shared sandbox definition: pins the Eve image, purges macOS
// .DS_Store files (which otherwise trigger spurious template rebuilds), and
// lets each agent layer its own bootstrap steps. Agents that need extra tooling
// (e.g. a headless browser) pass an `extraBootstrap` callback; agents that only
// read/write text run artifacts (like github-pr-digest) need nothing more.

export interface BaseSandboxOptions {
  /**
   * Bump when the bootstrap or seeded files change so Eve rebuilds the template
   * image instead of reusing a stale one.
   */
  revalidationKey: string;
  /** Docker image to pin. Defaults to the pinned Eve image. */
  image?: string;
  /** Optional extra bootstrap, run after the base steps. */
  extraBootstrap?: (sandbox: {
    run(opts: { command: string }): PromiseLike<unknown>;
  }) => Promise<void>;
}

export function createBaseSandbox(options: BaseSandboxOptions) {
  const image = options.image ?? "ghcr.io/vercel/eve:latest";
  return defineSandbox({
    backend: defaultBackend({ docker: { image } }),
    revalidationKey: () => options.revalidationKey,
    async bootstrap({ use }) {
      const sandbox = await use();
      await sandbox.run({
        command: "find /workspace -name '.DS_Store' -delete 2>/dev/null; true",
      });
      if (options.extraBootstrap) {
        await options.extraBootstrap(sandbox);
      }
    },
  });
}
