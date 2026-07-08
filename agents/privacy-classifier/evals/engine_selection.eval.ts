import { defineEval } from "eve/evals";
import { equals } from "eve/evals/expect";

import { extractRunId, readRunJson } from "./lib/run_result.js";

// Staged under agent/sandbox/workspace/inputs/ (auto-mounted into the
// sandbox at /workspace/inputs/), mirroring evals/data/unstructured_prose.txt.
// load_input only accepts sandbox-staged filenames, never a host path — see
// agents/privacy-classifier/agent/tools/load_input.ts.
const fixture = "unstructured_prose.txt";

// Env vars are process-wide for a dev server, so one `eve eval` run can only
// exercise whichever PII_ENGINE is currently configured. To cover all four
// engines, run `eve eval engine_selection` once per PII_ENGINE value (with
// the corresponding .env set), e.g. in a CI matrix.
export default defineEval({
  description:
    "Whichever PII_ENGINE is configured, normalized findings carry exactly " +
    "the source_engine tags that engine implies — never the other engine's.",
  timeoutMs: 180_000,
  async test(t) {
    const engine = process.env.PII_ENGINE;
    if (!engine) throw new Error("PII_ENGINE must be set to run this eval.");

    const turn = await t.send(
      `Classify this document for PII/NPI and compliance impact. File path: ${fixture}`,
    );
    turn.expectOk();
    t.completed();
    t.calledTool("detect_privacy_entities");

    const usesPresidio = engine === "presidio" || engine === "presidio_genai";
    const usesGenai = engine !== "presidio";

    const runId = extractRunId(turn.toolCalls);
    const normalized = readRunJson(runId, "findings.normalized.json") as {
      findings: Array<{ source_engines: string[] }>;
    };
    const seenEngines = new Set(normalized.findings.flatMap((f) => f.source_engines));

    t.check(seenEngines.has("presidio"), equals(usesPresidio));
    t.check(seenEngines.has("genai"), equals(usesGenai));
  },
});
