import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { defineTool } from "eve/tools";
import { z } from "zod";

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
    "Fetch, normalize, and persist pull-request activity for one GitHub repository in the current timestamped run directory.",

  inputSchema,

  async execute(
    { runId, repository, from, toExclusive, state },
    ctx,
  ) {
    const token = process.env.GITHUB_TOKEN;

    if (!token) {
      throw new Error("GITHUB_TOKEN is required.");
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

      const response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "eve-github-pr-digest",
        },
      });

      if (!response.ok) {
        const body = await response.text();

        throw new Error(
          `GitHub API ${response.status} for ${repository}: ${getErrorMessage(
            response.status,
            body,
          )}`,
        );
      }

      const pagePullRequests = (await response.json()) as GitHubPull[];

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

    const pullRequests = fetchedPullRequests
      .filter((pullRequest) =>
        [
          pullRequest.created_at,
          pullRequest.updated_at,
          pullRequest.closed_at,
          pullRequest.merged_at,
        ].some((timestamp) =>
          isInRange(
            timestamp,
            fromMilliseconds,
            toExclusiveMilliseconds,
          ),
        ),
      )
      .map((pullRequest) => {
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

        return {
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
      })
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
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
      },
    };

    const content = JSON.stringify(result, null, 2);
    const fileName = safeRepositoryFileName(repository);

    const projectRoot =
      process.env.HOST_REPORT_ROOT ?? process.cwd();

    const hostPath = path.resolve(
      projectRoot,
      "agent",
      "sandbox",
      "workspace",
      "runs",
      runId,
      "repositories",
      fileName,
    );

    await mkdir(path.dirname(hostPath), {
      recursive: true,
    });

    await writeFile(hostPath, content, "utf8");

    const sandbox = await ctx.getSandbox();
    const sandboxDirectory = `/workspace/runs/${runId}/repositories`;
    const sandboxPath = `${sandboxDirectory}/${fileName}`;

    await sandbox.run({
      command: `mkdir -p ${JSON.stringify(sandboxDirectory)}`,
    });

    await sandbox.writeTextFile({
      path: sandboxPath,
      content,
    });

    return {
      runId,
      repository,
      counts,
      hostPath,
      sandboxPath,
    };
  },
});
