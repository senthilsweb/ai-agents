import { defineTool } from "eve/tools";
import { z } from "zod";

interface GitHubPull {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  draft: boolean;
  user: { login: string } | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  base: { ref: string };
  head: { ref: string };
  labels: Array<{ name: string }>;
}

function inRange(value: string | null, fromMs: number, toMs: number): boolean {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= fromMs && time < toMs;
}

export default defineTool({
  description:
    "Fetch, paginate, date-filter, normalize, and count pull requests for one GitHub repository. Requires GITHUB_TOKEN.",
  inputSchema: z.object({
    repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    from: z.string().datetime(),
    toExclusive: z.string().datetime(),
    state: z.enum(["all", "open", "closed"]).default("all"),
  }),
  async execute({ repository, from, toExclusive, state }) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN is required.");

    const fromMs = Date.parse(from);
    const toMs = Date.parse(toExclusive);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      throw new Error("Invalid report interval.");
    }

    const pulls: GitHubPull[] = [];
    const maxPages = 5;
    let pagesFetched = 0;

    for (let page = 1; page <= maxPages; page += 1) {
      const url = new URL(`https://api.github.com/repos/${repository}/pulls`);
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
        const body = (await response.text()).slice(0, 500);
        throw new Error(`GitHub API ${response.status} for ${repository}: ${body}`);
      }

      const pageItems = (await response.json()) as GitHubPull[];
      pagesFetched += 1;
      pulls.push(...pageItems);
      if (pageItems.length < 100) break;

      const oldestUpdated = Math.min(...pageItems.map((pr) => Date.parse(pr.updated_at)));
      if (oldestUpdated < fromMs) break;
    }

    const selected = pulls
      .filter((pr) =>
        [pr.created_at, pr.updated_at, pr.closed_at, pr.merged_at].some((value) =>
          inRange(value, fromMs, toMs),
        ),
      )
      .map((pr) => {
        const events = [
          ["created", pr.created_at],
          ["updated", pr.updated_at],
          ["closed", pr.closed_at],
          ["merged", pr.merged_at],
        ]
          .filter(([, value]) => inRange(value, fromMs, toMs))
          .map(([name]) => name);

        return {
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          state: pr.merged_at ? "merged" : pr.state,
          draft: pr.draft,
          author: pr.user?.login ?? "unknown",
          base: pr.base.ref,
          head: pr.head.ref,
          labels: pr.labels.map((label) => label.name),
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          closedAt: pr.closed_at,
          mergedAt: pr.merged_at,
          events,
        };
      })
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

    const counts = {
      total: selected.length,
      open: selected.filter((pr) => pr.state === "open").length,
      closed: selected.filter((pr) => pr.state === "closed").length,
      merged: selected.filter((pr) => pr.state === "merged").length,
      draft: selected.filter((pr) => pr.draft).length,
    };

    return {
      repository,
      interval: { from, toExclusive },
      stateFilter: state,
      pagesFetched,
      fetched: pulls.length,
      counts,
      pullRequests: selected,
    };
  },
});
