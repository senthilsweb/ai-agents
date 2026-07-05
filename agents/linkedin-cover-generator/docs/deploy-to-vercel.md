---
title: Deploy to Vercel
description: Production deployment — project link, the complete env/secrets matrix, telemetry posture, auth, and remote smoke testing.
order: 5
updated: 2026-07-05
---

# Deploy to Vercel

The agent runs as project **`linkedin-cover-generator`** with production
alias `https://linkedin-cover-generator.vercel.app`. Because it depends on
the monorepo's `shared` workspace package, deploys use the **whole repo**
as build context with the project's Root Directory set to
`agents/linkedin-cover-generator`.

## 1. Prerequisites

```bash
npm i -g vercel          # CLI
vercel login             # or: vercel login --github
```

## 2. Link and deploy (from the repo root)

```bash
cd <repo-root>
vercel link --yes --project linkedin-cover-generator
vercel deploy --prod
```

Linking writes `.vercel/project.json` and pulls a `.env.local` (both
gitignored). `vercel deploy --dry --format=json` confirms `shared/**` is in
the upload before deploying for real.

### Redeploying

Redeploy any time with the same command, always from the **repo root**:

```bash
vercel deploy --prod
```

A redeploy is **required** (not optional) after:

- **any `vercel env add` / `vercel env rm`** — env changes never apply to
  the running deployment; they only take effect on the next build
  (this is how the empty-`ROUTE_AUTH_BASIC_PASSWORD` fix and the
  `OBJECT_STORE_*` additions were activated);
- **adding or changing channels** (e.g. `agent/channels/teams.ts`) — new
  routes like `/eve/v1/teams` don't exist on the old deployment;
- any code, instructions, tool, or skill change you want live.

The deploy uploads your **local working tree** (not the git remote), so
commit first if you want the deployed code to match `main`. Each deploy
gets an immutable URL and the production alias
(`linkedin-cover-generator.vercel.app`) flips to it on success — a bad
deploy can be rolled back by promoting the previous deployment
(`vercel rollback` or the dashboard).

## 3. Env & secrets matrix

Set per environment with `vercel env add <NAME> production` (repeat for
`preview` / `development` as needed). One-liner to push a value without
typing it interactively: `printf '%s' "$VALUE" | vercel env add NAME production`.

| Variable | Required | Value / notes |
|---|---|---|
| `MODEL_ORCHESTRATOR` | ✅ | e.g. `claude-sonnet-5` (no BASE_URL → Anthropic provider path) |
| `MODEL_ORCHESTRATOR_API_KEY` | ✅ | provider key for the orchestrator |
| `IMAGE_MODEL` | ✅ | e.g. `gpt-image-2` |
| `IMAGE_BASE_URL` | ✅ | e.g. `https://api.openai.com/v1` |
| `IMAGE_API_KEY` | ✅ | image-provider key |
| `IMAGE_QUALITY` | — | `high` (default) |
| `HOST_REPORT_ROOT` | ✅ | **`/tmp`** — the deployment bundle (`/var/task`) is read-only; without this, `create_run` fails |
| `ENABLE_REVIEW` / `MAX_IMAGE_RETRIES` | ✅ | `false` / `0` — loop control |
| `RUN_STEP_BUDGET` / `RUN_WALL_CLOCK_BUDGET_S` | — | soft budgets (e.g. `25` / `300`) |
| `ALLOW_COST` | — | `true` |
| `OBJECT_STORE_BUCKET` | ✅* | *required in practice: `/tmp` is ephemeral, so without object storage a remote caller can never retrieve `cover.png` |
| `OBJECT_STORE_REGION` | ✅* | e.g. `us-east-1` (MinIO accepts any non-empty value) |
| `OBJECT_STORE_ACCESS_KEY_ID` / `OBJECT_STORE_SECRET_ACCESS_KEY` | ✅* | dedicated, minimally-scoped key (see [Secure the Endpoints](./secure-the-endpoints.md)) |
| `OBJECT_STORE_ENDPOINT` | MinIO | S3 **API** endpoint — no console URL, no `/login` path |
| `OBJECT_STORE_FORCE_PATH_STYLE` | MinIO | `true` |
| `OBJECT_STORE_PUBLIC_BASE_URL` | — | only for public buckets/CDN; think twice |
| `TELEMETRY_RECORD_IO` | recommended | **`false`** — defense-in-depth; see telemetry posture below |
| `PHOENIX_COLLECTOR_ENDPOINT` / `OTEL_EXPORTER_OTLP_ENDPOINT` | — | **leave unset on Vercel** (see below) |
| `ROUTE_AUTH_BASIC_USER` | for curl access | e.g. `operator` |
| `ROUTE_AUTH_BASIC_PASSWORD` | for curl access | a generated secret — **must be non-empty**: an empty value silently disables `httpBasic` and production returns "auth not configured" |
| `MICROSOFT_APP_ID` | Teams channel | Azure Bot App ID — see [Consume from Microsoft Teams](./consume-from-teams.md) |
| `MICROSOFT_APP_PASSWORD` | Teams channel | Azure Bot client secret (the **Value**, not the Secret ID; secrets expire — rotate in Azure) |
| `MICROSOFT_TENANT_ID` | Teams channel | only for **Single Tenant** bots; leave unset for Multi Tenant |
| `COST_RATES_FILE` | — | leave unset on Vercel (the rate-card file isn't at a stable path in the bundle); cost shows `rated:false` remotely, and `report.md`/tokens are unaffected |

## 4. Telemetry posture on Vercel

**OTel export is deliberately off in this deployment** — no
`PHOENIX_COLLECTOR_ENDPOINT` / `OTEL_EXPORTER_OTLP_ENDPOINT` is set, and
`TELEMETRY_RECORD_IO=false` is set as belt-and-braces. Vercel provides its
own observability: eve tags every workflow run with framework-owned
`$eve.*` attributes (session/turn tree, model, token counts) that power the
**Agent Runs** view under the project's Observability tab — no
`instrumentation.ts` configuration required, and no prompt/completion
content leaves the platform.

To export OTel traces from a deployment later, point
`OTEL_EXPORTER_OTLP_ENDPOINT` (+ `OTEL_EXPORTER_OTLP_HEADERS`) at a
**reachable hosted collector** (localhost Phoenix is not reachable from
Vercel) and keep `TELEMETRY_RECORD_IO=false` unless the backend is approved
for prompt content.

## 5. Calling the deployed agent

Auth fails closed: unauthenticated production requests get **401**. Two
ways in:

```bash
# a) eve dev against the deployment (mints a Vercel OIDC token via the link)
npx eve dev https://linkedin-cover-generator.vercel.app

# b) raw HTTP with basic auth
curl -u "operator:$PASSWORD" -X POST \
  https://linkedin-cover-generator.vercel.app/eve/v1/session \
  -H "Content-Type: application/json" \
  -d '{"message":"Create a LinkedIn cover from input=inputs/article.md, size=linkedin-article, palette=auto, approval=false."}'
# → {"sessionId":"wrun_...", ...}

curl -sN -u "operator:$PASSWORD" \
  https://linkedin-cover-generator.vercel.app/eve/v1/session/<sessionId>/stream
```

## 6. Post-deploy smoke test

1. `curl -X POST .../eve/v1/session` **without** auth → expect `401`.
2. Run one cover with basic auth (above) and stream to `turn.completed`.
3. The final message should reference `s3://<bucket>/runs/<run-id>/` —
   confirm the folder landed in the bucket (MinIO console or
   `aws s3 ls`). The bucket copy of `summary.json` carries
   `artifacts.objectStore`.
4. Check the run appears under the project's **Observability → Agent Runs**
   tab in the Vercel dashboard.
5. If the Teams channel is configured:
   `curl -X POST .../eve/v1/teams` → expect `401` (mounted, JWT-gated;
   a browser GET shows 404 — the route is POST-only), then run the
   [Web Chat test](./consume-from-teams.md#4-test-from-azure-web-chat-no-teams-client-needed).

### Reading production logs

`vercel logs linkedin-cover-generator.vercel.app` shows recent function
invocations (add `--json` for full messages). What to expect:

- `POST /eve/v1/teams → 200` — inbound bot activity accepted.
- `POST /.well-known/workflow/v1/flow` — the turn executing as a background
  workflow (this is where the actual run happens; the channel POST returns
  immediately).
- `[telemetry] ...: disabled (...)` on cold starts — confirms the OTel
  posture.
- The log window is short — trigger the action, then pull logs right away.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `401` with "Production auth is not configured" | `ROUTE_AUTH_BASIC_PASSWORD` unset **or empty** — set a real value and redeploy (env changes need a new deployment) |
| `ENOENT ... mkdir '/var/task/agent'` | `HOST_REPORT_ROOT` not set to `/tmp` |
| Run succeeds but no artifacts retrievable | `OBJECT_STORE_*` unset — `/tmp` is ephemeral; configure the bucket |
| Upload `failed` entries in the final message | endpoint is the console UI / has a path suffix / key lacks `s3:PutObject` — see [Upload Results to Object Store](./upload-results-to-object-store.md) |
| Cost `rated: false` in remote `summary.json` | expected — `COST_RATES_FILE` is not set on Vercel (see matrix) |
