# GitHub PR Digest — Vercel Eve Example

A deliberately small multi-agent Eve example that creates a pull-request activity report across multiple GitHub repositories for a requested date range.

## Architecture

```text
Orchestrator (reasoning-class model, from MODEL_ORCHESTRATOR)
├── Repository Scout (fast non-reasoning-class model, from MODEL_SCOUT)
│   ├── one invocation per repository
│   └── deterministic GitHub REST API tool
└── render_and_save_report (deterministic tool, no LLM)
    └── combines normalized repository JSON into Markdown + summary.json
```

The orchestrator fans out one Repository Scout per repository, then calls the
deterministic `render_and_save_report` tool to assemble the digest. Report
assembly is **not** an LLM step. The agent is **model-agnostic**: every model is
resolved from environment per role — a reasoning-class model for the
orchestrator, a fast non-reasoning-class model for the scout (a heavy reasoning
model on the scout risks runaway chain-of-thought). See
[`../../openspec/adr/0001-shared-agent-runtime-kit.md`](../../openspec/adr/0001-shared-agent-runtime-kit.md)
and [`../../openspec/adr/0002-cost-matrix.md`](../../openspec/adr/0002-cost-matrix.md).

The GitHub tool performs:

- GitHub token authentication
- REST API requests
- Pagination
- UTC date filtering
- PR normalization
- Deterministic counts

The language models only coordinate tool calls. Report assembly, counts, and
formatting are deterministic code.

## Prerequisites

- Node.js 24 or later
- Docker for the local Eve sandbox
- A GitHub token that can read the configured repositories
- An API key for your chosen model provider (model-agnostic — any model or AI gateway Eve supports, swappable via `.env`)

For read-only reporting, a fine-grained GitHub token normally needs:

- Metadata: Read-only
- Pull requests: Read-only

Private organization repositories may require organization approval or SAML SSO authorization.

## Setup

```bash
cp .env.example .env
```

Configure `.env`:

```bash
GITHUB_TOKEN=github_pat_xxx
GITHUB_REPOSITORIES='["owner/repository-one","owner/repository-two"]'

# Model-agnostic, per-role. Each role falls back MODEL_<ROLE>_* -> MODEL_* (no built-in default).
# Choose a reasoning-class model for the orchestrator and a fast non-reasoning-class model
# for the scout. Any model or AI gateway is swappable via .env using Eve's adapters.
MODEL_ORCHESTRATOR=<reasoning-class-model-id>   # coordination, fan-out
MODEL_SCOUT=<fast-non-reasoning-model-id>        # glue only
MODEL_BASE_URL=<your-model-or-gateway-base-url>
MODEL_API_KEY=<your-provider-key>
```

Then run:

```bash
npm install
npm run dev
```

After changing agent tools, instructions, or sandbox configuration, clear Eve's generated runtime:

```bash
export HOST_REPORT_ROOT="$PWD"
rm -rf .eve
docker ps -aq --filter "name=eve-sbx-ses-docker" | xargs -r docker rm -f
nvm use v24.17.0
npx eve dev --port 3535
```

## Example prompts

```text
Create a PR activity report from 2026-06-21 to 2026-06-22 for ["senthilsweb/ai-agents"].
```

```text
Generate yesterday's PR digest using the configured repositories.
```

Dates without times represent complete UTC calendar days.

For example:

```text
from: 2026-06-22
to:   2026-06-22
```

is normalized to:

```text
from:        2026-06-22T00:00:00.000Z
toExclusive: 2026-06-23T00:00:00.000Z
```

A PR is included when at least one of these timestamps falls in the requested interval:

- `created_at`
- `updated_at`
- `closed_at`
- `merged_at`

## Configuration

Set the default repositories as a JSON array:

```bash
GITHUB_REPOSITORIES='[
  "owner/repository-one",
  "owner/repository-two"
]'
```

A repository array supplied in the user prompt overrides this default.

## Schedule

`agent/schedules/daily-pr-digest.md` runs daily at `01:00 UTC` and reports the previous UTC calendar day.

Test the schedule locally:

```bash
curl -X POST   http://localhost:3000/eve/v1/dev/schedules/daily-pr-digest
```

`eve dev` does not automatically execute cron schedules. Production `eve start` or a Vercel deployment executes configured schedules.

## Output

Each run is persisted under a timestamped run directory:

```text
agent/sandbox/workspace/runs/<run-id>/
```

Example:

```text
agent/sandbox/workspace/runs/2026-06-22T21-42-45Z/
├── request.json            # resolved request (from, to, repositories, state)
├── repositories/
│   ├── senthilsweb__ai-agents.json   # raw per-repo collector capture (nested)
│   └── senthilsweb__templrgo.json
├── pull_requests.jsonl     # canonical flat dataset — one PR per line
├── pull_requests.csv       # same rows, columnar (DB / spreadsheet import)
├── pr_reviews.jsonl        # one row per review/approval action
├── pr_reviews.csv
├── pr_comments.jsonl       # one row per comment (issue + inline), with body
├── pr_comments.csv
├── report.md               # human digest, rendered FROM the flat dataset
└── summary.json            # run metrics (token usage + estimated cost)
```

### Artifact reference

| File | Format | Grain | Purpose |
|---|---|---|---|
| `request.json` | JSON | per run | The resolved request: `from`, `to` (exclusive), `repositories`, `state`. |
| `repositories/<owner>__<repo>.json` | JSON | per repo | Raw upstream capture (nested) — counts, interval, enriched `pullRequests[]`, and `diagnostics` (`pagesFetched`, `fetched`, `enriched`, `enrichmentFailures`). |
| `pull_requests.{jsonl,csv}` | JSONL + CSV | one row per PR | **Canonical** flat dataset. Every column is scalar — load straight into any DB/warehouse. |
| `pr_reviews.{jsonl,csv}` | JSONL + CSV | one row per review action | Full approval/review history, keyed by `pr_number`. |
| `pr_comments.{jsonl,csv}` | JSONL + CSV | one row per comment | Full comment bodies (issue + inline), keyed by `pr_number`. |
| `report.md` | Markdown | per run | Human digest, rendered deterministically **from** `pull_requests.*`. |
| `summary.json` | JSON | per run | Run metrics: per-session token usage, steps, and estimated cost. |

> `.jsonl` (one JSON object per line) is for streaming/bulk-loading; `.csv`
> (with a header row, RFC-4180 quoting) is for spreadsheets and `COPY`-style
> imports. Both files hold identical rows and column order.

### Data is the source of truth

`pull_requests.*` / `pr_reviews.*` / `pr_comments.*` are the canonical,
flattened datasets for a run. `report.md` is rendered **from** these rows, so
the human report and the machine data never diverge. Every column is a scalar,
so the dataset loads directly into any relational or columnar store and can be
re-rendered deterministically downstream.

#### `pull_requests` — one row per pull request

```text
run_id, generated_at, from_date, to_date, repository, owner, repo, number,
title, url, state, draft, author, created_at, updated_at, closed_at,
merged_at, merged_by, approved_by, approved_at, head_sha, merge_commit_sha,
commit_count, comment_count, review_comment_count, additions, deletions,
changed_files, events
```

| Column | Meaning |
|---|---|
| `run_id`, `generated_at` | Run identity and render timestamp (stamped on every row for easy joins). |
| `from_date`, `to_date` | The requested UTC interval (`to_date` is exclusive). |
| `repository`, `owner`, `repo` | `owner/repo` plus its split parts. |
| `number`, `title`, `url` | PR number, title, and HTML URL. |
| `state` | `open`, `closed`, or `merged` (a merged PR is reported as `merged`). |
| `draft` | Boolean draft flag. |
| `author`, `created_at` | **Who created the PR**, and when. |
| `updated_at`, `closed_at`, `merged_at` | Lifecycle timestamps (blank when not applicable). |
| `merged_by` | **Who merged it.** |
| `approved_by`, `approved_at` | **Who approved it** (`;`-separated logins) and the latest approval time. Full history in `pr_reviews`. |
| `head_sha`, `merge_commit_sha` | **Commit / hash keys** — latest commit and the merge commit. |
| `commit_count`, `comment_count`, `review_comment_count` | Size of the PR's commit and discussion activity. |
| `additions`, `deletions`, `changed_files` | Diff size. |
| `events` | `;`-separated subset of `created\|updated\|closed\|merged` that fell inside the requested interval. |

#### `pr_reviews` — one row per review action

```text
run_id, generated_at, repository, owner, repo, pr_number, reviewer, state,
submitted_at, url
```

`state` is GitHub's review state (`APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`,
`DISMISSED`). `pr_number` joins back to `pull_requests.number`.

#### `pr_comments` — one row per comment

```text
run_id, generated_at, repository, owner, repo, pr_number, comment_id, type,
author, created_at, updated_at, path, url, body
```

`type` is `issue` (PR conversation) or `review` (inline code comment; `path`
points at the file). `body` is the full comment text. `pr_number` joins back to
`pull_requests.number`.

> **API cost note**: enrichment adds per-PR calls (`GET /pulls/{n}`,
> `/pulls/{n}/reviews`, `/issues/{n}/comments`, `/pulls/{n}/comments`) for each
> in-range PR. Enrichment is best-effort — a failed lookup leaves the base PR
> record intact with empty enrichment fields and is counted in the collector's
> `diagnostics.enrichmentFailures`.

The host-visible path depends on the root sandbox configuration and the mounted or seeded Eve workspace.

The run directory is copied back to the host by a single `sync_run_to_host`
step at the end of orchestration; deterministic tools do not write to the host
directly. Without a configured root workspace, artifacts may exist only inside
the temporary Eve sandbox or Docker container until that step runs.

### Sandbox cleanup

Stopped `eve-sbx-*` containers are reaped automatically so they do not pile up:

- `create_run` sweeps the previous run's now-stopped containers at the start.
- `cleanup_sandbox` runs as the final orchestration step to reap the finished
  scout containers from the current run.

Running containers are never removed. Disable with `EVE_SANDBOX_CLEANUP=off`.
The sweep is a no-op when the `docker` CLI is unavailable (e.g. a hosted
sandbox backend).

## Troubleshooting

### GitHub returns 404

For a private repository, `404 Not Found` usually means the token cannot access that repository.

Verify access:

```bash
curl -i   -H "Authorization: Bearer $GITHUB_TOKEN"   -H "Accept: application/vnd.github+json"   https://api.github.com/repos/owner/repository
```

Expected response:

```text
HTTP/2 200
```

### Repository Scout schema failure

Example:

```text
SUBAGENTEXECUTIONFAILED
The agent could not produce a result matching the requested schema.
```

Actions:

1. Confirm the GitHub tool succeeded.
2. Keep the tool result small.
3. Ensure the scout returns JSON only.
4. Do not use Markdown fences.
5. Clear `.eve` after changing the scout instructions.
6. Keep the scout on a fast non-reasoning-class model with reliable structured output; a heavy reasoning model can stall or loop on this glue task.

### Report is not visible on the host

Confirm these files exist:

```text
agent/sandbox/sandbox.ts
agent/sandbox/workspace/runs/.gitkeep
```

Then clear and restart Eve:

```bash
rm -rf .eve
npm run dev
```

## Security

- Never place tokens in prompts.
- Never commit `.env`.
- Prefer fine-grained tokens restricted to selected repositories.
- Reporting requires read-only repository access.
- Dummy PR generation requires separate write permissions.
- The token is consumed only by the deterministic GitHub API tool.

## Version 1 scope

Included:

- Pull-request activity
- Multiple repositories
- Configurable UTC date range
- Parallel repository collection
- Final Markdown report

Not included:

- Commits
- Issues
- Reviews
- Comments
- Releases
- Code-diff analysis
- Slack or email delivery
- Long-term analytics
