# GitHub PR Digest — Vercel Eve Example

A deliberately small multi-agent Eve example that creates a pull-request activity report across multiple GitHub repositories for a requested date range.

## Architecture

```text
Orchestrator
├── Repository Scout
│   ├── one invocation per repository
│   └── deterministic GitHub REST API tool
└── Digest Reporter
    └── combines normalized repository JSON into Markdown
```

The orchestrator fans out one Repository Scout per repository.

The GitHub tool performs:

- GitHub token authentication
- REST API requests
- Pagination
- UTC date filtering
- PR normalization
- Deterministic counts

The language models only coordinate tool calls and format the final report.

## Prerequisites

- Node.js 24 or later
- Docker for the local Eve sandbox
- A GitHub token that can read the configured repositories
- An OpenRouter API key

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
OPENROUTER_API_KEY=sk-or-v1-xxx
GITHUB_REPOSITORIES='["owner/repository-one","owner/repository-two"]'
```

Then run:

```bash
npm install
npm run dev
```

After changing agent tools, instructions, or sandbox configuration, clear Eve's generated runtime:

```bash
rm -rf .eve

docker ps -aq \
  --filter "name=eve-sbx-ses-docker" |
xargs -r docker rm -f

nvm use v24.17.0 && npx eve dev --port 3535
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

Each run should be persisted under:

```text
agent/sandbox/workspace/runs/<run-id>/
```

Example:

```text
agent/sandbox/workspace/runs/2026-06-22T01-30-00Z/
├── request.json
├── repositories/
│   ├── senthilsweb__ai-agents.json
│   └── senthilsweb__templrgo.json
├── report.md
└── summary.json
```

The host-visible path depends on the root sandbox configuration and the mounted or seeded Eve workspace.

A path such as:

```text
reports/2026-06-21_to_2026-06-22.md
```

without a configured root workspace may exist only inside the temporary Eve sandbox or Docker container.

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
6. Prefer a fixed model with reliable structured-output support if `openrouter/free` remains inconsistent.

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
