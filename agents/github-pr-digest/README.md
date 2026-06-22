# GitHub PR Digest — Vercel Eve Example

A deliberately small multi-agent Eve example that creates a pull-request activity report across multiple GitHub repositories for a date range.

## Architecture

```text
Orchestrator
  ├─ Repository Scout (one invocation per repository; fan-out)
  │    └─ deterministic GitHub REST API tool
  └─ Digest Reporter
       └─ combines normalized JSON into Markdown
```

The LLM does not browse GitHub or calculate statistics. The `fetch_pull_requests` tool performs authentication, pagination, date filtering, normalization, and counts. The model only coordinates tool calls and writes a readable digest.

## Prerequisites

- Node.js 24+
- A GitHub token that can read the configured repositories
- An OpenRouter API key

## Setup

```bash
cp .env.example .env
# edit .env
npm install
npm run dev
```

## Example prompts

```text
Create a PR activity report from 2026-06-20 to 2026-06-20 for
["vercel/eve", "senthilsweb/ai-agents"].
```

```text
Generate yesterday's PR digest using the configured repositories.
```

Dates without times are interpreted as complete UTC calendar days. A PR is included when any of `created_at`, `updated_at`, `closed_at`, or `merged_at` falls inside the requested interval.

## Configuration

Set default repositories as a JSON array:

```bash
GITHUB_REPOSITORIES='["owner/repo-one","owner/repo-two"]'
```

A repository array supplied in the prompt overrides the environment default.

## Schedule

`agent/schedules/daily-pr-digest.md` runs every day at `01:00 UTC` and reports the previous UTC day.

Test it locally:

```bash
curl -X POST http://localhost:3000/eve/v1/dev/schedules/daily-pr-digest
```

`eve dev` does not execute cron schedules automatically. Production `eve start` or a Vercel deployment does.

## Output

Interactive runs return Markdown and also save it under the sandbox workspace:

```text
reports/<from>_to_<to>.md
```

## Security

- Never place tokens in prompts or committed files.
- Prefer a fine-grained GitHub PAT restricted to read-only access for selected repositories.
- The token is read only by the deterministic GitHub API tool.

## Scope

Version 1 intentionally supports PR activity only. Commit reporting, comments, reviews, Slack delivery, and historical analytics are out of scope.
