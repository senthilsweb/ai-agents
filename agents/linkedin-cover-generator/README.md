# LinkedIn Cover Agent

Turn an article (local file, remote URL, or pasted text) into a polished
**LinkedIn cover image**. Uses one orchestrator reasoning pass, one image
generation call, deterministic dimension validation, and no unbounded review
loop. Built on the [Vercel Eve](https://vercel.com/eve) agent framework.

This agent lives at `agents/linkedin-cover-generator/` in the `ai-agents` monorepo.
All paths below are relative to that folder unless noted.

> **Design notes:** see [`DESIGN.md`](DESIGN.md) for the architecture,
> determinism boundary, model resolution, and cost-effectiveness decisions.

## Documentation

Fine-grained guides live in [`docs/`](docs/):

| Guide | What it covers |
|---|---|
| [Quick Setup](docs/quick-setup.md) | Zero-to-first-cover: install, `.env`, dev server, headless HTTP runs, outputs, gotchas |
| [Run with Telemetry](docs/run-with-telemetry.md) | OTel traces to Arize Phoenix (repo-root `docker compose up -d`), custom spans, privacy toggles |
| [Upload Results to Object Store](docs/upload-results-to-object-store.md) | Persisting run folders to AWS S3 / MinIO, endpoint gotchas, failure semantics |
| [Secure the Endpoints](docs/secure-the-endpoints.md) | Route auth, credential scoping, telemetry data safety, secrets hygiene |
| [Deploy to Vercel](docs/deploy-to-vercel.md) | Production deploys: link, full env/secrets matrix, telemetry posture, remote smoke test |
| [Consume the Deployed Agent](docs/consume-the-deployed-agent.md) | Running covers remotely via curl, Postman, the TypeScript SDK, a web app, or the eve TUI |

---

## Prerequisites

- **Node 24+** — Eve requires it. Use `nvm use 24` if you have multiple versions.
- **Docker** — the sandbox uses `ghcr.io/vercel/eve:latest`. On Vercel
  deployments it auto-switches to Vercel Sandbox.
- Network access to your model provider (OpenAI by default, or any
  OpenAI-compatible provider / Vercel AI Gateway).

---

## Setup

### 1 — Install dependencies

From the **repo root** (installs all workspace agents):

```bash
nvm use 24
npm install
```

### 2 — Configure environment variables

This agent has its **own `.env` file** — separate from the diagram generator's
`.env` at the repo root. Eve loads `.env` from the agent folder when you run
`eve dev` from there.

```bash
cd agents/linkedin-cover-generator
cp .env.example .env
```

Edit `.env` and fill in your provider keys. The finalized config uses OpenAI
for both the orchestrator and image generation:

```dotenv
# Orchestrator — one bounded creative cover-spec pass (reasoning + vision)
MODEL_ORCHESTRATOR=gpt-5.4-mini
MODEL_ORCHESTRATOR_BASE_URL=https://api.openai.com/v1
MODEL_ORCHESTRATOR_API_KEY=your-openai-key

# Image generation — OpenAI gpt-image-2
IMAGE_MODEL=gpt-image-2
IMAGE_BASE_URL=https://api.openai.com/v1
IMAGE_API_KEY=your-openai-key

# Loop control — minimize cost
ENABLE_REVIEW=false
MAX_IMAGE_RETRIES=0
```

Models are model-agnostic and env-driven — there is no built-in default model
id. See [Model configuration](#model-configuration) below for all env vars and
alternatives.

---

## Run in dev mode

From the **agent folder**:

```bash
nvm use 24
npx eve dev --port 3535
```

This starts `eve dev` — an interactive TUI where you type prompts. The agent
creates a run folder, builds a cover spec, generates the image, validates
dimensions, and writes a report. Run artifacts (cover image, report, summary)
are synced from the Docker sandbox back to `agent/sandbox/workspace/runs/`
after each run.

> **Note:** Use `npx eve dev` directly rather than `npm run dev`. The latter
> may pick up the wrong Node version from your shell. Always activate Node 24
> first with `nvm use 24`.

---

## Test with examples

Reference articles live in `agent/sandbox/workspace/inputs/`. Drop a `.md` file
there, or use a remote URL, or paste text inline.

> **Path note:** `input=inputs/<article>.md` is resolved relative to the
> **sandbox workspace folder** (`agent/sandbox/workspace/`), not the agent
> root and not the repo root. A file at
> `agent/sandbox/workspace/inputs/article.md` is referenced as
> `input=inputs/article.md` — do not prefix it with `agent/sandbox/workspace/`
> or `agents/linkedin-cover-generator/`.

### Example 1 — From a local article file

```
Create a LinkedIn cover from input=inputs/article.md, size=linkedin-article,
palette=auto, approval=false.
```

### Example 2 — From a remote URL

```
Create a LinkedIn cover from input=https://example.com/article, size=1280x720.
```

### Example 3 — Approval mode (stop before image generation)

Writes a proposal + cover spec and stops. Resume after review:

```
Create a cover from input=inputs/article.md, approval=true.
```

### Example 4 — Custom palette and density

```
Create a LinkedIn cover from input=inputs/article.md, palette=charcoal-gold-teal,
density=balanced, size=linkedin-post.
```

### Example 5 — Advanced: full control with custom size, palette, layout, and brands

This example exercises every option: a custom canvas size (must be divisible by
16 for the image API), an explicit palette, a centered-minimal layout, balanced
density, brand names included, and approval mode so you can review the spec
before the image is generated.

```
Create a LinkedIn cover from input=inputs/article.md,
size=1088x1088,
palette=indigo-lime,
layout=centered-minimal,
density=balanced,
include_brands=true,
approval=true.
```

**What each option does:**

| Option | Value | Effect |
|---|---|---|
| `size` | `1088x1088` | Square canvas (divisible by 16); overrides the default `linkedin-article` preset |
| `palette` | `indigo-lime` | Uses `#17163b`, `#6874ff`, `#b7e54a`, `#eaf7ff` — high-contrast dark indigo with lime accent |
| `layout` | `centered-minimal` | Title and visual centered with generous negative space |
| `density` | `balanced` | More visual elements than `minimal`, but still clean |
| `include_brands` | `true` | Company/product names from the article are included in the cover |
| `approval` | `true` | Stops after writing `cover-spec.json` + `proposal.md`; resumes after you approve |

**Available palettes:**

| Palette | Colors | Mood |
|---|---|---|
| `navy-cyan-violet` | `#07152f` `#16d9ff` `#7657ff` `#e34cff` | Dark tech, vibrant neon |
| `cream-emerald` | `#f7f0df` `#0b4f3f` `#23a477` `#d6b85f` | Warm, organic, premium |
| `charcoal-gold-teal` | `#101515` `#e7b94d` `#38d6c5` `#f7f4e8` | Luxe, dark with gold |
| `soft-blue-pink` | `#dcecff` `#3578ff` `#8e5cff` `#f275d4` | Light, playful, modern |
| `warm-coral-amber` | `#fff2e6` `#ff6b4a` `#ffad4d` `#164b62` | Warm, energetic, bold |
| `indigo-lime` | `#17163b` `#6874ff` `#b7e54a` `#eaf7ff` | Dark indigo, lime pop |
| `auto` | (varies) | Picks a palette automatically; avoids the previous run's palette |

**Custom size note:** The image generation API requires both width and height
to be divisible by 16. If you pass a size that isn't (e.g. `1279x720`), the
agent snaps each dimension to the nearest multiple of 16 (e.g. `1280x720`)
and validates with a 16px tolerance.

---

## Prompt options

All options are optional. The agent parses them from your message text.

| Option | Default | Meaning |
|---|---|---|
| `input` | — | local path, remote URL, or inline article text |
| `size` | `linkedin-article` | preset name or `WxH` (see presets below) |
| `palette` | `auto` | palette name or `auto` (avoids previous run's palette) |
| `density` | `minimal` | `minimal` or `balanced` |
| `layout` | (auto) | `editorial-left-visual-right` / `centered-minimal` / `split-balanced` |
| `approval` | `false` | write proposal + spec and stop before image generation |
| `review` | `false` | one optional reviewer call (requires `ENABLE_REVIEW=true`) |
| `retry_on_failure` | `false` | one retry on hard validation failure (requires `MAX_IMAGE_RETRIES>0`) |
| `include_brands` | `false` | include company/product names (excluded by default) |
| `variations` | `1` | number of variations to generate |
| `reference` | — | path to a reference image in `inputs/` |

### Size presets

| Preset | Canvas | Good for |
|---|---|---|
| `linkedin-article` | `1280 × 720` | **Default.** LinkedIn article cover |
| `linkedin-profile` | `1584 × 400` | Profile background banner |
| `linkedin-post` | `1200 × 624` | Feed post image |
| `carousel` | `1088 × 1344` | Carousel slide |
| `square` | `1088 × 1088` | Square social post |

Dimensions are divisible by 16 for image API compatibility. Use an explicit
`size=1040x660` to override the preset (values are snapped to the nearest
multiple of 16 automatically).

---

## Model configuration

### Environment variables

Set these in `agents/linkedin-cover-generator/.env`. Each role resolves
`MODEL_<ROLE>_* → MODEL_* →` an explicit startup error (no built-in default,
per ADR 0001 §4).

| Variable | Fallback | Description |
|---|---|---|
| `MODEL_ORCHESTRATOR` | `MODEL` | Model id for the orchestrator (cover-spec pass) |
| `MODEL_ORCHESTRATOR_BASE_URL` | `MODEL_BASE_URL` | API base URL for the orchestrator |
| `MODEL_ORCHESTRATOR_API_KEY` | `MODEL_API_KEY` | API key for the orchestrator |
| `MODEL_CONTEXT_WINDOW_TOKENS` | `128000` | Context window size for compaction |
| `IMAGE_MODEL` | `gpt-image-2` | Image generation model id |
| `IMAGE_BASE_URL` | `MODEL_BASE_URL` | Image API base URL |
| `IMAGE_API_KEY` | `MODEL_API_KEY` | Image API key |
| `IMAGE_QUALITY` | `high` | Image quality (`high` / `standard` / `low`) |
| `ENABLE_REVIEW` | `false` | Enable the optional reviewer call |
| `MAX_IMAGE_RETRIES` | `0` | Max image regeneration retries on hard failure |
| `ALLOW_COST` | `true` | Compute cost in the deterministic report tool |

Report assembly is a deterministic tool, so there is **no reporter model**.

### Finalized model matrix

| Role | Model | Provider | Notes |
|---|---|---|---|
| Orchestrator | `gpt-5.4-mini` | OpenAI | One bounded creative cover-spec pass; vision-capable for optional reference images |
| Image | `gpt-image-2` | OpenAI | The cover image itself |
| Reporter | — | — | Deterministic tool (`render_and_save_report`), no model |

### Alternative configurations

```dotenv
# Single generic model for the orchestrator (simplest)
MODEL=gpt-5.4-mini
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_API_KEY=your-openai-key

# Image still needs separate config
IMAGE_MODEL=gpt-image-2
IMAGE_BASE_URL=https://api.openai.com/v1
IMAGE_API_KEY=your-openai-key

# Orchestrator via Vercel AI Gateway
MODEL_ORCHESTRATOR=openai/gpt-5.4-mini
AI_GATEWAY_API_KEY=...
```

---

## How it works

The agent is the **Orchestrator**. On each turn it:

1. **Creates a run folder** — `runs/<UTC-timestamp>/` via `create_run`.
2. **Loads the input** — `load_input` reads a local file, fetches a URL, or
   accepts inline text. Uses Readability + gray-matter for clean extraction.
3. **Builds a Cover Spec** — one orchestrator reasoning pass creates
   `cover-spec.json` matching the schema (title, subtitle, palette, layout,
   visual concept, etc.).
4. **Builds the image prompt** — `build_prompt` deterministically constructs
   the image generation prompt from the spec (no model call).
5. **Generates the image** — `generate_image` calls the image provider and
   saves `outputs/cover.png`.
6. **Validates dimensions** — `validate_image` checks exact pixel dimensions
   using sharp (no model call). Reports hard failure on mismatch.
7. **Assembles the report deterministically** — `render_and_save_report` reads
   the phase traces + `run-meta.json` + `cover-spec.json`, computes timing,
   token, and cost metrics (from the shared usage hook + cost matrix), and
   writes `report.md` + `summary.json`. No LLM.
8. **Copies the run to the host** — `sync_run_to_host` pulls the whole run
   folder (including the binary `cover.png`) back from the sandbox.

### Loop policy

- **No review loop by default.** `ENABLE_REVIEW=false` skips the reviewer.
- **No retry by default.** `MAX_IMAGE_RETRIES=0` means no regeneration.
- One optional retry only on hard validation failure, only when explicitly
  enabled.

---

## What a run produces

Each run gets its own UTC-timestamped folder under `runs/`:

```
runs/
└── 2026-06-21T12-00-00Z/
    ├── run-meta.json          # request, options, started_at
    ├── cover-spec.json        # the Cover Spec
    ├── outputs/
    │   └── cover.png          # the generated cover image
    ├── report.md              # human-readable run summary
    └── summary.json           # machine-readable rollup
```

---

## Object storage for run artifacts (deployed environments)

On a Vercel deployment the host run mirror lives in the Function's ephemeral
`/tmp`, so a remote caller can never retrieve `cover.png`. The shared-kit
tool `upload_run_to_object_store` (re-exported at
`agent/tools/upload_run_to_object_store.ts`) fixes that: after
`sync_run_to_host`, it uploads the **entire** `runs/<run-id>/` folder to any
S3-compatible bucket, preserving the folder layout under a `runs/<run-id>/`
key prefix, and patches `summary.json` with an `artifacts.objectStore` block
(bucket, prefix, uploaded file list) before uploading it last.

**It is a no-op unless `OBJECT_STORE_BUCKET` is set** — local dev needs
nothing and keeps working off the host mirror.

```dotenv
# AWS S3
OBJECT_STORE_BUCKET=my-agent-runs
OBJECT_STORE_REGION=us-east-1
OBJECT_STORE_ACCESS_KEY_ID=...
OBJECT_STORE_SECRET_ACCESS_KEY=...

# MinIO (same code path — only endpoint/path-style differ)
OBJECT_STORE_BUCKET=agent-runs
OBJECT_STORE_REGION=us-east-1
OBJECT_STORE_ACCESS_KEY_ID=...
OBJECT_STORE_SECRET_ACCESS_KEY=...
OBJECT_STORE_ENDPOINT=https://minio.internal:9000
OBJECT_STORE_FORCE_PATH_STYLE=true

# Optional: public bucket/CDN → publicUrl per uploaded file
OBJECT_STORE_PUBLIC_BASE_URL=https://cdn.example.com
```

Where a remote caller finds the run: the final assistant message includes
the bucket + prefix (and public URLs when configured), and `summary.json`
carries the same under `artifacts.objectStore` — no free-text parsing
needed. Per-file upload failures are reported in the tool result and the
final message; they never fail the run.

---

## Observability (OpenTelemetry + Arize Phoenix)

Three layers observe a run:

1. **Per-run rollup** (always on) — the shared usage hook + deterministic
   report: `report.md` / `summary.json` with tokens, steps, soft budgets,
   cost.
2. **`$eve.*` workflow run tags** (automatic on Vercel) — power the Agent
   Runs dashboard tab; not configurable from this repo.
3. **OTel traces** (this section; off by default) — a full span tree per
   turn: every model call and tool call with prompts, completions, tokens,
   and timing, plus a custom `cover.image_generation` span around the
   image-API call (which the automatic spans can't see).

The pipeline is shared-kit code (`shared/lib/instrumentation.ts`);
`agent/instrumentation.ts` here only adds cover-specific span attributes
(`cover.orchestrator_model`, `cover.image_model`). Traces export only when
an endpoint is configured:

```bash
# Local Phoenix in one container
docker run -d --name phoenix -p 6006:6006 arizephoenix/phoenix:latest
echo 'PHOENIX_COLLECTOR_ENDPOINT=http://localhost:6006' >> .env
npx eve dev --port 3535
# run a cover, then open http://localhost:6006 → traces
```

Any OTLP backend works instead of Phoenix — set
`OTEL_EXPORTER_OTLP_ENDPOINT` (+ `OTEL_EXPORTER_OTLP_HEADERS` for API keys).
Both endpoint vars unset ⇒ telemetry fully off; an unreachable backend drops
spans and never affects a run.

**Correlating a run with its trace:** `summary.json` →
`perSession[].sessionId` → filter traces on `eve.session.id`.

**Privacy:** spans record full prompts/completions by default. Set
`TELEMETRY_RECORD_IO=false` (recommended for deployed environments) to keep
timing/token spans while omitting message and payload content.

**Custom signals from code (need basis):** import from
`shared/lib/telemetry.js` — `withSpan(name, attrs, fn)`, `logEvent(name,
attrs)`, `counter(name)`, `histogram(name)`. All calls are guaranteed no-ops
when telemetry is off, so no feature flags are needed at call sites. See
`agent/tools/generate_image.ts` for the exemplar.

**Adopting in another agent** is one file:

```ts
// agents/<name>/agent/instrumentation.ts
import { createAgentInstrumentation } from "shared/lib/instrumentation.js";
export default createAgentInstrumentation({
  attributes: () => ({ "myagent.model": process.env.MODEL_ORCHESTRATOR ?? "" }),
});
```

---

## Build

```bash
# From the agent folder
nvm use 24
npx eve build
```

## Typecheck

```bash
# From the agent folder
nvm use 24
npx tsgo
```

---

## Deploying to Vercel

This agent depends on the monorepo's root [`shared`](../../shared) workspace
package (`"shared": "*"` in `package.json`), so it must be deployed with the
**whole repo** as build context, not just this folder.

### 1 — Link the project with a Root Directory

Set the Vercel project's **Root Directory** to
`agents/linkedin-cover-generator` (Project Settings → General, or via the API:
`PATCH /v9/projects/:id { "rootDirectory": "agents/linkedin-cover-generator" }`),
then link and deploy from the **monorepo root** so the whole repo (including
`shared/`, the root `package.json`, and `package-lock.json`) is uploaded as
build context:

```bash
# from the repo root
vercel link --yes --project linkedin-cover-generator --scope <your-team-id>
vercel deploy --prod
```

`vercel deploy --dry --format=json` is useful to confirm `shared/**` is
included in the upload before deploying for real.

### 2 — Push env vars / secrets from `.env`

Vercel doesn't read this agent's `.env` automatically — push each variable as
a project env var (Production, Preview, and Development):

```bash
vercel env add MODEL_ORCHESTRATOR production
vercel env add MODEL_ORCHESTRATOR_API_KEY production
vercel env add IMAGE_MODEL production
vercel env add IMAGE_API_KEY production
# ...repeat per variable, per environment (or per `vercel env add --help`)
```

### 3 — `HOST_REPORT_ROOT` is required in the deployed environment

`create_run` / `sync_run_to_host` (`shared/lib/run.ts`) mirror run artifacts to
`${HOST_REPORT_ROOT}/agent/sandbox/workspace/...`, which defaults to
`process.cwd()`. Locally that's the agent folder (writable). On Vercel, a
Function's `cwd` is the **read-only** `/var/task` deployment bundle, so
`create_run` fails with `ENOENT: ... mkdir '/var/task/agent'` unless
`HOST_REPORT_ROOT` is redirected to a writable path:

```bash
vercel env add HOST_REPORT_ROOT production   # value: /tmp
vercel env add HOST_REPORT_ROOT preview      # value: /tmp
vercel env add HOST_REPORT_ROOT development  # value: /tmp
```

> **Known limitation:** `/tmp` is ephemeral and local to the Function
> instance — a remote caller cannot retrieve `cover.png` (or any other run
> artifact) from it. See the
> [`store-run-artifacts-in-object-storage`](openspec/changes/store-run-artifacts-in-object-storage/proposal.md)
> proposal for uploading each timestamped run folder to an S3-compatible
> bucket (AWS S3 or MinIO) so it's durably retrievable.

### 4 — Auth for testing a remote deployment

The scaffolded `agent/channels/eve.ts` ships `[localDev(), vercelOidc(),
placeholderAuth()]`, which rejects all unauthenticated production traffic
(`placeholderAuth()` fails closed). Two ways to reach a deployed session:

- **`eve dev <url>`** — if your local checkout is linked to the same Vercel
  project (`vercel link` was run in this repo), `eve dev` mints a Vercel OIDC
  token automatically and `vercelOidc()` accepts it (the current project is
  always trusted). No extra setup needed:
  ```bash
  npx eve dev https://<your-app>.vercel.app
  ```
- **Raw HTTP / curl** — there's no local Vercel CLI session to mint an OIDC
  token from, so `eve.ts` adds an opt-in `httpBasic()` fallback, gated on a
  `ROUTE_AUTH_BASIC_PASSWORD` env var (inert when unset, so it never changes
  behavior unless you configure it):
  ```bash
  vercel env add ROUTE_AUTH_BASIC_USER production      # e.g. operator
  vercel env add ROUTE_AUTH_BASIC_PASSWORD production  # a generated secret
  ```
  Then:
  ```bash
  curl -X POST https://<your-app>.vercel.app/eve/v1/session \
    -u "operator:<password>" \
    -H 'content-type: application/json' \
    -d '{"message":"Create a LinkedIn cover from input=<url>, palette=soft-blue-pink, density=balanced, size=1280x720"}'
  ```

---

## Folder layout

```
agents/linkedin-cover-generator/
├── agent/
│   ├── agent.ts                   # orchestrator model config (shared resolveModel)
│   ├── instructions.md            # always-on Orchestrator system prompt
│   ├── lib/
│   │   ├── schemas.ts             # Cover Spec zod schema
│   │   ├── presets.ts             # size presets (linkedin-article, etc.)
│   │   ├── palettes.ts            # color palette definitions
│   │   └── prompt-builder.ts      # deterministic image prompt builder
│   ├── hooks/
│   │   └── usage.ts               # re-exports the shared token-usage hook
│   ├── sandbox/
│   │   └── sandbox.ts             # extends the shared base sandbox
│   ├── skills/
│   │   ├── art_direction.md       # visual style guidelines
│   │   ├── linkedin_layout.md     # safe zones, margins, composition
│   │   ├── brand_safety.md        # what to exclude by default
│   │   └── title_crafting.md      # title extraction + editing rules
│   ├── tools/
│   │   ├── create_run.ts          # make the timestamped run folder (shared run)
│   │   ├── load_input.ts          # load article from file/URL/text
│   │   ├── build_prompt.ts        # validate spec + build image prompt
│   │   ├── generate_image.ts      # call image provider, save PNG
│   │   ├── validate_image.ts      # check exact dimensions with sharp
│   │   ├── write_orchestrate_trace.ts # orchestrate phase trace
│   │   ├── render_and_save_report.ts  # deterministic report.md + summary.json
│   │   ├── read_usage.ts          # re-exports the shared usage reader
│   │   ├── sync_run_to_host.ts    # re-exports the shared copy-back
│   │   ├── read_run_file.ts       # read a text artifact from a run
│   │   └── write_run_file.ts      # write a text artifact into a run (shared run)
│   └── channels/eve.ts            # the eve HTTP/TUI channel
├── .env.example                   # per-agent env template
├── package.json                   # per-agent manifest
├── tsconfig.json                  # per-agent TS config (extends base)
└── README.md                      # this file
```

---

## Importing shared code

This agent consumes the shared Agent Runtime Kit (model resolution, run-folder
mirror, usage hook, cost matrix, copy-back, base sandbox) as the `shared`
workspace package:

```typescript
import { resolveModel } from "shared/lib/model.js";
import { writeRunArtifact } from "shared/lib/run.js";
```

Agent-private helpers live in `agent/lib/` and are imported via `#lib/*`:

```typescript
import { CoverSpecSchema } from "#lib/schemas.js";
```

See [`shared/README.md`](../../../shared/README.md) and
[`openspec/adr/0001-shared-agent-runtime-kit.md`](../../../openspec/adr/0001-shared-agent-runtime-kit.md)
for the shared-kit contract.
