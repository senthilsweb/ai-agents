import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

// ── Canonical PII/NPI taxonomy + label normalization ───────────────────────
//
// See openspec/changes/add-privacy-classifier/design.md.
//
// Every detection engine (a GenAI model's free-text phrasing, or Presidio's
// native entity-type vocabulary) speaks its own label dialect. This module is
// the single normalizer: it loads an operator-editable YAML alias table
// (shared/config/label_aliases.yaml by default, override via
// LABEL_ALIASES_FILE) and resolves any raw label to one canonical type.
// Unrecognized labels degrade to the configured fallback (default UNKNOWN)
// rather than throwing, so an unfamiliar model's phrasing never fails a run.

export const CANONICAL_ENTITY_TYPES = [
  "PERSON_NAME",
  "EMAIL_ADDRESS",
  "PHONE_NUMBER",
  "PHYSICAL_ADDRESS",
  "ZIP_POSTAL_CODE",
  "GEOLOCATION",
  "DATE_OF_BIRTH",
  "GENDER",
  "RACE_ETHNICITY",
  "RELIGIOUS_BELIEF",
  "SEXUAL_ORIENTATION",
  "POLITICAL_OPINION",
  "GOVERNMENT_ID_SSN",
  "GOVERNMENT_ID_NATIONAL",
  "GOVERNMENT_ID_PASSPORT",
  "GOVERNMENT_ID_DRIVER_LICENSE",
  "GOVERNMENT_ID_TAX",
  "FINANCIAL_ACCOUNT_NUMBER",
  "CREDIT_CARD_NUMBER",
  "BANK_ROUTING_NUMBER",
  "IBAN",
  "CRYPTO_WALLET_ADDRESS",
  "HEALTH_CONDITION",
  "HEALTH_RECORD_ID",
  "BIOMETRIC_IDENTIFIER",
  "GENETIC_DATA",
  "IP_ADDRESS",
  "MAC_ADDRESS",
  "DEVICE_IDENTIFIER",
  "LOGIN_CREDENTIAL",
  "EMPLOYMENT_INFO",
  "EDUCATION_INFO",
  "VEHICLE_IDENTIFIER",
  "MINOR_DATA",
  "OTHER_SENSITIVE",
  "UNKNOWN",
] as const;

export type CanonicalEntityType = (typeof CANONICAL_ENTITY_TYPES)[number];

const KNOWN_TYPES = new Set<string>(CANONICAL_ENTITY_TYPES);

export interface TaxonomyConfig {
  version?: number;
  fallback?: string;
  canonical_types?: Record<string, { aliases?: string[] }>;
}

function taxonomyFilePath(): string {
  if (process.env.LABEL_ALIASES_FILE) return process.env.LABEL_ALIASES_FILE;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "config", "label_aliases.yaml");
}

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

let cachedConfig: TaxonomyConfig | undefined;
let cachedAliasMap: Map<string, CanonicalEntityType> | undefined;

function loadTaxonomyConfig(): TaxonomyConfig {
  if (cachedConfig) return cachedConfig;
  const file = taxonomyFilePath();
  if (!existsSync(file)) {
    cachedConfig = { canonical_types: {} };
    return cachedConfig;
  }
  try {
    cachedConfig =
      (parseYaml(readFileSync(file, "utf8")) as TaxonomyConfig) ?? {
        canonical_types: {},
      };
  } catch {
    cachedConfig = { canonical_types: {} };
  }
  return cachedConfig;
}

function buildAliasMap(): Map<string, CanonicalEntityType> {
  if (cachedAliasMap) return cachedAliasMap;
  const config = loadTaxonomyConfig();
  const map = new Map<string, CanonicalEntityType>();
  for (const [canonical, entry] of Object.entries(
    config.canonical_types ?? {},
  )) {
    if (!KNOWN_TYPES.has(canonical)) continue; // config can't invent new types
    const canonicalType = canonical as CanonicalEntityType;
    map.set(normalizeKey(canonical), canonicalType);
    for (const alias of entry.aliases ?? []) {
      map.set(normalizeKey(alias), canonicalType);
    }
  }
  cachedAliasMap = map;
  return map;
}

/** Reset cached config/alias-map (test-only; config is env-path-cached at module scope). */
export function _resetTaxonomyCacheForTests(): void {
  cachedConfig = undefined;
  cachedAliasMap = undefined;
}

/**
 * Normalize any raw entity-type label — free-text LLM phrasing or Presidio's
 * native vocabulary — to the canonical taxonomy. Unknown labels resolve to
 * the configured fallback (default "UNKNOWN"), never throw.
 */
export function normalizeLabel(raw: string): CanonicalEntityType {
  const config = loadTaxonomyConfig();
  const fallback = KNOWN_TYPES.has(config.fallback ?? "")
    ? (config.fallback as CanonicalEntityType)
    : "UNKNOWN";
  if (!raw || !raw.trim()) return fallback;
  return buildAliasMap().get(normalizeKey(raw)) ?? fallback;
}
