---
title: Secure the Endpoints
description: Hardening checklist — agent HTTP routes, object-store credentials, telemetry data, and secrets hygiene for local and deployed environments.
order: 4
updated: 2026-07-05
---

# Secure the Endpoints

Four surfaces need attention: the agent's HTTP API, the object-store
credentials, the telemetry data path, and the secrets themselves.

## 1. Agent HTTP routes (`/eve/v1/session*`)

Route auth is declared in `agent/channels/eve.ts`. The current policy
chain:

| Helper | Admits | Notes |
|---|---|---|
| `localDev()` | local development requests | dev only; inert in production |
| `vercelOidc()` | Vercel-issued deployment tokens | lets `eve dev <url>` and trusted internal deployments call the agent |
| `httpBasic(...)` | callers with the shared secret | **only active when `ROUTE_AUTH_BASIC_PASSWORD` is set**; username defaults to `operator` (`ROUTE_AUTH_BASIC_USER` overrides) |
| `placeholderAuth()` | nothing in production | fails closed — unauthenticated production requests get 401 |

Rules of thumb:

- **Production fails closed by default** — with no basic-auth password set
  and no OIDC token, deployed routes return 401. That is intentional;
  don't "fix" it by removing `placeholderAuth()`.
- To grant human/scripted access to a deployment, set
  `ROUTE_AUTH_BASIC_PASSWORD` (strong, per-environment, via
  `vercel env add`) and call with
  `curl -u operator:$PASSWORD https://<deployment>/eve/v1/session ...`.
- For a public app, replace the chain with real auth (your own OIDC/JWT
  verification, API-key verifier, or custom `AuthFn`) — the built-ins are
  for development and trusted infrastructure only.
- A session's `continuationToken` authorizes follow-ups to that session —
  treat tokens and session ids as secrets in logs.

## 2. Object-store credentials

- Use a **dedicated access key scoped to this bucket** — ideally
  write-only (`s3:PutObject` on `arn:...:bucket/runs/*`). The agent never
  needs list/read/delete.
- Keys live in env (`.env` locally, `vercel env add` deployed) — never in
  code, never committed. `.env` is gitignored repo-wide.
- Use TLS endpoints only (`https://`); MinIO behind a reverse proxy is
  fine.
- **Think twice before setting `OBJECT_STORE_PUBLIC_BASE_URL`** — it
  implies a world-readable bucket of article-derived covers, specs, and
  reports. Leave it unset (callers fetch with their own S3 credentials),
  or serve through a CDN with signed URLs; presigned-URL support is a
  sensible follow-up if sharing links is needed.
- Bucket lifecycle/retention is deliberately out of the agent's hands —
  set bucket-level rules for expiry.

## 3. Telemetry data

- **Traces contain prompts, completions, and tool payloads by default.**
  For any deployed or shared environment set `TELEMETRY_RECORD_IO=false` —
  spans keep timing, tokens, and structure while omitting content.
- Local Phoenix (`docker compose up -d`) has **no authentication** — it
  binds to localhost for your eyes only. Do not port-forward or expose
  :6006/:4317 publicly; anyone who reaches the UI reads your prompts.
- Hosted collectors (hosted Phoenix, Arize, Datadog, etc.) authenticate
  via `OTEL_EXPORTER_OTLP_HEADERS=api_key=...` — header values go only to
  the exporter and are never logged.
- Review the exporter's data-retention path before enabling export of
  regulated or customer data; you are responsible for provider approval.
- The startup log line (`[telemetry] <agent>: exporting ... / disabled`)
  is the audit trail for whether a given server process exports at all.

## 4. Secrets hygiene

- All per-agent secrets live in `agents/<name>/.env` (gitignored via
  `agents/*/.env`); templates with placeholders live in `.env.example`.
- Model keys, image keys, object-store keys, basic-auth passwords, and
  OTLP headers all follow the same rule: env only, per environment, least
  scope.
- On Vercel: `vercel env add <VAR> production|preview|development` — never
  bake secrets into the build.
- Rotating a credential is a `.env` edit + worker reload (automatic in
  `eve dev`) — but **never edit `.env` while a run is in flight**; the hot
  reload kills the in-progress turn.
