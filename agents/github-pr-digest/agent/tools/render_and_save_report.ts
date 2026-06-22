import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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

const collectionErrorSchema = z.object({
  repository: z.string(),
  error: z.string(),
});

const inputSchema = z.object({
  runId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  repositories: z.array(z.string()).min(1),
  results: z.array(repositoryResultSchema),
  errors: z.array(collectionErrorSchema).default([]),
});

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .trim();
}

function renderMarkdown(input: z.infer<typeof inputSchema>): string {
  const totals = input.results.reduce(
    (sum, result) => {
      sum.total += result.counts.total;
      sum.open += result.counts.open;
      sum.closed += result.counts.closed;
      sum.merged += result.counts.merged;
      sum.draft += result.counts.draft;
      return sum;
    },
    {
      total: 0,
      open: 0,
      closed: 0,
      merged: 0,
      draft: 0,
    },
  );

  const resultMap = new Map(
    input.results.map((result) => [result.repository, result]),
  );

  const errorMap = new Map(
    input.errors.map((error) => [error.repository, error.error]),
  );

  const lines: string[] = [
    "# GitHub Pull Request Digest",
    "",
    `Date range: ${input.from} to ${input.to}  `,
    `Repositories scanned: ${input.repositories.join(", ")}`,
    "",
    "## Summary",
    "",
    `Total: ${totals.total} · Open: ${totals.open} · Closed: ${totals.closed} · Merged: ${totals.merged} · Draft: ${totals.draft}`,
    "",
    "## Repository Activity",
    "",
  ];

  for (const repository of input.repositories) {
    lines.push(`### ${repository}`, "");

    const collectionError = errorMap.get(repository);

    if (collectionError) {
      lines.push(`Collection failed: ${clean(collectionError)}`, "");
      continue;
    }

    const result = resultMap.get(repository);

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
        `- [#${pullRequest.number}](${pullRequest.url}) ${clean(
          pullRequest.title,
        )} — ${clean(pullRequest.author)} · ${
          pullRequest.state
        }${draftSuffix} · events: ${events}`,
      );
    }

    lines.push("");
  }

  if (input.errors.length > 0) {
    lines.push("## Collection Errors", "");

    for (const error of input.errors) {
      lines.push(
        `- ${clean(error.repository)}: ${clean(error.error)}`,
      );
    }

    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

export default defineTool({
  description:
    "Deterministically render and save the complete GitHub PR digest in the timestamped host and Eve sandbox run directories.",

  inputSchema,

  async execute(input, ctx) {
    const markdown = renderMarkdown(input);

    if (
      !markdown.includes("## Summary") ||
      !markdown.includes("## Repository Activity")
    ) {
      throw new Error("Rendered report failed completeness validation.");
    }

    const relativePath = `runs/${input.runId}/report.md`;
    const sandboxPath = `/workspace/${relativePath}`;

    const sandbox = await ctx.getSandbox();

    await sandbox.run({
      command: `mkdir -p ${JSON.stringify(
        `/workspace/runs/${input.runId}`,
      )}`,
    });

    await sandbox.writeTextFile({
      path: sandboxPath,
      content: markdown,
    });

    const projectRoot = process.env.HOST_REPORT_ROOT ?? process.cwd();

    const hostPath = path.resolve(
      projectRoot,
      "agent",
      "sandbox",
      "workspace",
      relativePath,
    );

    await mkdir(path.dirname(hostPath), {
      recursive: true,
    });

    await writeFile(hostPath, markdown, "utf8");

    return {
      runId: input.runId,
      markdown,
      sandboxPath,
      hostPath,
      bytes: Buffer.byteLength(markdown, "utf8"),
    };
  },
});
