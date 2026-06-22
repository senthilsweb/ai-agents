import { defineTool } from "eve/tools";
import { z } from "zod";

import { modelIdFor } from "shared/lib/model.js";
import { readHostRunArtifact, writeRunArtifact } from "shared/lib/run.js";
import { buildRunSummary } from "shared/lib/summary.js";

interface NormalizedReview {
  reviewer: string;
  state: string;
  submittedAt: string | null;
  url: string;
}

interface NormalizedComment {
  id: number;
  type: "issue" | "review";
  author: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  path: string | null;
  body: string;
}

interface PullRequest {
  number: number;
  title: string;
  url: string;
  state: string;
  draft: boolean;
  author: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  closedAt?: string | null;
  mergedAt?: string | null;
  events: string[];
  headSha?: string | null;
  mergeCommitSha?: string | null;
  mergedBy?: string | null;
  commitCount?: number | null;
  commentCount?: number | null;
  reviewCommentCount?: number | null;
  additions?: number | null;
  deletions?: number | null;
  changedFiles?: number | null;
  approvedBy?: string[];
  approvedAt?: string | null;
  approvals?: Array<{ reviewer: string; submittedAt: string | null }>;
  reviews?: NormalizedReview[];
  comments?: NormalizedComment[];
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

/**
 * One flat, DB-ready row per pull request. This is the CANONICAL raw dataset
 * (pull_requests.jsonl / .csv) from which report.md is rendered, so the report
 * and the data never diverge. Every column is a scalar — load it straight into
 * any relational/columnar store.
 */
interface PullRequestRow {
  run_id: string;
  generated_at: string;
  from_date: string;
  to_date: string;
  repository: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  state: string;
  draft: boolean;
  author: string;
  created_at: string;
  updated_at: string;
  closed_at: string;
  merged_at: string;
  merged_by: string;
  approved_by: string;
  approved_at: string;
  head_sha: string;
  merge_commit_sha: string;
  commit_count: number | "";
  comment_count: number | "";
  review_comment_count: number | "";
  additions: number | "";
  deletions: number | "";
  changed_files: number | "";
  events: string;
}

/** One flat row per review/approval action across all PRs. */
interface ReviewRow {
  run_id: string;
  generated_at: string;
  repository: string;
  owner: string;
  repo: string;
  pr_number: number;
  reviewer: string;
  state: string;
  submitted_at: string;
  url: string;
}

/** One flat row per comment (issue or review/inline) across all PRs. */
interface CommentRow {
  run_id: string;
  generated_at: string;
  repository: string;
  owner: string;
  repo: string;
  pr_number: number;
  comment_id: number;
  type: string;
  author: string;
  created_at: string;
  updated_at: string;
  path: string;
  url: string;
  body: string;
}

const ROW_COLUMNS: Array<keyof PullRequestRow> = [
  "run_id",
  "generated_at",
  "from_date",
  "to_date",
  "repository",
  "owner",
  "repo",
  "number",
  "title",
  "url",
  "state",
  "draft",
  "author",
  "created_at",
  "updated_at",
  "closed_at",
  "merged_at",
  "merged_by",
  "approved_by",
  "approved_at",
  "head_sha",
  "merge_commit_sha",
  "commit_count",
  "comment_count",
  "review_comment_count",
  "additions",
  "deletions",
  "changed_files",
  "events",
];

const REVIEW_COLUMNS: Array<keyof ReviewRow> = [
  "run_id",
  "generated_at",
  "repository",
  "owner",
  "repo",
  "pr_number",
  "reviewer",
  "state",
  "submitted_at",
  "url",
];

const COMMENT_COLUMNS: Array<keyof CommentRow> = [
  "run_id",
  "generated_at",
  "repository",
  "owner",
  "repo",
  "pr_number",
  "comment_id",
  "type",
  "author",
  "created_at",
  "updated_at",
  "path",
  "url",
  "body",
];

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

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv<T extends object>(
  rows: T[],
  columns: Array<keyof T>,
): string {
  const header = columns.join(",");
  const body = rows.map((row) =>
    columns.map((column) => csvCell(row[column])).join(","),
  );
  return `${[header, ...body].join("\n")}\n`;
}

function toJsonl(rows: unknown[]): string {
  return rows.length > 0
    ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`
    : "";
}

export default defineTool({
  description:
    "Read persisted per-repository collector files, emit the canonical flattened datasets (pull_requests, pr_reviews, pr_comments as .jsonl + .csv), deterministically render report.md FROM that dataset, and write a summary.json run-metrics file — all into the timestamped sandbox and host run directories.",

  inputSchema,

  async execute({ runId, from, to, repositories }, ctx) {
    const results: RepositoryResult[] = [];
    const errors: Array<{ repository: string; error: string }> = [];

    for (const repository of repositories) {
      try {
        const raw = await readHostRunArtifact(
          runId,
          `repositories/${fileNameFor(repository)}`,
        );
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

    const resultMap = new Map(
      results.map((result) => [result.repository, result]),
    );
    const errorMap = new Map(
      errors.map((error) => [error.repository, error.error]),
    );

    // ── Build the canonical flat dataset (source of truth) ──────────────────
    const generatedAt = new Date().toISOString();
    const rows: PullRequestRow[] = [];
    const reviewRows: ReviewRow[] = [];
    const commentRows: CommentRow[] = [];

    for (const repository of repositories) {
      const result = resultMap.get(repository);
      if (!result) continue;
      const [owner, repo] = repository.split("/");
      for (const pr of result.pullRequests) {
        rows.push({
          run_id: runId,
          generated_at: generatedAt,
          from_date: from,
          to_date: to,
          repository,
          owner: owner ?? "",
          repo: repo ?? "",
          number: pr.number,
          title: clean(pr.title),
          url: pr.url,
          state: pr.state,
          draft: !!pr.draft,
          author: clean(pr.author),
          created_at: pr.createdAt ?? "",
          updated_at: pr.updatedAt ?? "",
          closed_at: pr.closedAt ?? "",
          merged_at: pr.mergedAt ?? "",
          merged_by: clean(pr.mergedBy ?? ""),
          approved_by: (pr.approvedBy ?? []).join(";"),
          approved_at: pr.approvedAt ?? "",
          head_sha: pr.headSha ?? "",
          merge_commit_sha: pr.mergeCommitSha ?? "",
          commit_count: pr.commitCount ?? "",
          comment_count: pr.commentCount ?? "",
          review_comment_count: pr.reviewCommentCount ?? "",
          additions: pr.additions ?? "",
          deletions: pr.deletions ?? "",
          changed_files: pr.changedFiles ?? "",
          events: pr.events.join(";"),
        });

        for (const review of pr.reviews ?? []) {
          reviewRows.push({
            run_id: runId,
            generated_at: generatedAt,
            repository,
            owner: owner ?? "",
            repo: repo ?? "",
            pr_number: pr.number,
            reviewer: clean(review.reviewer),
            state: review.state,
            submitted_at: review.submittedAt ?? "",
            url: review.url,
          });
        }

        for (const comment of pr.comments ?? []) {
          commentRows.push({
            run_id: runId,
            generated_at: generatedAt,
            repository,
            owner: owner ?? "",
            repo: repo ?? "",
            pr_number: pr.number,
            comment_id: comment.id,
            type: comment.type,
            author: clean(comment.author),
            created_at: comment.createdAt,
            updated_at: comment.updatedAt,
            path: comment.path ?? "",
            url: comment.url,
            body: clean(comment.body),
          });
        }
      }
    }

    const dataJsonl = await writeRunArtifact(
      ctx,
      runId,
      "pull_requests.jsonl",
      toJsonl(rows),
    );
    const dataCsv = await writeRunArtifact(
      ctx,
      runId,
      "pull_requests.csv",
      toCsv(rows, ROW_COLUMNS),
    );
    const reviewsJsonl = await writeRunArtifact(
      ctx,
      runId,
      "pr_reviews.jsonl",
      toJsonl(reviewRows),
    );
    const reviewsCsv = await writeRunArtifact(
      ctx,
      runId,
      "pr_reviews.csv",
      toCsv(reviewRows, REVIEW_COLUMNS),
    );
    const commentsJsonl = await writeRunArtifact(
      ctx,
      runId,
      "pr_comments.jsonl",
      toJsonl(commentRows),
    );
    const commentsCsv = await writeRunArtifact(
      ctx,
      runId,
      "pr_comments.csv",
      toCsv(commentRows, COMMENT_COLUMNS),
    );

    // ── Totals derived from the flat dataset ────────────────────────────────
    const totals = rows.reduce(
      (sum, row) => {
        sum.total += 1;
        if (row.state === "open") sum.open += 1;
        if (row.state === "closed") sum.closed += 1;
        if (row.state === "merged") sum.merged += 1;
        if (row.draft) sum.draft += 1;
        return sum;
      },
      { total: 0, open: 0, closed: 0, merged: 0, draft: 0 },
    );

    // ── Render report.md FROM the flat dataset ──────────────────────────────
    const rowsByRepository = new Map<string, PullRequestRow[]>();
    for (const row of rows) {
      const list = rowsByRepository.get(row.repository) ?? [];
      list.push(row);
      rowsByRepository.set(row.repository, list);
    }

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
        lines.push(`Collection failed: ${clean(collectionError)}`, "");
        continue;
      }

      const repoRows = rowsByRepository.get(repository) ?? [];
      if (repoRows.length === 0) {
        lines.push("No matching PR activity.", "");
        continue;
      }

      for (const row of repoRows) {
        const events =
          row.events.length > 0 ? row.events.split(";").join(", ") : "none";
        const draft = row.draft ? " · draft" : "";
        lines.push(
          `- [#${row.number}](${row.url}) ${row.title} — ${row.author} · ${row.state}${draft} · events: ${events}`,
        );

        const detail: string[] = [];
        if (row.approved_by) {
          const when = row.approved_at ? ` (${row.approved_at})` : "";
          detail.push(
            `approved by ${row.approved_by.split(";").join(", ")}${when}`,
          );
        }
        if (row.merged_by) {
          detail.push(`merged by ${row.merged_by}`);
        }
        const commentTotal =
          (typeof row.comment_count === "number" ? row.comment_count : 0) +
          (typeof row.review_comment_count === "number"
            ? row.review_comment_count
            : 0);
        if (commentTotal > 0) {
          detail.push(`${commentTotal} comment${commentTotal === 1 ? "" : "s"}`);
        }
        const sha = row.merge_commit_sha || row.head_sha;
        if (sha) {
          detail.push(`commit ${sha.slice(0, 7)}`);
        }
        if (detail.length > 0) {
          lines.push(`  - ${detail.join(" · ")}`);
        }
      }

      lines.push("");
    }

    if (errors.length > 0) {
      lines.push("## Collection Errors", "");
      for (const error of errors) {
        lines.push(`- ${clean(error.repository)}: ${clean(error.error)}`);
      }
      lines.push("");
    }

    const markdown = `${lines.join("\n").trim()}\n`;
    const report = await writeRunArtifact(ctx, runId, "report.md", markdown);

    // ── Run metrics: token usage + estimated cost. See openspec/adr/0001 §5. ─
    const orchestratorModel = modelIdFor("orchestrator");
    const scoutModel = modelIdFor("scout");
    const stepBudget = Number.parseInt(process.env.RUN_STEP_BUDGET ?? "", 10);
    const wallBudget = Number.parseInt(
      process.env.RUN_WALL_CLOCK_BUDGET_S ?? "",
      10,
    );
    const summary = buildRunSummary({
      runId,
      models: { orchestrator: orchestratorModel, scout: scoutModel },
      fallbackModelId: orchestratorModel,
      budget: {
        steps: Number.isFinite(stepBudget) ? stepBudget : undefined,
        wallClockSeconds: Number.isFinite(wallBudget) ? wallBudget : undefined,
      },
    });
    const summaryFile = await writeRunArtifact(
      ctx,
      runId,
      "summary.json",
      JSON.stringify(summary, null, 2),
    );

    return {
      runId,
      markdown,
      sandboxPath: report.sandboxPath,
      hostPath: report.hostPath,
      summaryPath: summaryFile.hostPath,
      dataJsonlPath: dataJsonl.hostPath,
      dataCsvPath: dataCsv.hostPath,
      reviewsJsonlPath: reviewsJsonl.hostPath,
      reviewsCsvPath: reviewsCsv.hostPath,
      commentsJsonlPath: commentsJsonl.hostPath,
      commentsCsvPath: commentsCsv.hostPath,
      rows: rows.length,
      reviews: reviewRows.length,
      comments: commentRows.length,
      bytes: report.bytes,
      successfulRepositories: results.length,
      failedRepositories: errors.length,
    };
  },
});
