import { createBaseSandbox } from "shared/sandbox/base-sandbox.js";

// The renderer self-verifies with a headless screenshot, so its isolated
// sandbox needs a browser. The shared base sandbox pins the Eve image and
// purges .DS_Store; the extra bootstrap installs Playwright + Chromium (cached
// across sessions by the revalidation key).
export default createBaseSandbox({
  revalidationKey: "renderer-bootstrap-v3",
  extraBootstrap: async (sandbox) => {
    await sandbox.run({
      command:
        "npm init -y >/dev/null 2>&1 && " +
        "npm install playwright >/dev/null 2>&1 && " +
        "npx playwright install --with-deps chromium >/dev/null 2>&1 || " +
        "echo 'playwright bootstrap attempted'",
    });
  },
});
