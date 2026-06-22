# Proposal: Add GitHub PR Digest Agent

## Why

Teams and open-source maintainers often need a small daily view of pull-request activity across several repositories. Existing dashboards can be noisy, while hand-written summaries are repetitive.

## What changes

Add a simple Vercel Eve teaching example that:

- accepts an array of GitHub repositories and a date range;
- authenticates with `GITHUB_TOKEN`;
- fans out one Repository Scout subagent per repository;
- uses the GitHub REST API deterministically to collect PR activity;
- fans in all normalized results to a Digest Reporter subagent;
- saves and returns one Markdown report;
- runs manually or through a daily Eve schedule;
- defaults to OpenRouter's free-model router.

## Scope

### In scope

- Pull requests only
- At most 20 repositories per run
- PRs whose create, update, close, or merge timestamp intersects the interval
- Open, closed, or all state filters
- Markdown output

### Out of scope

- Commits, issues, releases, reviews, comments, and diff analysis
- Notifications to Slack/email
- Long-term storage or dashboards
- Autonomous recommendations

## Design principle

GitHub access, filtering, normalization, and counting are deterministic tools. Models are limited to orchestration and final presentation.
