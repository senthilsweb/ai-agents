import { defineTool } from "eve/tools";
import { z } from "zod";

import { writeRunArtifact } from "shared/lib/run.js";

// Endpoint model shape — what we normalize every OpenAPI operation to.
interface Parameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required: boolean;
  schema: Record<string, unknown>;
  description?: string;
}

interface ResponseShape {
  description: string;
  content_type: string | null;
  schema?: Record<string, unknown>;
  example?: unknown;
}

interface EndpointModel {
  operationId: string;
  method: string;
  path: string;
  tag: string;
  summary: string;
  description: string;
  deprecated: boolean;
  parameters: Parameter[];
  requestBody: {
    required: boolean;
    content_type: string;
    schema?: Record<string, unknown>;
    example?: unknown;
  } | null;
  responses: Record<string, ResponseShape>;
  security: string[];
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "content" in value) {
    const c = (value as { content: unknown }).content;
    if (typeof c === "string") return c;
  }
  return String(value ?? "");
}

function slugify(str: string): string {
  return str.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
}

function resolveRef(
  ref: string,
  root: Record<string, unknown>,
): Record<string, unknown> {
  if (!ref.startsWith("#/")) return {};
  const parts = ref.slice(2).split("/");
  let cur: unknown = root;
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return {};
    cur = (cur as Record<string, unknown>)[part];
  }
  return (cur as Record<string, unknown>) ?? {};
}

function resolveSchema(
  schema: unknown,
  root: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  if (depth > 5 || !schema || typeof schema !== "object") return {};
  const s = schema as Record<string, unknown>;
  if ("$ref" in s && typeof s["$ref"] === "string") {
    return resolveSchema(resolveRef(s["$ref"], root), root, depth + 1);
  }
  return s;
}

function firstContentType(content: unknown): string | null {
  if (!content || typeof content !== "object") return null;
  const keys = Object.keys(content as object);
  return keys[0] ?? null;
}

function firstExample(content: unknown, ct: string | null): unknown {
  if (!content || !ct || typeof content !== "object") return undefined;
  const mediaType = (content as Record<string, unknown>)[ct];
  if (!mediaType || typeof mediaType !== "object") return undefined;
  const mt = mediaType as Record<string, unknown>;
  if (mt.example !== undefined) return mt.example;
  if (mt.examples && typeof mt.examples === "object") {
    const first = Object.values(mt.examples as Record<string, unknown>)[0];
    if (first && typeof first === "object" && "value" in (first as object)) {
      return (first as { value: unknown }).value;
    }
  }
  return undefined;
}

function extractParameters(
  rawParams: unknown[],
  root: Record<string, unknown>,
): Parameter[] {
  return rawParams.map((p, idx) => {
    const resolved = resolveSchema(p, root) as Record<string, unknown>;
    return {
      name: String(resolved.name ?? `param_${idx}`),
      in: (resolved.in as Parameter["in"]) ?? "query",
      required: Boolean(resolved.required ?? false),
      schema: resolveSchema(resolved.schema, root),
      description: typeof resolved.description === "string" ? resolved.description : undefined,
    };
  });
}

export default defineTool({
  description:
    "Parse an OpenAPI 3.x specification, resolve all $ref references, and build " +
    "a normalized endpoint model JSON. Writes endpoint_model.json to the run " +
    "folder. Deterministic — no LLM involved.",
  inputSchema: z.object({
    run_dir: z.string().describe("Relative run directory, e.g. 'runs/2026-06-27T10-00-00Z'."),
    spec_path: z
      .string()
      .describe(
        "Path to the OpenAPI spec in the sandbox (/workspace/inputs/<file>) or an HTTP(S) URL.",
      ),
  }),
  async execute({ run_dir, spec_path }, ctx) {
    const sandbox = await ctx.getSandbox();
    const warnings: string[] = [];

    // ── Load the spec ────────────────────────────────────────────────────────
    let specText: string;
    const sandboxPath = spec_path.startsWith("http")
      ? null
      : spec_path.startsWith("/workspace/")
        ? spec_path
        : `/workspace/inputs/${spec_path}`;

    if (sandboxPath) {
      specText = textOf(await sandbox.readTextFile({ path: sandboxPath }));
    } else {
      const result = await sandbox.run({
        command: `curl -sf ${JSON.stringify(spec_path)} 2>&1`,
      });
      specText = textOf((result as { stdout?: unknown }).stdout ?? result ?? "");
    }

    if (!specText || specText.trim().length === 0) {
      throw new Error(`Could not load OpenAPI spec from: ${spec_path}`);
    }

    // ── Parse YAML or JSON ──────────────────────────────────────────────────
    let root: Record<string, unknown>;
    if (specText.trimStart().startsWith("{")) {
      root = JSON.parse(specText) as Record<string, unknown>;
    } else {
      // Use sandbox Node to parse YAML via js-yaml (available in Node 24 via npm)
      const parseResult = await sandbox.run({
        command: `node -e "
const fs = require('fs');
const yaml = require('js-yaml');
try {
  const doc = yaml.load(fs.readFileSync('/dev/stdin', 'utf8'));
  console.log(JSON.stringify(doc));
} catch(e) { console.error(e.message); process.exit(1); }
" <<'SPEC_EOF'\n${specText.replace(/'/g, "'\"'\"'")}\nSPEC_EOF`,
      });
      const stdout = textOf((parseResult as { stdout?: unknown }).stdout ?? parseResult);
      if (!stdout.trim().startsWith("{")) {
        // Fallback: write to sandbox file and use node --input-type
        await sandbox.writeTextFile({ path: "/tmp/openapi_spec_input.yaml", content: specText });
        const r2 = await sandbox.run({
          command: `node -e "const yaml=require('js-yaml'),fs=require('fs');console.log(JSON.stringify(yaml.load(fs.readFileSync('/tmp/openapi_spec_input.yaml','utf8'))))"`,
        });
        root = JSON.parse(textOf((r2 as { stdout?: unknown }).stdout ?? r2)) as Record<string, unknown>;
      } else {
        root = JSON.parse(stdout) as Record<string, unknown>;
      }
    }

    // ── Extract info ─────────────────────────────────────────────────────────
    const info = (root.info as Record<string, unknown>) ?? {};
    const apiInfo = {
      title: String(info.title ?? "Untitled API"),
      version: String(info.version ?? "0.0.0"),
      description: String(info.description ?? ""),
    };

    // ── Enumerate operations ──────────────────────────────────────────────────
    const paths = (root.paths as Record<string, unknown>) ?? {};
    const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head"];
    const endpoints: EndpointModel[] = [];
    const opIdSeen = new Set<string>();
    let autoIdx = 0;

    for (const [apiPath, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== "object") continue;
      const pi = pathItem as Record<string, unknown>;
      const pathParams = Array.isArray(pi.parameters) ? (pi.parameters as unknown[]) : [];

      for (const method of HTTP_METHODS) {
        if (!(method in pi)) continue;
        const op = pi[method] as Record<string, unknown>;
        if (!op || typeof op !== "object") continue;

        // operationId
        let operationId = typeof op.operationId === "string" ? op.operationId.trim() : "";
        if (!operationId) {
          operationId = slugify(`${method}_${apiPath}_${++autoIdx}`);
          warnings.push(`Missing operationId for ${method.toUpperCase()} ${apiPath} — assigned "${operationId}"`);
        }
        if (opIdSeen.has(operationId)) {
          const deduped = `${operationId}_${++autoIdx}`;
          warnings.push(`Duplicate operationId "${operationId}" — renamed to "${deduped}"`);
          operationId = deduped;
        }
        opIdSeen.add(operationId);

        const tags = Array.isArray(op.tags) ? (op.tags as string[]) : [];
        const tag = tags[0] ?? apiPath.split("/").filter(Boolean)[0] ?? "default";

        // Parameters (merge path-level + operation-level)
        const opParams = Array.isArray(op.parameters) ? (op.parameters as unknown[]) : [];
        const allRaw = [...pathParams, ...opParams];
        const parameters = extractParameters(allRaw, root);

        // Request body
        let requestBody: EndpointModel["requestBody"] = null;
        if (op.requestBody && typeof op.requestBody === "object") {
          const rb = resolveSchema(op.requestBody, root) as Record<string, unknown>;
          const content = rb.content as Record<string, unknown> | undefined;
          const ct = firstContentType(content);
          const mtSchema =
            ct && content ? resolveSchema((content[ct] as Record<string, unknown>)?.schema, root) : undefined;
          requestBody = {
            required: Boolean(rb.required ?? false),
            content_type: ct ?? "application/json",
            schema: mtSchema,
            example: firstExample(content, ct),
          };
        }

        // Responses
        const rawResponses = (op.responses as Record<string, unknown>) ?? {};
        const responses: Record<string, ResponseShape> = {};
        for (const [status, rawResp] of Object.entries(rawResponses)) {
          const resp = resolveSchema(rawResp, root) as Record<string, unknown>;
          const content = resp.content as Record<string, unknown> | undefined;
          const ct = firstContentType(content);
          responses[status] = {
            description: String(resp.description ?? ""),
            content_type: ct,
            schema: ct && content ? resolveSchema((content[ct] as Record<string, unknown>)?.schema, root) : undefined,
            example: firstExample(content, ct),
          };
        }

        // Security
        const opSec = Array.isArray(op.security) ? op.security : [];
        const rootSec = Array.isArray(root.security) ? root.security : [];
        const secArr = opSec.length > 0 ? opSec : rootSec;
        const security = (secArr as Record<string, unknown>[])
          .flatMap((s) => Object.keys(s))
          .filter((v, i, a) => a.indexOf(v) === i);

        const deprecated = Boolean(op.deprecated ?? false);
        if (deprecated) {
          warnings.push(`Endpoint ${operationId} (${method.toUpperCase()} ${apiPath}) is deprecated.`);
        }

        endpoints.push({
          operationId,
          method: method.toUpperCase(),
          path: apiPath,
          tag,
          summary: String(op.summary ?? ""),
          description: String(op.description ?? ""),
          deprecated,
          parameters,
          requestBody,
          responses,
          security,
        });
      }
    }

    // ── Write endpoint model ─────────────────────────────────────────────────
    const runId = run_dir.replace(/^runs\//, "");
    const model = { info: apiInfo, endpoints, warnings };
    const { hostPath } = await writeRunArtifact(
      ctx,
      runId,
      "endpoint_model.json",
      JSON.stringify(model, null, 2) + "\n",
    );

    // ── Schema count (components/schemas) ───────────────────────────────────
    const schemas = root.components
      ? Object.keys(((root.components as Record<string, unknown>).schemas as object) ?? {}).length
      : 0;

    return {
      endpoint_model_path: `${run_dir}/endpoint_model.json`,
      host_path: hostPath,
      info: apiInfo,
      endpoint_count: endpoints.length,
      schema_count: schemas,
      warnings,
    };
  },
});
