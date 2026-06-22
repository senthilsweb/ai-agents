import { defineTool } from "eve/tools";
import { z } from "zod";

const pullRequestSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  draft: z.boolean(),
  author: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().nullable(),
  mergedAt: z.string().nullable(),
  events: z.array(z.string()),
});

const repositoryResultSchema = z.object({
  repository: z.string(),
  interval: z.object({
    from: z.string(),
    toExclusive: z.string(),
  }),
  counts: z.object({
    total: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
    closed: z.number().int().nonnegative(),
    merged: z.number().int().nonnegative(),
    draft: z.number().int().nonnegative(),
  }),
  pullRequests: z.array(pullRequestSchema),
  diagnostics: z
    .object({
      pagesFetched: z.number().int().nonnegative(),
      fetched: z.number().int().nonnegative(),
    })
    .optional(),
});

const errorSchema = z.object({
  repository: z.string(),
  error: z.string(),
});

const inputSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  repositories: z.array(z.string()).min(1),
  results: z.array(repositoryResultSchema),
  errors: z.array(errorSchema).default([]),
});

function escapeInline(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

export default defineTool({
  description:
    "Deterministically render normalized GitHub pull-request results as a complete Markdown digest.",

  inputSchema,

  async execute({ from, to, repositories, results, errors }) {
    const totals = results.reduce(
      (accumulator, result) => {
        accumulator.total += result.counts.total;
        accumulator.open += result.counts.open;
        accumulator.closed += result.counts.closed;
        accumulator.merged += result.counts.merged;
        accumulator.draft += result.counts.draft;
        return accumulator;
      },
      {
        total: 0,
        open: 0,
        closed: 0,
        merged: 0,
        draft: 0,
      },
    );

    const resultsByRepository = new Map(
      results.map((result) => [result.repository, result]),
    );

    const errorsByRepository = new Map(
      errors.map((error) => [error.repository, error.error]),
    );

    const lines: string[] = [
      "# GitHub Pull Request Digest",
      "",
      `Date range: ${from} to ${to}  `,
      `Repositories scanned: ${repositories.join(", ")}`,
      "",
      "## Summary",
      "",
      `Total: ${totals.total} · Open: ${totals.open} · Closed: ${totals.closed} · Merged: ${totals.merged} · Draft: ${totals.draft}`,
      "",
      "## Repository Activity",
      "",
    ];

    for (const repository of repositories) {
      lines.push(`### ${repository}`, "");

      const result = resultsByRepository.get(repository);
      const collectionError = errorsByRepository.get(repository);

      if (collectionError) {
        lines.push(`Collection failed: ${escapeInline(collectionError)}`, "");
        continue;
      }

      if (!result || result.pullRequests.length === 0) {
        lines.push("No matching PR activity.", "");
        continue;
      }

      for (const pullRequest of result.pullRequests) {
        const events =
          pullRequest.events.length > 0
            ? pullRequest.events.join(", ")
            : "none";

        const draftSuffix = pullRequest.draft ? " · draft" : "";

        lines.push(
          `- [#${pullRequest.number}](${pullRequest.url}) ${escapeInline(
            pullRequest.title,
          )} — ${escapeInline(pullRequest.author)} · ${
            pullRequest.state
          }${draftSuffix} · events: ${events}`,
        );
      }

      lines.push("");
    }

    if (errors.length > 0) {
      lines.push("## Collection Errors", "");

      for (const error of errors) {
        lines.push(
          `- ${error.repository}: ${escapeInline(error.error)}`,
        );
      }

      lines.push("");
    }

    const markdown = `${lines.join("\n").trim()}\n`;

    if (
      markdown.length <= "# GitHub Pull Request Digest\n".length ||
      !markdown.includes("## Summary") ||
      !markdown.includes("## Repository Activity")
    ) {
      throw new Error("Generated report failed completeness validation.");
    }

    return {
      markdown,
      bytes: Buffer.byteLength(markdown, "utf8"),
      totals,
    };
  },
});
