---
title: Consume from Microsoft Teams
description: Chat with the agent as a Teams bot — Azure bot registration, endpoint wiring (Vercel or on-prem), env vars, and testing from a Teams client.
order: 7
updated: 2026-07-05
---

# Consume from Microsoft Teams

The Teams channel (`agent/channels/teams.ts`) runs the agent as a **Teams
bot** over the Bot Framework Activity protocol. eve mounts
`POST /eve/v1/teams`, verifies the Bot Connector JWT on every inbound
activity (the route is safe to expose publicly — unauthenticated POSTs get
401), streams replies back as Markdown, and renders human-in-the-loop
prompts as Adaptive Cards.

**Not Vercel-specific.** Teams messages flow
`Teams → Microsoft Bot Connector (cloud) → HTTPS POST → your endpoint`, so
the only hard requirement is that `/eve/v1/teams` is reachable over public
HTTPS. Vercel, an on-prem server behind a reverse proxy, or a laptop behind
a tunnel all work.

## Prerequisites

- An **Azure account** (free tier is enough) to register the bot.
- A Teams tenant where you can **upload a custom app** ("sideloading").
  Free/personal Teams often blocks this — a
  [Microsoft 365 Developer tenant](https://developer.microsoft.com/microsoft-365/dev-program)
  has it enabled and is the reliable sandbox.

## 1. Register the bot in Azure

1. Azure Portal → **Create a resource → Azure Bot**.
   - Type of App: **Multi Tenant** (simplest; use Single Tenant + set
     `MICROSOFT_TENANT_ID` if your org requires it).
   - Creation type: create a new Microsoft App ID.
2. On the bot resource → **Configuration**:
   - Copy the **Microsoft App ID** → `MICROSOFT_APP_ID`.
   - "Manage Password" → create a **client secret** → `MICROSOFT_APP_PASSWORD`.
   - Set **Messaging endpoint** (pick your hosting posture below).
3. Bot resource → **Channels → Microsoft Teams** → enable.

### Messaging endpoint per hosting posture

| Posture | Endpoint |
|---|---|
| Vercel (this project) | `https://linkedin-cover-generator.vercel.app/eve/v1/teams` |
| On-prem `eve start` behind TLS proxy | `https://agent.your-domain.com/eve/v1/teams` |
| Local learning (`eve dev` + tunnel) | `https://<id>.ngrok.app/eve/v1/teams` (`ngrok http 3839` / `cloudflared tunnel`) |

## 2. Configure the agent

Env vars (all three postures):

```dotenv
MICROSOFT_APP_ID=00000000-0000-0000-0000-000000000000
MICROSOFT_APP_PASSWORD=your-bot-client-secret
# MICROSOFT_TENANT_ID=...   # single-tenant bots only
```

- Local: add to `agents/linkedin-cover-generator/.env` (never mid-run —
  the reload kills in-flight turns).
- Vercel: `printf '%s' "$VALUE" | vercel env add MICROSOFT_APP_ID production`
  (repeat for the secret), then `vercel deploy --prod` — env changes need a
  new deployment.

The channel file is already in place; nothing else to code:

```ts
// agent/channels/teams.ts
import { teamsChannel } from "eve/channels/teams";
export default teamsChannel();
```

## 3. Add the bot to Teams

Quickest path: bot resource → **Channels → Microsoft Teams → Open in
Teams** — starts a personal chat with the bot.

For an installable app (org catalog, channels/group chats), create a Teams
app package referencing your App ID — the
[Developer Portal for Teams](https://dev.teams.microsoft.com/) does this
without hand-writing `manifest.json`: New app → fill basics → App features
→ **Bot** → pick your existing bot → scopes (personal, team) → Publish →
download/upload the zip (requires sideloading permission).

## 4. Talk to it

- **Personal chat:** just message it —
  `Create a LinkedIn cover from input=https://example.com/article, palette=auto.`
- **Channel/group:** @mention the bot; un-mentioned chatter is ignored by
  default.
- Replies arrive as Markdown; long outputs split across messages; a typing
  indicator shows while the run executes. Cover artifacts land in the
  object store as usual — the final message names the bucket + prefix
  (see [Upload Results to Object Store](./upload-results-to-object-store.md)).

## Behavior & customization

The default dispatch is defined by `teamsChannel()`: personal messages
always run; channel/group messages require an @mention; ambient
resource-consent activities are dropped. Customize via `onMessage` /
`onInvoke` / `files` options (inbound file downloads are **off** by
default) — see `node_modules/eve/docs/channels/teams.mdx`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Opening the URL in a browser → 404 "Cannot find any route matching [GET] ..." | **Expected** — the route is POST-only (the Bot Connector POSTs activities); a browser GET proves nothing. Health-check with `curl -X POST` instead |
| `curl POST /eve/v1/teams` → 401 | **Expected** — the route only accepts JWT-signed Bot Connector traffic; 404-on-GET + 401-on-POST together mean the channel is mounted and healthy |
| Bot never replies in Teams | Messaging endpoint wrong (must be the public HTTPS URL ending `/eve/v1/teams`), or env vars missing in the deployed environment (redeploy after `vercel env add`) |
| Replies fail with auth errors in server logs | `MICROSOFT_APP_PASSWORD` wrong/expired (secrets expire — rotate in Azure and update env) |
| Works in personal chat, silent in a channel | The bot wasn't @mentioned, or the app package lacks the `team` scope |
| Can't upload the app in Teams | Sideloading disabled in the tenant — use a Microsoft 365 Developer tenant or ask the Teams admin |
