import { defineTool } from "eve/tools";
import { z } from "zod";

import { readHostRunArtifact, writeRunArtifact } from "shared/lib/run.js";
import { normalizeLabel } from "shared/lib/taxonomy.js";

import type { NormalizedFinding, RawFinding } from "#lib/schemas.js";

// ── Cross-chunk, cross-engine normalization ────────────────────────────────
//
// See openspec/changes/add-privacy-classifier/design.md. Pure lookup + union
// — no LLM. shared/lib/taxonomy.ts resolves both free-text GenAI phrasing and
// Presidio's native vocabulary to one canonical taxonomy.

const SENSITIVITY_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function maxSensitivity(a: string, b: string): string {
  return (SENSITIVITY_RANK[a] ?? 0) >= (SENSITIVITY_RANK[b] ?? 0) ? a : b;
}

export default defineTool({
  description:
    "Deterministically normalize raw PII/NPI findings (from any GenAI model's " +
    "free-text phrasing, or Presidio's native vocabulary) to the canonical " +
    "taxonomy, then union and dedupe across chunks and engines. No LLM. " +
    "Reads pii_raw/merged.json, writes findings.normalized.json.",
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

    const raw = await readHostRunArtifact(runId, "pii_raw/merged.json");
    const { findings } = JSON.parse(raw) as { findings: RawFinding[] };

    const byType = new Map<string, NormalizedFinding>();
    for (const finding of findings) {
      const canonicalType = normalizeLabel(finding.raw_label);
      const existing = byType.get(canonicalType);
      if (!existing) {
        byType.set(canonicalType, {
          canonical_type: canonicalType as NormalizedFinding["canonical_type"],
          raw_labels_seen: [finding.raw_label],
          occurrences: 1,
          chunk_ids: [finding.chunk_id],
          sample_excerpts: finding.value_excerpt ? [finding.value_excerpt] : [],
          max_confidence: finding.confidence,
          sensitivity: finding.sensitivity,
          source_engines: [finding.source_engine],
        });
        continue;
      }

      if (!existing.raw_labels_seen.includes(finding.raw_label)) {
        existing.raw_labels_seen.push(finding.raw_label);
      }
      existing.occurrences += 1;
      if (!existing.chunk_ids.includes(finding.chunk_id)) {
        existing.chunk_ids.push(finding.chunk_id);
      }
      if (
        existing.sample_excerpts.length < 5 &&
        finding.value_excerpt &&
        !existing.sample_excerpts.includes(finding.value_excerpt)
      ) {
        existing.sample_excerpts.push(finding.value_excerpt);
      }
      existing.max_confidence = Math.max(existing.max_confidence, finding.confidence);
      existing.sensitivity = maxSensitivity(
        existing.sensitivity,
        finding.sensitivity,
      ) as NormalizedFinding["sensitivity"];
      if (!existing.source_engines.includes(finding.source_engine)) {
        existing.source_engines.push(finding.source_engine);
      }
    }

    const normalized = Array.from(byType.values()).sort((a, b) =>
      a.canonical_type.localeCompare(b.canonical_type),
    );

    await writeRunArtifact(
      ctx,
      runId,
      "findings.normalized.json",
      JSON.stringify({ findings: normalized }, null, 2) + "\n",
    );

    return {
      findings_path: "findings.normalized.json",
      canonical_types_found: normalized.map((f) => f.canonical_type),
      raw_finding_count: findings.length,
      normalized_finding_count: normalized.length,
    };
  },
});
