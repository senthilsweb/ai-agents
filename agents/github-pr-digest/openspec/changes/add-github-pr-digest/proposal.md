# Proposal: Add GitHub PR Digest Agent

## Why

Teams and open-source maintainers often need a small daily view of pull-request activity across several repositories. Existing dashboards can be noisy, while hand-written summaries are repetitive.

## What changes

Add a simple Vercel Eve teaching example that:

- accepts an array of GitHub repositories and a date range;
- authenticates with `GITHUB_TOKEN`;
- fans out one Repository Scout subagent per repository;
- uses the GitHub REST API deterministically to collect PR activity;
- assembles all normalized results with a deterministic report tool (`render_and_save_report`), not an LLM reporter;
- saves and returns one Markdown report plus a `summary.json` metrics file;
- copies the run directory back to the host with a single `sync_run_to_host` step;
- runs manually or through a daily Eve schedule;
- stays model-agnostic: each role's model is resolved from environment (a reasoning-class model for the orchestrator, a fast non-reasoning-class model for the scout), with no model id hard-coded.

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

GitHub access, filtering, normalization, counting, **and report assembly** are deterministic code tools. The LLM is limited to orchestration (coordinating tool calls and delegating to scouts). Per ADR 0001, whether a step is a code tool or a prompt/skill is use-case specific: correctness-critical steps are code; generative/judgement steps may be skills. This agent is entirely correctness-critical, so it uses code tools end to end.

Cost is bounded and observable: usage is captured per run into `summary.json` using the shared cost matrix (ADR 0002), the scout runs a fast non-reasoning model, and the orchestrator enforces step and wall-clock budgets to avoid infinite loops or runaway reasoning.
