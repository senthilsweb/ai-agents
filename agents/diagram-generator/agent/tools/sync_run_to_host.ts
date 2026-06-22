// Canonical end-of-run copy-back. Implementation lives in the shared Agent
// Runtime Kit (see openspec/adr/0001-shared-agent-runtime-kit.md §2). Copies
// every file in the sandbox run folder back to the host workspace, including
// the binary diagram preview png.
export { default } from "shared/tools/sync_run_to_host.js";
