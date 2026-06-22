import { defineTool } from "eve/tools";
import { z } from "zod";

import { writeRunArtifact } from "shared/lib/run.js";

interface GitHubPull {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  draft: boolean;
  user: {
    login: string;
  } | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
}

interface GitHubPullDetail extends GitHubPull {
  merge_commit_sha: string | null;
  merged_by: { login: string } | null;
  comments: number;
  review_comments: number;
  commits: number;
  additions: number;
  deletions: number;
  changed_files: number;
  head: { sha: string } | null;
}

interface GitHubReview {
  user: { login: string } | null;
  state: string;
  submitted_at: string | null;
  html_url: string;
}

interface GitHubComment {
  id: number;
  user: { login: string } | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  body: string;
  path?: string;
}

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

const inputSchema = z.object({
  runId: z.string().min(1),
  repository: z
    .string()
    .regex(
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
      "Repository must use owner/repository format.",
    ),
  from: z.string().datetime(),
  toExclusive: z.string().datetime(),
  state: z.enum(["all", "open", "closed"]).default("all"),
});

function isInRange(
  value: string | null,
  fromMilliseconds: number,
  toExclusiveMilliseconds: number,
): boolean {
  if (!value) {
    return false;
  }

  const timestamp = Date.parse(value);

  return (
    Number.isFinite(timestamp) &&
    timestamp >= fromMilliseconds &&
    timestamp < toExclusiveMilliseconds
  );
}

function getErrorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      message?: string;
    };

    if (parsed.message) {
      return parsed.message;
    }
  } catch {
    // Fall through to the truncated response body.
  }

  return body.slice(0, 300) || `HTTP ${status}`;
}

function safeRepositoryFileName(repository: string): string {
  return `${repository.replace("/", "__")}.json`;
}

export default defineTool({
  description:
    "Fetch, normalize, and persist pull-request activity for one GitHub repository in the current timestamped run directory. Enriches each in-range pull request with review/approval history, issue + review comments, and commit identifiers (head SHA, merge commit SHA).",

  inputSchema,

  async execute({ runId, repository, from, toExclusive, state }, ctx) {
    const token = process.env.GITHUB_TOKEN;

    if (!token) {
      throw new Error("GITHUB_TOKEN is required.");
    }

    const baseHeaders = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "eve-github-pr-digest",
    } as const;

    async function githubGet<T>(url: URL | string): Promise<T> {
      const response = await fetch(url, { headers: baseHeaders });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `GitHub API ${response.status} for ${repository}: ${getErrorMessage(
            response.status,
            body,
          )}`,
        );
      }

      return (await response.json()) as T;
    }

    // Fetch every page of a paginated collection endpoint (bounded).
    async function githubGetAll<T>(path: string, maxPages = 3): Promise<T[]> {
      const items: T[] = [];

      for (let page = 1; page <= maxPages; page += 1) {
        const url = new URL(`https://api.github.com/repos/${repository}${path}`);
        url.searchParams.set("per_page", "100");
        url.searchParams.set("page", String(page));

        const pageItems = await githubGet<T[]>(url);
        items.push(...pageItems);

        if (pageItems.length < 100) {
          break;
        }
      }

      return items;
    }

    const fromMilliseconds = Date.parse(from);
    const toExclusiveMilliseconds = Date.parse(toExclusive);

    if (
      !Number.isFinite(fromMilliseconds) ||
      !Number.isFinite(toExclusiveMilliseconds) ||
      toExclusiveMilliseconds <= fromMilliseconds
    ) {
      throw new Error("Invalid report interval.");
    }

    const fetchedPullRequests: GitHubPull[] = [];
    const maximumPages = 5;
    let pagesFetched = 0;

    for (let page = 1; page <= maximumPages; page += 1) {
      const url = new URL(
        `https://api.github.com/repos/${repository}/pulls`,
      );

      url.searchParams.set("state", state);
      url.searchParams.set("sort", "updated");
      url.searchParams.set("direction", "desc");
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));

      const pagePullRequests = await githubGet<GitHubPull[]>(url);

      pagesFetched += 1;
      fetchedPullRequests.push(...pagePullRequests);

      if (pagePullRequests.length < 100) {
        break;
      }

      const oldestUpdatedAt = Math.min(
        ...pagePullRequests.map((pullRequest) =>
          Date.parse(pullRequest.updated_at),
        ),
      );

      if (
        Number.isFinite(oldestUpdatedAt) &&
        oldestUpdatedAt < fromMilliseconds
      ) {
        break;
      }
    }

    const inRangePullRequests = fetchedPullRequests
      .filter((pullRequest) =>
        [
          pullRequest.created_at,
          pullRequest.updated_at,
          pullRequest.closed_at,
          pullRequest.merged_at,
        ].some((timestamp) =>
          isInRange(timestamp, fromMilliseconds, toExclusiveMilliseconds),
        ),
      )
      .sort(
        (left, right) =>
          Date.parse(right.updated_at) - Date.parse(left.updated_at),
      );

    // ── Enrich each in-range PR: detail (SHAs, counts), reviews, comments ──
    let enrichmentFailures = 0;

    const pullRequests = await Promise.all(
      inRangePullRequests.map(async (pullRequest) => {
        const events: string[] = [];

        if (
          isInRange(
            pullRequest.created_at,
            fromMilliseconds,
            toExclusiveMilliseconds,
          )
        ) {
          events.push("created");
        }

        if (
          isInRange(
            pullRequest.updated_at,
            fromMilliseconds,
            toExclusiveMilliseconds,
          )
        ) {
          events.push("updated");
        }

        if (
          isInRange(
            pullRequest.closed_at,
            fromMilliseconds,
            toExclusiveMilliseconds,
          )
        ) {
          events.push("closed");
        }

        if (
          isInRange(
            pullRequest.merged_at,
            fromMilliseconds,
            toExclusiveMilliseconds,
          )
        ) {
          events.push("merged");
        }

        const base = {
          number: pullRequest.number,
          title: pullRequest.title,
          url: pullRequest.html_url,
          state: pullRequest.merged_at
            ? ("merged" as const)
            : pullRequest.state,
          draft: pullRequest.draft,
          author: pullRequest.user?.login ?? "unknown",
          createdAt: pullRequest.created_at,
          updatedAt: pullRequest.updated_at,
          closedAt: pullRequest.closed_at,
          mergedAt: pullRequest.merged_at,
          events,
        };

        try {
          const [detail, rawReviews, issueComments, reviewComments] =
            await Promise.all([
              githubGet<GitHubPullDetail>(
                `https://api.github.com/repos/${repository}/pulls/${pullRequest.number}`,
              ),
              githubGetAll<GitHubReview>(
                `/pulls/${pullRequest.number}/reviews`,
              ),
              githubGetAll<GitHubComment>(
                `/issues/${pullRequest.number}/comments`,
              ),
              githubGetAll<GitHubComment>(
                `/pulls/${pullRequest.number}/comments`,
              ),
            ]);

          const reviews: NormalizedReview[] = rawReviews
            .map((review) => ({
              reviewer: review.user?.login ?? "unknown",
              state: review.state,
              submittedAt: review.submitted_at,
              url: review.html_url,
            }))
            .sort(
              (left, right) =>
                Date.parse(left.submittedAt ?? "") -
                Date.parse(right.submittedAt ?? ""),
            );

          // Latest APPROVED review per reviewer = the effective approvals.
          const approvalByReviewer = new Map<string, string | null>();
          for (const review of reviews) {
            if (review.state === "APPROVED") {
              approvalByReviewer.set(review.reviewer, review.submittedAt);
            }
          }
          const approvals = [...approvalByReviewer.entries()].map(
            ([reviewer, submittedAt]) => ({ reviewer, submittedAt }),
          );
          const approvedBy = approvals.map((approval) => approval.reviewer);
          const approvedAt =
            approvals
              .map((approval) => approval.submittedAt)
              .filter((value): value is string => Boolean(value))
              .sort()
              .at(-1) ?? null;

          const comments: NormalizedComment[] = [
            ...issueComments.map((comment) => ({
              id: comment.id,
              type: "issue" as const,
              author: comment.user?.login ?? "unknown",
              createdAt: comment.created_at,
              updatedAt: comment.updated_at,
              url: comment.html_url,
              path: null,
              body: comment.body ?? "",
            })),
            ...reviewComments.map((comment) => ({
              id: comment.id,
              type: "review" as const,
              author: comment.user?.login ?? "unknown",
              createdAt: comment.created_at,
              updatedAt: comment.updated_at,
              url: comment.html_url,
              path: comment.path ?? null,
              body: comment.body ?? "",
            })),
          ].sort(
            (left, right) =>
              Date.parse(left.createdAt) - Date.parse(right.createdAt),
          );

          return {
            ...base,
            headSha: detail.head?.sha ?? null,
            mergeCommitSha: detail.merge_commit_sha,
            mergedBy: detail.merged_by?.login ?? null,
            commitCount: detail.commits,
            commentCount: detail.comments,
            reviewCommentCount: detail.review_comments,
            additions: detail.additions,
            deletions: detail.deletions,
            changedFiles: detail.changed_files,
            approvedBy,
            approvedAt,
            approvals,
            reviews,
            comments,
          };
        } catch {
          // Enrichment is best-effort; never drop the base PR record.
          enrichmentFailures += 1;
          return {
            ...base,
            headSha: null,
            mergeCommitSha: null,
            mergedBy: null,
            commitCount: null,
            commentCount: null,
            reviewCommentCount: null,
            additions: null,
            deletions: null,
            changedFiles: null,
            approvedBy: [] as string[],
            approvedAt: null,
            approvals: [] as Array<{
              reviewer: string;
              submittedAt: string | null;
            }>,
            reviews: [] as NormalizedReview[],
            comments: [] as NormalizedComment[],
          };
        }
      }),
    );

    const counts = {
      total: pullRequests.length,
      open: pullRequests.filter(
        (pullRequest) => pullRequest.state === "open",
      ).length,
      closed: pullRequests.filter(
        (pullRequest) => pullRequest.state === "closed",
      ).length,
      merged: pullRequests.filter(
        (pullRequest) => pullRequest.state === "merged",
      ).length,
      draft: pullRequests.filter(
        (pullRequest) => pullRequest.draft,
      ).length,
    };

    const result = {
      repository,
      interval: {
        from,
        toExclusive,
      },
      counts,
      pullRequests,
      diagnostics: {
        pagesFetched,
        fetched: fetchedPullRequests.length,
        enriched: pullRequests.length - enrichmentFailures,
        enrichmentFailures,
      },
    };

    const content = JSON.stringify(result, null, 2);
    const fileName = safeRepositoryFileName(repository);

    const { hostPath, sandboxPath } = await writeRunArtifact(
      ctx,
      runId,
      `repositories/${fileName}`,
      content,
    );

    return {
      runId,
      repository,
      counts,
      hostPath,
      sandboxPath,
    };
  },
});
