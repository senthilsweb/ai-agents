# LinkedIn Cover Agent

Turn an article (local file, remote URL, or pasted text) into a polished
**LinkedIn cover image**. Uses one orchestrator reasoning pass, one image
generation call, deterministic dimension validation, and no unbounded review
loop. Built on the [Vercel Eve](https://vercel.com/eve) agent framework.

This agent lives at `agents/agent-linkedin-cover/` in the `ai-agents` monorepo.
All paths below are relative to that folder unless noted.

---

## Prerequisites

- **Node 24+** — Eve requires it. Use `nvm use 24` if you have multiple versions.
- **Docker** — the sandbox uses `ghcr.io/vercel/eve:latest`. On Vercel
  deployments it auto-switches to Vercel Sandbox.
- Network access to your model provider (z.ai, OpenAI, or Vercel AI Gateway).

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
cd agents/agent-linkedin-cover
cp .env.example .env
```

Edit `.env` and fill in your provider keys. The default config uses z.ai GLM
models (cheapest for testing) with OpenAI for image generation:

```dotenv
# Orchestrator — z.ai GLM-4.5-Air (cheap, fast reasoning)
MODEL_ORCHESTRATOR=glm-4.5-air
MODEL_ORCHESTRATOR_BASE_URL=https://api.z.ai/api/paas/v4/
MODEL_ORCHESTRATOR_API_KEY=your-z-ai-key

# Optional reviewer (only used when ENABLE_REVIEW=true)
MODEL_REVIEWER=glm-4.5-air
MODEL_REVIEWER_BASE_URL=https://api.z.ai/api/paas/v4/
MODEL_REVIEWER_API_KEY=your-z-ai-key

# Image generation — OpenAI gpt-image-2
IMAGE_MODEL=gpt-image-2
IMAGE_BASE_URL=https://api.openai.com/v1
IMAGE_API_KEY=your-openai-key

# Loop control — minimize cost
ENABLE_REVIEW=false
MAX_IMAGE_RETRIES=0
```

See [Model configuration](#model-configuration) below for all env vars and
alternatives.

---

## Run in dev mode

From the **repo root**:

```bash
npm run dev:linkedin
```

Or directly from the agent folder:

```bash
cd agents/agent-linkedin-cover
npm run dev
```

This starts `eve dev` — an interactive TUI where you type prompts. The agent
creates a run folder, builds a cover spec, generates the image, validates
dimensions, and writes a report.

---

## Test with examples

Reference articles live in `agent/sandbox/workspace/inputs/`. Drop a `.md` file
there, or use a remote URL, or paste text inline.

### Example 1 — From a local article file

```
Create a LinkedIn cover from input=inputs/article.md, size=linkedin-article,
palette=auto, approval=false.
```

### Example 2 — From a remote URL

```
Create a LinkedIn cover from input=https://example.com/article, size=1279x720.
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
| `linkedin-article` | `1279 × 720` | **Default.** LinkedIn article cover |
| `linkedin-profile` | `1584 × 396` | Profile background banner |
| `linkedin-post` | `1200 × 627` | Feed post image |
| `carousel` | `1080 × 1350` | Carousel slide |
| `square` | `1080 × 1080` | Square social post |

Use an explicit `size=1040x660` to override the preset.

---

## Model configuration

### Environment variables

Set these in `agents/agent-linkedin-cover/.env`. Each role reads role-specific
env vars that fall back to the generic `MODEL*` vars.

| Variable | Fallback | Description |
|---|---|---|
| `MODEL_ORCHESTRATOR` | `MODEL` | Model id for the orchestrator |
| `MODEL_ORCHESTRATOR_BASE_URL` | `MODEL_BASE_URL` | API base URL for the orchestrator |
| `MODEL_ORCHESTRATOR_API_KEY` | `MODEL_API_KEY` | API key for the orchestrator |
| `MODEL_REVIEWER` | `MODEL` | Model id for the optional reviewer |
| `MODEL_REVIEWER_BASE_URL` | `MODEL_BASE_URL` | API base URL for the reviewer |
| `MODEL_REVIEWER_API_KEY` | `MODEL_API_KEY` | API key for the reviewer |
| `MODEL_CONTEXT_WINDOW_TOKENS` | `128000` | Context window size for compaction |
| `IMAGE_MODEL` | `gpt-image-2` | Image generation model id |
| `IMAGE_BASE_URL` | `MODEL_BASE_URL` | Image API base URL |
| `IMAGE_API_KEY` | `MODEL_API_KEY` | Image API key |
| `IMAGE_QUALITY` | `high` | Image quality (`high` / `standard` / `low`) |
| `ENABLE_REVIEW` | `false` | Enable the optional reviewer call |
| `MAX_IMAGE_RETRIES` | `0` | Max image regeneration retries on hard failure |

### GPT → GLM/z.ai model mapping

The original GPT-family recommendations map to z.ai GLM equivalents:

| Role | GPT recommendation | GLM/z.ai equivalent | Notes |
|---|---|---|---|
| Orchestrator | `gpt-5.4-mini` | `glm-4.5-air` | Fast, cheap reasoning |
| Reviewer | `gpt-5.4-nano` | `glm-4.5-air` | Cheapest reasoning model |
| Image | `gpt-image-2` | `gpt-image-2` (OpenAI) | z.ai has no image model; use OpenAI |

### Alternative configurations

```dotenv
# Same model for orchestrator + reviewer (simplest)
MODEL=glm-4.5-air
MODEL_BASE_URL=https://api.z.ai/api/paas/v4/
MODEL_API_KEY=your-z-ai-key

# Image still needs separate config
IMAGE_MODEL=gpt-image-2
IMAGE_BASE_URL=https://api.openai.com/v1
IMAGE_API_KEY=your-openai-key

# Claude orchestrator via Vercel AI Gateway
MODEL_ORCHESTRATOR=anthropic/claude-sonnet-4.6
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
7. **Writes the report** — `write_report` generates `report.md` + `summary.json`.

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

## Build

```bash
# From the repo root
npm run build:linkedin

# Or from the agent folder
cd agents/agent-linkedin-cover
npm run build
```

## Typecheck

```bash
# From the repo root
npm run typecheck:linkedin
```

---

## Folder layout

```
agents/agent-linkedin-cover/
├── agent/
│   ├── agent.ts                   # orchestrator model config (MODEL_ORCHESTRATOR*)
│   ├── instructions.md            # always-on Orchestrator system prompt
│   ├── lib/
│   │   ├── model.ts               # per-role model resolution helper
│   │   ├── schemas.ts             # Cover Spec zod schema
│   │   ├── presets.ts             # size presets (linkedin-article, etc.)
│   │   ├── palettes.ts            # color palette definitions
│   │   └── prompt-builder.ts      # deterministic image prompt builder
│   ├── sandbox/
│   │   ├── sandbox.ts             # Docker backend config
│   │   └── workspace/             # seeded into /workspace at session start
│   │       ├── inputs/            #   article files to process
│   │       ├── references/        #   reference images
│   │       └── runs/              #   run outputs
│   ├── skills/
│   │   ├── art_direction.md       # visual style guidelines
│   │   ├── linkedin_layout.md     # safe zones, margins, composition
│   │   ├── brand_safety.md        # what to exclude by default
│   │   └── title_crafting.md      # title extraction + editing rules
│   ├── tools/
│   │   ├── create_run.ts          # make the timestamped run folder
│   │   ├── load_input.ts          # load article from file/URL/text
│   │   ├── build_prompt.ts        # validate spec + build image prompt
│   │   ├── generate_image.ts      # call image provider, save PNG
│   │   ├── validate_image.ts      # check exact dimensions with sharp
│   │   ├── write_report.ts        # write report.md + summary.json
│   │   └── write_run_file.ts      # write a text artifact into a run
│   └── channels/eve.ts            # the eve HTTP/TUI channel
├── .env.example                   # per-agent env template
├── package.json                   # per-agent manifest
├── tsconfig.json                  # per-agent TS config (extends base)
└── README.md                      # this file
```

---

## Importing shared code

This agent can import cross-agent utilities from the root `shared/` folder via
the `#shared/*` import map:

```typescript
import { getAuthToken } from "#shared/auth/index.js";
```

Agent-private helpers live in `agent/lib/` and are imported via `#lib/*`:

```typescript
import { resolveModel, MODEL_ORCHESTRATOR } from "#lib/model.js";
```

See [`shared/README.md`](../../../shared/README.md) for the shared-code contract.
