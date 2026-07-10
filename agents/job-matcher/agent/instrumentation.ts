import { createAgentInstrumentation } from "shared/lib/instrumentation.js";

// See openspec/changes/add-job-matcher/design.md "Telemetry" and the
// "Correction" note there on run-id span-attribute stamping. `attributes`
// must be side-effect-free / env-read-only (shared/lib/instrumentation.ts
// enforces this by contract — it runs on every step), so it can only
// surface data already present on the callback's `input`, not a
// business-level run_id minted by our own create_run tool mid-turn.
export default createAgentInstrumentation({
  attributes: (input) => ({
    "job_matcher.channel_kind": input.channel.kind,
    "job_matcher.step_index": String(input.step.index),
  }),
});
