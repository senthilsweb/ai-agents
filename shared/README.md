# shared

Cross-agent utilities shared across all agents in the `ai-agents` monorepo.

## What belongs here

- **Authentication** — OAuth flows, token validation, session helpers
- **API clients** — shared HTTP clients, retry logic, rate limiting
- **Tool factories** — reusable `defineTool` factories (database, queue, etc.)
- **Types** — shared TypeScript types and zod schemas
- **Logging / observability** — structured logging, metrics helpers

## What does NOT belong here

- Agent-specific business logic (lives in `agents/<name>/agent/`)
- Agent-private helpers (lives in `agents/<name>/agent/lib/`)
- Skills, instructions, or prompts (per-agent, never shared)

## Importing

Each agent's `package.json` exposes `shared/` via the `#shared/*` import map:

```jsonc
{
  "imports": {
    "#shared/*": "../../shared/*"
  }
}
```

Use it from any agent tool or hook:

```typescript
import { getAuthToken } from "#shared/auth/index.js";
```

## Adding the first shared module

When the first real shared code lands:

1. Create the module folder (e.g. `shared/auth/`)
2. Add `shared/package.json` (workspace member):
   ```jsonc
   { "name": "shared", "private": true, "type": "module" }
   ```
3. Export from `shared/auth/index.ts`
4. Import via `#shared/auth/index.js` from any agent

Until then, this folder is a placeholder.
