import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import type { CanonicalEntityType } from "./taxonomy.js";

// ── Deterministic compliance-impact mapping ────────────────────────────────
//
// See openspec/changes/add-privacy-classifier/design.md.
//
// Maps normalized canonical PII/NPI types to impacted compliance regimes via
// a maintained, operator-editable YAML matrix (shared/config/
// compliance_matrix.yaml by default, override via COMPLIANCE_MATRIX_FILE).
// Pure lookup — never an LLM inference — so the mapping is auditable and
// reproducible. Adding a jurisdiction or widening coverage is a YAML edit,
// never a code change.

export interface JurisdictionInfo {
  regulation_name: string;
  region?: string;
}

export interface ComplianceMatrixConfig {
  version?: number;
  jurisdictions?: Record<string, JurisdictionInfo>;
  mappings?: Record<string, string[]>;
  default?: string[];
}

export type ComplianceSeverity = "informational" | "moderate" | "high";

export interface ComplianceHit {
  jurisdiction: string;
  regulation_name: string;
  triggered_by: CanonicalEntityType[];
  severity: ComplianceSeverity;
}

export interface ComplianceImpact {
  impacted_jurisdictions: string[];
  hits: ComplianceHit[];
  regime_matrix_version: string;
}

// Canonical types that raise severity to "high" regardless of jurisdiction —
// government IDs, health/biometric/genetic data, GDPR-style special
// categories, financial account numbers, and minor data. Everything else
// that still triggers a jurisdiction is "moderate".
const HIGH_SEVERITY_TYPES = new Set<string>([
  "GOVERNMENT_ID_SSN",
  "GOVERNMENT_ID_NATIONAL",
  "GOVERNMENT_ID_PASSPORT",
  "HEALTH_CONDITION",
  "HEALTH_RECORD_ID",
  "BIOMETRIC_IDENTIFIER",
  "GENETIC_DATA",
  "RACE_ETHNICITY",
  "RELIGIOUS_BELIEF",
  "SEXUAL_ORIENTATION",
  "POLITICAL_OPINION",
  "MINOR_DATA",
  "CREDIT_CARD_NUMBER",
  "FINANCIAL_ACCOUNT_NUMBER",
]);

function complianceFilePath(): string {
  if (process.env.COMPLIANCE_MATRIX_FILE) return process.env.COMPLIANCE_MATRIX_FILE;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "config", "compliance_matrix.yaml");
}

let cached: ComplianceMatrixConfig | undefined;

function loadComplianceMatrix(): ComplianceMatrixConfig {
  if (cached) return cached;
  const file = complianceFilePath();
  if (!existsSync(file)) {
    cached = { jurisdictions: {}, mappings: {} };
    return cached;
  }
  try {
    cached =
      (parseYaml(readFileSync(file, "utf8")) as ComplianceMatrixConfig) ?? {
        jurisdictions: {},
        mappings: {},
      };
  } catch {
    cached = { jurisdictions: {}, mappings: {} };
  }
  return cached;
}

/** Reset the cached matrix (test-only). */
export function _resetComplianceCacheForTests(): void {
  cached = undefined;
}

function severityFor(canonicalTypes: CanonicalEntityType[]): ComplianceSeverity {
  return canonicalTypes.some((type) => HIGH_SEVERITY_TYPES.has(type))
    ? "high"
    : "moderate";
}

/**
 * Deterministically map a set of normalized canonical entity types to the
 * compliance regimes they implicate. Pure lookup against the configured
 * matrix — no LLM call.
 */
export function mapToJurisdictions(
  canonicalTypes: CanonicalEntityType[],
): ComplianceImpact {
  const config = loadComplianceMatrix();
  const version = String(config.version ?? "1");
  const uniqueTypes = Array.from(new Set(canonicalTypes));

  const byJurisdiction = new Map<string, Set<CanonicalEntityType>>();
  for (const type of uniqueTypes) {
    const jurisdictions = config.mappings?.[type] ?? config.default ?? [];
    for (const jurisdiction of jurisdictions) {
      if (!byJurisdiction.has(jurisdiction)) {
        byJurisdiction.set(jurisdiction, new Set());
      }
      byJurisdiction.get(jurisdiction)!.add(type);
    }
  }

  const hits: ComplianceHit[] = Array.from(byJurisdiction.entries())
    .map(([jurisdiction, types]) => {
      const info = config.jurisdictions?.[jurisdiction];
      const triggered_by = Array.from(types);
      return {
        jurisdiction,
        regulation_name: info?.regulation_name ?? jurisdiction,
        triggered_by,
        severity: severityFor(triggered_by),
      };
    })
    .sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));

  return {
    impacted_jurisdictions: hits.map((hit) => hit.jurisdiction),
    hits,
    regime_matrix_version: version,
  };
}
