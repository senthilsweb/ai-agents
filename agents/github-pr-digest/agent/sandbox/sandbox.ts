import { createBaseSandbox } from "shared/sandbox/base-sandbox.js";

// github-pr-digest only reads/writes text run artifacts, so the shared base
// sandbox (image pin + .DS_Store purge) is sufficient — no browser bootstrap.
// Bump the revalidation key when the bootstrap or seeded files change.
export default createBaseSandbox({
  revalidationKey: "github-pr-digest-bootstrap-v1",
});
