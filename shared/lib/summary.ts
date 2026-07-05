import { estimateCost, type AggregateCost } from "shared/lib/cost.js";
import { readAllUsage, sumUsage, type UsageAccumulator } from "shared/lib/usage.js";

// ── Run summary (summary.json) ─────────────────────────────────────────────
//
// See openspec/adr/0001-shared-agent-runtime-kit.md §5.
//
// A run summary is mandatory output for every agent run. It records token
// usage (orchestrator + every subagent session), an estimated cost from the
// rate card, the model ids used, and any soft-budget overrun — so cost and
// loop behaviour are always auditable.

export interface SessionSummary {
  sessionId: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  steps: number;
  budgetExceeded: boolean;
}

export interface ObjectStoreUpload {
  path: string;
  size: number;
  publicUrl?: string;
}

/**
 * Where a run folder landed in S3-compatible object storage. Populated by
 * the shared `upload_run_to_object_store` tool, which patches summary.json
 * after render_and_save_report has written it (the upload result cannot
 * exist yet when the summary is first built).
 */
export interface ObjectStoreArtifacts {
  bucket: string;
  prefix: string;
  uploaded: ObjectStoreUpload[];
}

export interface RunSummary {
  runId: string;
  generatedAt: string;
  models?: Record<string, string>;
  /** Optional artifact locations beyond the local run folder. */
  artifacts?: { objectStore?: ObjectStoreArtifacts };
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    steps: number;
    sessions: number;
  };
  perSession: SessionSummary[];
  cost: AggregateCost;
  budget: {
    steps?: number;
    wallClockSeconds?: number;
    exceeded: boolean;
  };
}

export interface BuildRunSummaryInput {
  runId: string;
  /** role → model id, for display in the summary (e.g. { orchestrator, scout }). */
  models?: Record<string, string>;
  /** Model id used to cost a session that has no recorded model. */
  fallbackModelId?: string;
  /** Soft budget thresholds (observability only; see usage hook). */
  budget?: { steps?: number; wallClockSeconds?: number };
}

function toSessionSummary(record: UsageAccumulator): SessionSummary {
  return {
    sessionId: record.sessionId,
    model: record.model,
    inputTokens: record.inputTokens ?? 0,
    outputTokens: record.outputTokens ?? 0,
    cacheReadTokens: record.cacheReadTokens ?? 0,
    cacheWriteTokens: record.cacheWriteTokens ?? 0,
    steps: record.steps ?? 0,
    budgetExceeded: !!record.budgetExceeded,
  };
}

/**
 * Build the run summary from accumulated per-session usage and the rate card.
 * Reads usage records written by the usage hook for the current run.
 */
export function buildRunSummary(input: BuildRunSummaryInput): RunSummary {
  const records = readAllUsage();
  const totals = sumUsage(records);
  const perSession = records.map(toSessionSummary);

  const costEntries = perSession.map((session) => ({
    modelId: session.model ?? input.fallbackModelId ?? "unknown",
    usage: {
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      cacheReadTokens: session.cacheReadTokens,
      steps: session.steps,
    },
  }));

  return {
    runId: input.runId,
    generatedAt: new Date().toISOString(),
    models: input.models,
    totals: {
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheWriteTokens: totals.cacheWriteTokens,
      steps: totals.steps,
      sessions: totals.sessions,
    },
    perSession,
    cost: estimateCost(costEntries),
    budget: {
      steps: input.budget?.steps,
      wallClockSeconds: input.budget?.wallClockSeconds,
      exceeded: totals.budgetExceeded,
    },
  };
}
