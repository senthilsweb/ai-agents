import { createBaseSandbox } from "shared/sandbox/base-sandbox.js";

// The orchestrator sandbox holds the run folder and installs Newman for
// collection execution. Swagger-parser and Newman are installed once and
// cached across sessions by the revalidation key.
export default createBaseSandbox({
  revalidationKey: "api-test-generator-bootstrap-v1",
  extraBootstrap: async (sandbox) => {
    await sandbox.run({
      command:
        "npm init -y >/dev/null 2>&1 && " +
        "npm install newman swagger-parser >/dev/null 2>&1 || " +
        "echo 'bootstrap attempted'",
    });
  },
});
