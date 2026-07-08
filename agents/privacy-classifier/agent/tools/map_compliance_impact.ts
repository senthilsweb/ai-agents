import { defineTool } from "eve/tools";
import { z } from "zod";

import { mapToJurisdictions } from "shared/lib/compliance.js";
import { readHostRunArtifact, writeRunArtifact } from "shared/lib/run.js";
import type { CanonicalEntityType } from "shared/lib/taxonomy.js";

import type { NormalizedFinding } from "#lib/schemas.js";

export default defineTool({
  description:
    "Deterministically map normalized PII/NPI findings to impacted compliance " +
    "regimes via the maintained matrix (shared/config/compliance_matrix.yaml). " +
    "Pure lookup, no LLM. Reads findings.normalized.json, writes compliance_impact.json.",
  inputSchema: z.object({
    run_dir: z
      .string()
      .min(1)
      .describe("The run directory, e.g. runs/2026-07-05T14-26-27Z"),
  }),
  async execute({ run_dir }, ctx) {
    const runId = run_dir.replace(/^runs\//, "").replace(/\/+$/, "");
    if (!runId || runId.includes("..") || runId.includes("/")) {
      throw new Error(`Invalid run_dir: ${run_dir}`);
    }

    const raw = await readHostRunArtifact(runId, "findings.normalized.json");
    const { findings } = JSON.parse(raw) as { findings: NormalizedFinding[] };
    const canonicalTypes = findings.map(
      (f) => f.canonical_type as CanonicalEntityType,
    );

    const impact = mapToJurisdictions(canonicalTypes);

    await writeRunArtifact(
      ctx,
      runId,
      "compliance_impact.json",
      JSON.stringify(impact, null, 2) + "\n",
    );

    return {
      compliance_impact_path: "compliance_impact.json",
      impacted_jurisdictions: impact.impacted_jurisdictions,
    };
  },
});
