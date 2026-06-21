import { defineSandbox, defaultBackend } from "eve/sandbox";

export default defineSandbox({
  // Docker is available locally; on Vercel this auto-switches to Vercel Sandbox.
  // Falls back to microsandbox / just-bash where Docker is absent.
  backend: defaultBackend({
    docker: { image: "ghcr.io/vercel/eve:latest" },
  }),
  // Bump this when the bootstrap or seeded files change, so eve rebuilds the
  // template image instead of reusing a stale one.
  revalidationKey: () => "renderer-bootstrap-v2",
  async bootstrap({ use }) {
    const sandbox = await use();
    // Remove macOS .DS_Store files that may have been seeded from the workspace
    // folder — they change frequently and trigger unwanted template rebuilds.
    await sandbox.run({
      command: "find /workspace -name '.DS_Store' -delete 2>/dev/null; true",
    });
    // Install a headless browser once per template so the renderer's
    // self-verify screenshot works. Cached across sessions by the revalidationKey.
    await sandbox.run({
      command:
        "npm init -y >/dev/null 2>&1 && " +
        "npm install playwright >/dev/null 2>&1 && " +
        "npx playwright install --with-deps chromium >/dev/null 2>&1 || " +
        "echo 'playwright bootstrap attempted'",
    });
  },
});
