import { defineTool } from "eve/tools";
import { z } from "zod";

const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function configuredRepositories(): string[] {
  const raw = process.env.GITHUB_REPOSITORIES;
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("GITHUB_REPOSITORIES must be a JSON array of owner/repository strings.");
  }
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
    throw new Error("GITHUB_REPOSITORIES must be a JSON array of strings.");
  }
  return parsed;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseBoundary(value: string, endExclusive: boolean): Date {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${value}`);
  if (dateOnly && endExclusive) parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed;
}

export default defineTool({
  description:
    "Resolve and validate repository names and a UTC report interval. Uses GITHUB_REPOSITORIES and the previous UTC day when values are omitted.",
  inputSchema: z.object({
    repositories: z.array(z.string()).optional(),
    from: z.string().optional().describe("Inclusive ISO date or timestamp."),
    to: z.string().optional().describe("Inclusive ISO date or timestamp; date-only values include the full day."),
    state: z.enum(["all", "open", "closed"]).default("all"),
  }),
  async execute({ repositories, from, to, state }) {
    const now = new Date();
    const today = startOfUtcDay(now);
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    const resolvedRepos = [...new Set((repositories ?? configuredRepositories()).map((r) => r.trim()))];
    if (resolvedRepos.length === 0) {
      throw new Error("No repositories supplied. Pass an array or set GITHUB_REPOSITORIES.");
    }
    const invalid = resolvedRepos.filter((repo) => !repoPattern.test(repo));
    if (invalid.length) throw new Error(`Invalid repositories: ${invalid.join(", ")}`);
    if (resolvedRepos.length > 20) throw new Error("This teaching example supports at most 20 repositories per run.");

    const fromInput = from ?? yesterday.toISOString().slice(0, 10);
    const toInput = to ?? fromInput;
    const fromDate = parseBoundary(fromInput, false);
    const toExclusive = parseBoundary(toInput, true);
    if (toExclusive <= fromDate) throw new Error("The end of the interval must be after the start.");

    return {
      repositories: resolvedRepos,
      from: fromDate.toISOString(),
      toExclusive: toExclusive.toISOString(),
      displayFrom: fromInput,
      displayTo: toInput,
      state,
      eventFields: ["created_at", "updated_at", "closed_at", "merged_at"],
    };
  },
});
