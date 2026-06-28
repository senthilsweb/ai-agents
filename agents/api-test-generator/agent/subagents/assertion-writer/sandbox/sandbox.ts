import { createBaseSandbox } from "shared/sandbox/base-sandbox.js";

// The Assertion Writer has an isolated sandbox. It works purely from
// inline JSON passed in the delegation message — no file I/O needed.
export default createBaseSandbox({
  revalidationKey: "api-test-generator-assertion-writer-v1",
});
