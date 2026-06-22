import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { defineTool } from "eve/tools";
import { z } from "zod";

interface PullRequest {
  number: number;
  title: string;
  url: string;
  state: string;
  draft: boolean;
  author: string;
  events: string[];
}

interface RepositoryResult {
  repository: string;
  counts: {
    total: number;
    open: number;
    closed: number;
    merged: number;
    draft: number;
  };
  pullRequests: PullRequest[];
}

const inputSchema = z.object({
  runId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  repositories: z.array(z.string()).min(1),
});

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .trim();
}

function fileNameFor(repository: string): string {
  return `${repository.replace("/", "__")}.json`;
}

export default defineTool({
  description:
    "Read persisted per-repository collector files, deterministically render the complete Markdown digest, and save it to the timestamped host and root sandbox run directories.",

  inputSchema,

  async execute(
    { runId, from, to, repositories },
    ctx,
  ) {
    const projectRoot =
      process.env.HOST_REPORT_ROOT ?? process.cwd();

    const hostRunDirectory = path.resolve(
      projectRoot,
      "agent",
      "sandbox",
      "workspace",
      "runs",
      runId,
    );

    const results: RepositoryResult[] = [];
    const errors: Array<{
      repository: string;
      error: string;
    }> = [];

    for (const repository of repositories) {
      const repositoryPath = path.join(
        hostRunDirectory,
        "repositories",
        fileNameFor(repository),
      );

      try {
        const raw = await readFile(repositoryPath, "utf8");
        results.push(JSON.parse(raw) as RepositoryResult);
      } catch (error) {
        errors.push({
          repository,
          error:
            error instanceof Error
              ? `Collector output missing or invalid: ${error.message}`
              : "Collector output missing or invalid.",
        });
      }
    }

    const totals = results.reduce(
      (sum, result) => {
        sum.total += Number(result.counts?.total ?? 0);
        sum.open += Number(result.counts?.open ?? 0);
        sum.closed += Number(result.counts?.closed ?? 0);
        sum.merged += Number(result.counts?.merged ?? 0);
        sum.draft += Number(result.counts?.draft ?? 0);
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
      results.map((result) => [
        result.repository,
        result,
      ]),
    );

    const errorMap = new Map(
      errors.map((error) => [
        error.repository,
        error.error,
      ]),
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

      const collectionError = errorMap.get(repository);

      if (collectionError) {
        lines.push(
          `Collection failed: ${clean(collectionError)}`,
          "",
        );
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

        const draft = pullRequest.draft
          ? " · draft"
          : "";

        lines.push(
          `- [#${pullRequest.number}](${pullRequest.url}) ${clean(
            pullRequest.title,
          )} — ${clean(pullRequest.author)} · ${
            pullRequest.state
          }${draft} · events: ${events}`,
        );
      }

      lines.push("");
    }

    if (errors.length > 0) {
      lines.push("## Collection Errors", "");

      for (const error of errors) {
        lines.push(
          `- ${clean(error.repository)}: ${clean(error.error)}`,
        );
      }

      lines.push("");
    }

    const markdown = `${lines.join("\n").trim()}\n`;

    const hostPath = path.join(
      hostRunDirectory,
      "report.md",
    );

    await mkdir(hostRunDirectory, {
      recursive: true,
    });

    await writeFile(hostPath, markdown, "utf8");

    const sandboxPath = `/workspace/runs/${runId}/report.md`;
    const sandbox = await ctx.getSandbox();

    await sandbox.run({
      command: `mkdir -p ${JSON.stringify(
        `/workspace/runs/${runId}`,
      )}`,
    });

    await sandbox.writeTextFile({
      path: sandboxPath,
      content: markdown,
    });

    return {
      runId,
      markdown,
      sandboxPath,
      hostPath,
      bytes: Buffer.byteLength(markdown, "utf8"),
      successfulRepositories: results.length,
      failedRepositories: errors.length,
    };
  },
});
