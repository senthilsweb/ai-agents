import { createBaseSandbox } from "shared/sandbox/base-sandbox.js";

// The cover generator only reads/writes run artifacts (image bytes + text), so
// the shared base sandbox (image pin + .DS_Store purge) is sufficient — no
// browser bootstrap. Bump the revalidation key when the bootstrap changes.
export default createBaseSandbox({
  revalidationKey: "linkedin-cover-bootstrap-v2",
});
