import { z } from "zod";

import { CANONICAL_ENTITY_TYPES } from "shared/lib/taxonomy.js";

// ── Generic privacy-classification schemas ─────────────────────────────────
//
// See openspec/changes/add-privacy-classifier/design.md.
//
// These schemas are deliberately generic to privacy engineering — no field
// references any specific downstream consumer. CanonicalEntityTypeSchema is
// built from shared/lib/taxonomy.ts's CANONICAL_ENTITY_TYPES so the Zod enum
// and the normalizer's target vocabulary can never drift apart.

export const CanonicalEntityTypeSchema = z.enum(
  CANONICAL_ENTITY_TYPES as unknown as [string, ...string[]],
);

export const SensitivitySchema = z.enum(["low", "medium", "high", "critical"]);

export const SourceEngineSchema = z.enum(["presidio", "genai"]);

export const DetectionEngineSchema = z.enum([
  "presidio",
  "presidio_genai",
  "openai_privacy_filter",
  "genai_only",
]);
export type DetectionEngine = z.infer<typeof DetectionEngineSchema>;

/** Per-chunk generateObject response schema — the strongly-typed GenAI contract. */
export const PiiFindingSchema = z.object({
  raw_label: z
    .string()
    .describe("The entity type exactly as the model names it, pre-normalization."),
  value_excerpt: z
    .string()
    .max(200)
    .describe("The verbatim matched text (or a short, safely truncated excerpt)."),
  context_snippet: z.string().max(400).optional(),
  confidence: z.number().min(0).max(1),
  sensitivity: SensitivitySchema,
  reasoning: z.string().max(300).optional(),
});
export type PiiFinding = z.infer<typeof PiiFindingSchema>;

export const ChunkPiiDetectionResponseSchema = z.object({
  findings: z.array(PiiFindingSchema),
  chunk_summary: z.string().max(300).optional(),
});
export type ChunkPiiDetectionResponse = z.infer<
  typeof ChunkPiiDetectionResponseSchema
>;

/** A single raw finding, tagged with its origin, before cross-chunk/engine normalization. */
export interface RawFinding {
  raw_label: string;
  value_excerpt: string;
  confidence: number;
  sensitivity: z.infer<typeof SensitivitySchema>;
  source_engine: z.infer<typeof SourceEngineSchema>;
  chunk_id: string;
}

export const NormalizedFindingSchema = z.object({
  canonical_type: CanonicalEntityTypeSchema,
  raw_labels_seen: z.array(z.string()),
  occurrences: z.number().int().min(1),
  chunk_ids: z.array(z.string()),
  sample_excerpts: z.array(z.string()).max(5),
  max_confidence: z.number().min(0).max(1),
  sensitivity: SensitivitySchema,
  source_engines: z.array(SourceEngineSchema),
});
export type NormalizedFinding = z.infer<typeof NormalizedFindingSchema>;

export const ComplianceHitSchema = z.object({
  jurisdiction: z.string(),
  regulation_name: z.string(),
  triggered_by: z.array(CanonicalEntityTypeSchema),
  severity: z.enum(["informational", "moderate", "high"]),
});

export const ComplianceImpactSchema = z.object({
  impacted_jurisdictions: z.array(z.string()),
  hits: z.array(ComplianceHitSchema),
  regime_matrix_version: z.string(),
});
export type ComplianceImpact = z.infer<typeof ComplianceImpactSchema>;

export const ProcessingStatusSchema = z.enum([
  "processed",
  "skipped_out_of_scope",
  "failed",
]);

export const StructuralClassSchema = z.enum([
  "structured_columnar",
  "semi_structured",
  "unstructured",
  "unknown",
]);

export const DocumentClassificationSchema = z.object({
  document: z.object({
    source_path: z.string(),
    file_name: z.string(),
    file_type: z.string(),
    size_bytes: z.number(),
    page_count: z.number().optional(),
    structural_class: StructuralClassSchema,
    processing_status: ProcessingStatusSchema,
    ocr_enabled: z.boolean(),
    extraction_method: z.string(),
    chunk_count: z.number(),
    reason: z.string().optional().describe("Set when processing_status is not 'processed'."),
  }),
  engine: DetectionEngineSchema,
  findings: z.array(NormalizedFindingSchema),
  compliance_impact: ComplianceImpactSchema,
  run: z.object({
    run_id: z.string(),
    started_at: z.string(),
    ended_at: z.string(),
    models: z.record(z.string(), z.string()),
  }),
});
export type DocumentClassification = z.infer<typeof DocumentClassificationSchema>;
