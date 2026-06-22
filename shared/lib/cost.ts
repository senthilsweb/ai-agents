import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";

// ── Cost estimation from a provider-agnostic rate card ─────────────────────
//
// See openspec/adr/0002-cost-matrix.md.
//
// Rates live in shared/cost/rates.yaml and are keyed by the operator's
// configured model ids (not brands). An operator populates the card to match
// the model ids referenced in their .env. Unrated models yield rated:false and
// a zero amount, so missing rates degrade gracefully and never block a run.

export type RateMode = "per_token" | "per_request";

export interface ModelRate {
  mode: RateMode;
  currency: string;
  input_per_1m?: number;
  output_per_1m?: number;
  cache_read_per_1m?: number;
  per_request?: number;
}

export interface RateCard {
  version?: number;
  defaults?: { cache?: { read_discount?: number } };
  models?: Record<string, ModelRate>;
}

export interface CostInput {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  steps: number;
}

export interface ModelCost {
  modelId: string;
  rated: boolean;
  currency?: string;
  amount: number;
  mode?: RateMode;
}

function ratesFilePath(): string {
  if (process.env.COST_RATES_FILE) return process.env.COST_RATES_FILE;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "cost", "rates.yaml");
}

let cached: RateCard | undefined;

/** Load and cache the rate card. Returns an empty card when the file is absent. */
export function loadRateCard(): RateCard {
  if (cached) return cached;
  const file = ratesFilePath();
  if (!existsSync(file)) {
    cached = { models: {} };
    return cached;
  }
  try {
    cached = (parseYaml(readFileSync(file, "utf8")) as RateCard) ?? { models: {} };
  } catch {
    cached = { models: {} };
  }
  return cached;
}

/** Estimate the cost of one model's usage against the rate card. */
export function estimateModelCost(
  modelId: string,
  usage: CostInput,
  card: RateCard = loadRateCard(),
): ModelCost {
  const rate = card.models?.[modelId];
  if (!rate) return { modelId, rated: false, amount: 0 };

  const readDiscount = card.defaults?.cache?.read_discount ?? 0;

  if (rate.mode === "per_request") {
    const amount = (rate.per_request ?? 0) * usage.steps;
    return { modelId, rated: true, currency: rate.currency, amount, mode: rate.mode };
  }

  const inputRate = rate.input_per_1m ?? 0;
  const outputRate = rate.output_per_1m ?? 0;
  const cacheRate = rate.cache_read_per_1m ?? inputRate * readDiscount;

  const amount =
    (usage.inputTokens / 1_000_000) * inputRate +
    (usage.outputTokens / 1_000_000) * outputRate +
    (usage.cacheReadTokens / 1_000_000) * cacheRate;

  return { modelId, rated: true, currency: rate.currency, amount, mode: rate.mode };
}

export interface AggregateCost {
  currency?: string;
  amount: number;
  rated: boolean;
  byModel: ModelCost[];
}

/**
 * Estimate aggregate cost across one or more (modelId, usage) pairs.
 * `rated` is true only when every supplied model has a rate-card entry.
 */
export function estimateCost(
  entries: Array<{ modelId: string; usage: CostInput }>,
  card: RateCard = loadRateCard(),
): AggregateCost {
  const byModel = entries.map((entry) =>
    estimateModelCost(entry.modelId, entry.usage, card),
  );
  const amount = byModel.reduce((sum, model) => sum + model.amount, 0);
  const currency = byModel.find((model) => model.currency)?.currency;
  const rated = byModel.length > 0 && byModel.every((model) => model.rated);
  return { currency, amount, rated, byModel };
}
