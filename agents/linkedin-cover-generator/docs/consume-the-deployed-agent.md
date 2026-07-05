---
title: Consume the Deployed Agent
description: Run covers against the Vercel deployment from curl, Postman, scripts (TypeScript SDK), a web app, or the eve TUI — auth, streaming, follow-ups, and fetching the results.
order: 6
updated: 2026-07-05
---

# Consume the Deployed Agent

Production base URL: `https://linkedin-cover-generator.vercel.app`. The
agent speaks eve's HTTP session protocol — three routes cover everything:

| Route | Purpose |
|---|---|
| `POST /eve/v1/session` | start a session with a prompt → `{sessionId, continuationToken}` |
| `POST /eve/v1/session/:sessionId` | send a follow-up turn (needs the `continuationToken`) |
| `GET /eve/v1/session/:sessionId/stream` | stream events as NDJSON (replays from the start on reconnect) |

**Auth:** production fails closed. Every request needs either HTTP Basic
credentials (`ROUTE_AUTH_BASIC_USER` / `ROUTE_AUTH_BASIC_PASSWORD` — pull
them with `vercel env pull --environment=production`) or a Vercel OIDC
token (automatic with `eve dev <url>` from the linked repo).

**Prompts** are plain text; options ride inside the message (see the README
"Prompt options" table):

```
Create a LinkedIn cover from input=<inputs/file.md | https://url | pasted text>,
size=linkedin-article, palette=auto, density=minimal, approval=false.
```

> Deployed runs read bundled inputs (e.g. `inputs/article.md`) — for your
> own content, pass a **remote URL** or paste the article text directly
> into the message.

## 1. curl

```bash
BASE=https://linkedin-cover-generator.vercel.app
AUTH="operator:$PASSWORD"

# start a run
RESP=$(curl -s -u "$AUTH" -X POST $BASE/eve/v1/session \
  -H "Content-Type: application/json" \
  -d '{"message":"Create a LinkedIn cover from input=https://example.com/my-article, size=linkedin-article, palette=auto, approval=false."}')
SID=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['sessionId'])")
TOKEN=$(echo "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin)['continuationToken'])")

# stream until the turn completes (NDJSON, one event per line)
curl -sN -u "$AUTH" $BASE/eve/v1/session/$SID/stream \
  | grep --line-buffered -E '"type":"(message.completed|turn.completed|session.failed)"'

# optional follow-up turn on the same session
curl -s -u "$AUTH" -X POST $BASE/eve/v1/session/$SID \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"Regenerate with palette=indigo-lime.\",\"continuationToken\":\"$TOKEN\"}"
```

Useful event types on the stream: `message.appended` (assistant text
deltas), `actions.requested` / `action.result` (tool calls — the
`upload_run_to_object_store` result carries the bucket manifest),
`message.completed`, `turn.completed`. The stream **replays from the
beginning** on every reconnect, so a dropped connection loses nothing.

## 2. Postman

1. **Request 1 — start:** `POST {{base}}/eve/v1/session`, *Authorization*
   tab → **Basic Auth** (username/password), *Body* → raw JSON:
   `{"message": "Create a LinkedIn cover from input=..., palette=auto."}`.
   Save `sessionId` and `continuationToken` from the response (e.g. in a
   Tests script: `pm.collectionVariables.set("sid", pm.response.json().sessionId)`).
2. **Request 2 — stream:** `GET {{base}}/eve/v1/session/{{sid}}/stream`,
   same Basic Auth. Postman displays the NDJSON as it arrives; the request
   stays open until the run ends (2–4 minutes for a full cover — raise
   Postman's request timeout in Settings). For long runs, re-sending the
   request later is fine: the stream replays all events.
3. **Request 3 — follow-up (optional):** `POST {{base}}/eve/v1/session/{{sid}}`
   with `{"message": "...", "continuationToken": "{{token}}"}`.

## 3. Scripts / backends — TypeScript SDK

For anything programmatic, `eve/client` beats hand-rolled fetch: it handles
auth on every call (including stream reconnects) and collapses the event
stream into a result.

```ts
import { Client } from "eve/client";

const client = new Client({
  host: "https://linkedin-cover-generator.vercel.app",
  auth: { basic: { username: "operator", password: process.env.COVER_AGENT_PASSWORD! } },
});

const session = client.session();
const response = await session.send(
  "Create a LinkedIn cover from input=https://example.com/my-article, palette=auto, approval=false.",
);
console.log(response.sessionId);

const result = await response.result(); // consumes the stream
console.log(result.status);   // "completed" | "waiting" | "failed"
console.log(result.message);  // final assistant text (includes bucket + prefix)
```

## 4. Web app

`useEveAgent()` (from `eve/react`, with Vue/Svelte equivalents) gives you
session state, streaming, and composer status out of the box; the
framework integrations (`withEve` for Next.js, `eve/nuxt`, SvelteKit
plugin) mount the eve routes on your app's origin.

```tsx
"use client";
import { useEveAgent } from "eve/react";

export function CoverComposer() {
  const agent = useEveAgent(); // same-origin /eve/v1/* by default
  // agent.send({ message: "Create a LinkedIn cover from input=..." })
  // render agent.data.messages; gate on agent.status
}
```

> **Never ship the basic-auth password to a browser.** Either proxy the
> eve routes through your app's backend (attach credentials server-side —
> the same-origin integration model above), or replace `httpBasic` in
> `agent/channels/eve.ts` with real user auth (OIDC/JWT, API keys) as
> described in [Secure the Endpoints](./secure-the-endpoints.md).

## 5. Terminal — eve TUI

From the linked repo checkout, no credentials needed (Vercel OIDC is
minted automatically):

```bash
npx eve dev https://linkedin-cover-generator.vercel.app
```

Type prompts interactively exactly as in local dev.

## Getting the results

The deployment's filesystem is ephemeral — artifacts are retrieved from
the object store, never from the Function:

1. The **final assistant message** names the bucket and prefix
   (`bucket ai-agents, prefix runs/<run-id>/`).
2. Machine consumers read `summary.json` → `artifacts.objectStore`
   (bucket, prefix, per-file list) — fetch
   `runs/<run-id>/summary.json` from the bucket with your S3 credentials.
3. `runs/<run-id>/cover.png` is the deliverable; `report.md` /
   `cover-spec.json` / `phases/*.json` carry the run record.

See [Upload Results to Object Store](./upload-results-to-object-store.md)
for the bucket layout and
[Deploy to Vercel](./deploy-to-vercel.md) for the env matrix behind all of
this.
