import { defineSandbox, defaultBackend } from "eve/sandbox";

export default defineSandbox({
  // Docker is available locally; on Vercel this auto-switches to Vercel Sandbox.
  // Falls back to microsandbox / just-bash where Docker is absent.
  backend: defaultBackend({
    docker: { image: "ghcr.io/vercel/eve:latest" },
  }),
  // Bump this when the bootstrap or seeded files change, so eve rebuilds the
  // template image instead of reusing a stale one.
  revalidationKey: () => "linkedin-reporter-bootstrap-v1",
  async bootstrap({ use }) {
    const sandbox = await use();
    // Remove macOS .DS_Store files that may have been seeded from the workspace
    // folder — they change frequently and trigger unwanted template rebuilds.
    await sandbox.run({
      command: "find /workspace -name '.DS_Store' -delete 2>/dev/null; true",
    });
    // The reporter only aggregates JSON data — no Playwright or image tools needed.
  },
});
