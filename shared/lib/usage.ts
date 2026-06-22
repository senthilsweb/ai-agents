import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Token-usage accumulation (shared by the usage hook and read_usage) ─────
//
// See openspec/adr/0001-shared-agent-runtime-kit.md §5.
//
// The usage hook writes one JSON file per session under <tmpdir>/eve-usage.
// Tools (which run in the same host process during `eve dev`) read those files
// to surface token counts in run metrics. This is the same mechanism proven in
// the diagram-generator agent.

export const USAGE_DIR = join(tmpdir(), "eve-usage");

export interface UsageAccumulator {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  steps: number;
  model?: string;
  startedAt?: string;
  updatedAt: string;
  /** Set true when a configured soft budget (steps or wall-clock) was crossed. */
  budgetExceeded?: boolean;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  steps: number;
  sessions: number;
  budgetExceeded: boolean;
}

export function usagePath(sessionId: string): string {
  return join(USAGE_DIR, `${sessionId}.json`);
}

/** Read every per-session usage record in the current run's tmp directory. */
export function readAllUsage(): UsageAccumulator[] {
  if (!existsSync(USAGE_DIR)) return [];
  const records: UsageAccumulator[] = [];
  for (const file of readdirSync(USAGE_DIR)) {
    if (!file.endsWith(".json") || file.startsWith("run-")) continue;
    try {
      records.push(JSON.parse(readFileSync(join(USAGE_DIR, file), "utf8")));
    } catch {
      // skip malformed files
    }
  }
  return records;
}

/** Read a single session's usage record, if present. */
export function readUsage(sessionId: string): UsageAccumulator | undefined {
  const p = usagePath(sessionId);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return undefined;
  }
}

/** Sum a set of usage records into run-level totals. */
export function sumUsage(records: UsageAccumulator[]): UsageTotals {
  return records.reduce<UsageTotals>(
    (totals, record) => {
      totals.inputTokens += record.inputTokens ?? 0;
      totals.outputTokens += record.outputTokens ?? 0;
      totals.cacheReadTokens += record.cacheReadTokens ?? 0;
      totals.cacheWriteTokens += record.cacheWriteTokens ?? 0;
      totals.steps += record.steps ?? 0;
      totals.sessions += 1;
      totals.budgetExceeded = totals.budgetExceeded || !!record.budgetExceeded;
      return totals;
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      steps: 0,
      sessions: 0,
      budgetExceeded: false,
    },
  );
}
