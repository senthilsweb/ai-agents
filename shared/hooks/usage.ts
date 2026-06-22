import { defineHook } from "eve/hooks";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";

import { USAGE_DIR, usagePath, type UsageAccumulator } from "shared/lib/usage.js";

// ── Usage hook ─────────────────────────────────────────────────────────────
//
// See openspec/adr/0001-shared-agent-runtime-kit.md §5.
//
// Observes step/turn completion and accumulates token usage per session under
// <tmpdir>/eve-usage/<sessionId>.json. Run metrics (summary.json) are built
// from these records. The hook also tracks a SOFT budget: Eve's public API
// exposes no hard per-agent step ceiling, so loop discipline is enforced by
// model selection (non-reasoning subagents) and made auditable here — when a
// configured step or wall-clock budget is crossed, the record is flagged and a
// warning is logged. Configure via RUN_STEP_BUDGET and RUN_WALL_CLOCK_BUDGET_S.

function ensureDir(): void {
  if (!existsSync(USAGE_DIR)) mkdirSync(USAGE_DIR, { recursive: true });
}

function loadUsage(sessionId: string): UsageAccumulator {
  const p = usagePath(sessionId);
  if (existsSync(p)) {
    try {
      return JSON.parse(readFileSync(p, "utf8")) as UsageAccumulator;
    } catch {
      // fall through to a fresh accumulator
    }
  }
  const now = new Date().toISOString();
  return {
    sessionId,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    steps: 0,
    startedAt: now,
    updatedAt: now,
  };
}

function saveUsage(usage: UsageAccumulator): void {
  ensureDir();
  writeFileSync(usagePath(usage.sessionId), JSON.stringify(usage, null, 2));
}

function intEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function evaluateBudget(usage: UsageAccumulator): void {
  const stepBudget = intEnv("RUN_STEP_BUDGET");
  const wallBudget = intEnv("RUN_WALL_CLOCK_BUDGET_S");
  const elapsedSeconds = usage.startedAt
    ? (Date.now() - Date.parse(usage.startedAt)) / 1000
    : 0;
  const overStep = stepBudget !== undefined && usage.steps > stepBudget;
  const overWall = wallBudget !== undefined && elapsedSeconds > wallBudget;
  if ((overStep || overWall) && !usage.budgetExceeded) {
    usage.budgetExceeded = true;
    console.warn(
      `[usage hook] session ${usage.sessionId} exceeded soft budget ` +
        `(steps=${usage.steps}, elapsed=${elapsedSeconds.toFixed(0)}s, ` +
        `stepBudget=${stepBudget ?? "-"}, wallClockBudget=${wallBudget ?? "-"}s).`,
    );
  }
}

export default defineHook({
  events: {
    "step.completed"(event, ctx) {
      try {
        const sessionId = ctx.session.id;
        const data = event.data as {
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            cacheReadTokens?: number;
            cacheWriteTokens?: number;
          };
          model?: string;
          modelId?: string;
        };
        const usage = data.usage;
        if (!usage) return;

        const acc = loadUsage(sessionId);
        acc.inputTokens += usage.inputTokens ?? 0;
        acc.outputTokens += usage.outputTokens ?? 0;
        acc.cacheReadTokens += usage.cacheReadTokens ?? 0;
        acc.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
        acc.steps += 1;
        acc.model = data.model ?? data.modelId ?? acc.model;
        acc.updatedAt = new Date().toISOString();
        evaluateBudget(acc);
        saveUsage(acc);
      } catch (error) {
        console.error("[usage hook] step.completed error:", error);
      }
    },

    "turn.completed"(_event, ctx) {
      try {
        const acc = loadUsage(ctx.session.id);
        acc.updatedAt = new Date().toISOString();
        evaluateBudget(acc);
        saveUsage(acc);
      } catch (error) {
        console.error("[usage hook] turn.completed error:", error);
      }
    },
  },
});
