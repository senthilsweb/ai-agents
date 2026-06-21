import { defineHook } from "eve/hooks";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const USAGE_DIR = join(tmpdir(), "eve-usage");

function usagePath(sessionId: string): string {
  return join(USAGE_DIR, `${sessionId}.json`);
}

function ensureDir(): void {
  if (!existsSync(USAGE_DIR)) mkdirSync(USAGE_DIR, { recursive: true });
}

interface UsageAccumulator {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  steps: number;
  model?: string;
  updatedAt: string;
}

function loadUsage(sessionId: string): UsageAccumulator {
  const p = usagePath(sessionId);
  if (existsSync(p)) {
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      // fall through to fresh
    }
  }
  return {
    sessionId,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    steps: 0,
    updatedAt: new Date().toISOString(),
  };
}

function saveUsage(u: UsageAccumulator): void {
  ensureDir();
  writeFileSync(usagePath(u.sessionId), JSON.stringify(u, null, 2));
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
          finishReason?: string;
        };

        const usage = data.usage;
        if (!usage) return;

        const acc = loadUsage(sessionId);
        acc.inputTokens += usage.inputTokens ?? 0;
        acc.outputTokens += usage.outputTokens ?? 0;
        acc.cacheReadTokens += usage.cacheReadTokens ?? 0;
        acc.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
        acc.steps += 1;
        acc.updatedAt = new Date().toISOString();
        saveUsage(acc);
      } catch (err) {
        console.error("[usage hook] step.completed error:", err);
      }
    },

    "turn.completed"(_event, ctx) {
      try {
        const sessionId = ctx.session.id;
        const acc = loadUsage(sessionId);
        acc.updatedAt = new Date().toISOString();
        saveUsage(acc);
      } catch (err) {
        console.error("[usage hook] turn.completed error:", err);
      }
    },
  },
});
