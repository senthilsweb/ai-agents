import { createBaseSandbox } from "shared/sandbox/base-sandbox.js";

// The Pairwise Designer has an isolated sandbox. It only reads JSON passed
// inline in the delegation message — no file I/O needed at runtime.
export default createBaseSandbox({
  revalidationKey: "api-test-generator-pairwise-designer-v1",
});
