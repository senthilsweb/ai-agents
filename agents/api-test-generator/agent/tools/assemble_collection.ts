import { defineTool } from "eve/tools";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { writeRunArtifact, readHostRunArtifact } from "shared/lib/run.js";

// ── Types ────────────────────────────────────────────────────────────────────

const AuthProfileSchema = z.object({
  type: z.enum(["basic", "bearer", "apikey", "none"]),
  username_var: z.string().default("username"),
  password_var: z.string().default("password"),
  token_var: z.string().default("bearer_token"),
  key_header: z.string().default("X-API-Key"),
  key_var: z.string().default("api_key"),
});
type AuthProfile = z.infer<typeof AuthProfileSchema>;

// ── Classification helpers ────────────────────────────────────────────────────

function deriveCapability(method: string, apiPath: string): string {
  const verbMap: Record<string, string> = {
    GET: apiPath.match(/\{[^}]+\}$/) ? "get" : "list",
    POST: "create",
    PUT: "update",
    PATCH: "update",
    DELETE: "delete",
    OPTIONS: "options",
    HEAD: "head",
  };
  const verb = verbMap[method.toUpperCase()] ?? "call";
  const resource = apiPath
    .split("/")
    .filter((s) => s && !s.startsWith("{"))
    .pop() ?? "resource";
  return `${verb}-${resource.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function deriveFeature(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ── Postman collection builder ───────────────────────────────────────────────

function buildAuth(profile: AuthProfile): Record<string, unknown> | undefined {
  switch (profile.type) {
    case "basic":
      return {
        type: "basic",
        basic: [
          { key: "username", value: `{{${profile.username_var}}}`, type: "string" },
          { key: "password", value: `{{${profile.password_var}}}`, type: "string" },
        ],
      };
    case "bearer":
      return {
        type: "bearer",
        bearer: [{ key: "token", value: `{{${profile.token_var}}}`, type: "string" }],
      };
    case "apikey":
      return {
        type: "apikey",
        apikey: [
          { key: "key", value: profile.key_header, type: "string" },
          { key: "value", value: `{{${profile.key_var}}}`, type: "string" },
          { key: "in", value: "header", type: "string" },
        ],
      };
    default:
      return undefined;
  }
}

function buildUrl(
  rawPath: string,
  baseUrlVar: string,
  queryParams: { name: string }[],
): Record<string, unknown> {
  const pathParts = rawPath
    .replace(/\{([^}]+)\}/g, "{{$1}}")
    .split("/")
    .filter(Boolean);

  const raw =
    `${baseUrlVar}/${pathParts.join("/")}` +
    (queryParams.length > 0
      ? "?" + queryParams.map((p) => `${p.name}={{${p.name}}}`).join("&")
      : "");

  return {
    raw,
    host: [baseUrlVar],
    path: pathParts,
    query: queryParams.map((p) => ({ key: p.name, value: `{{${p.name}}}` })),
  };
}

function buildAssertionScript(
  assertionScript: string | undefined,
  assertionSuffix: string,
): string {
  if (assertionScript) return assertionScript;
  return [
    `var respCode            = pm.iterationData.get("responseCodeFor${assertionSuffix}");`,
    `var expectedText        = pm.iterationData.get("responseTextFor${assertionSuffix}");`,
    `var expectedContentType = pm.iterationData.get("contentTypeFor${assertionSuffix}");`,
    ``,
    `pm.test("Status code", function () {`,
    `  pm.response.to.have.status(parseInt(respCode));`,
    `});`,
    ``,
    `pm.test("Content-Type header validation", function () {`,
    `  var actualContentType = pm.response.headers.get("Content-Type");`,
    `  if (!expectedContentType) {`,
    `    pm.expect(actualContentType).to.be.oneOf([undefined, null]);`,
    `  } else {`,
    `    pm.expect(actualContentType, "Content-Type header missing").to.exist;`,
    `    var actualBase   = actualContentType.split(";")[0].trim().toLowerCase();`,
    `    var expectedBase = expectedContentType.trim().toLowerCase();`,
    `    pm.expect(actualBase).to.eql(expectedBase);`,
    `  }`,
    `});`,
    ``,
    `pm.test("Response body validation", function () {`,
    `  if (parseInt(respCode) >= 400 || (expectedContentType && expectedContentType.includes("text/html"))) {`,
    `    if (expectedText) pm.expect(pm.response.text()).to.include(expectedText);`,
    `    return;`,
    `  }`,
    `  if (expectedContentType && expectedContentType.includes("application/json")) {`,
    `    pm.response.to.be.json;`,
    `    if (expectedText) pm.expect(pm.response.text()).to.include(expectedText);`,
    `    return;`,
    `  }`,
    `  if (expectedContentType && expectedContentType.includes("xml")) {`,
    `    if (expectedText) pm.expect(pm.response.text()).to.include(expectedText);`,
    `    return;`,
    `  }`,
    `  if (expectedText) pm.expect(pm.response.text()).to.include(expectedText);`,
    `});`,
  ].join("\n");
}

function buildRequestBody(ep: Record<string, unknown>): unknown {
  const rb = ep.requestBody as Record<string, unknown> | null | undefined;
  if (!rb) return undefined;
  const ct = String(rb.content_type ?? "application/json");
  if (ct.includes("json")) {
    const schema = rb.schema as Record<string, unknown> | undefined;
    const props = (schema?.properties as Record<string, unknown> | undefined) ?? {};
    const bodyObj: Record<string, unknown> = {};
    for (const key of Object.keys(props)) {
      bodyObj[key] = `{{${key}}}`;
    }
    return {
      mode: "raw",
      raw: JSON.stringify(bodyObj, null, 2),
      options: { raw: { language: "json" } },
    };
  }
  return { mode: "raw", raw: `{{request_body}}` };
}

// ── YAML serializer (minimal — avoids importing js-yaml into the tool) ────────
function toYaml(obj: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string") {
    return obj.includes(":") || obj.includes("#") || obj.includes('"')
      ? `"${obj.replace(/"/g, '\\"')}"`
      : obj;
  }
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj
      .map((item) => `\n${pad}- ${toYaml(item, indent + 1).trimStart()}`)
      .join("");
  }
  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return entries
      .map(([k, v]) => {
        const val = toYaml(v, indent + 1);
        const inline = typeof v !== "object" || v === null;
        return inline
          ? `\n${pad}${k}: ${val}`
          : `\n${pad}${k}:${val}`;
      })
      .join("");
  }
  return String(obj);
}

function buildYamlDoc(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([category, items]) => {
      const itemsYaml = toYaml(items, 1).trimStart();
      return `${category}:\n  ${itemsYaml}`;
    })
    .join("\n\n") + "\n";
}

// ── Main tool ────────────────────────────────────────────────────────────────

export default defineTool({
  description:
    "Assemble a Postman v2.1.0 collection, environment JSON, Newman iteration " +
    "data file (with classification fields), api_config.json, collection_data.yml " +
    "manifest, and standalone test_scripts/ files. Test scripts and data are kept " +
    "strictly separate so data can be extended without touching the collection. " +
    "Deterministic — no LLM involved.",
  inputSchema: z.object({
    run_dir: z.string(),
    api_name: z.string(),
    product: z.string().default("").describe("Product identifier, e.g. 'PDC'. Added to every iteration row."),
    domain: z.string().optional().describe("Optional business domain, e.g. 'data-governance'."),
    auth_profile: AuthProfileSchema.default({ type: "none" }),
    base_url_var: z.string().default("{{base_url}}"),
    environment_name: z.string().optional(),
    environment_vars: z.record(z.string(), z.string()).default({}),
  }),
  async execute({ run_dir, api_name, product, domain, auth_profile, base_url_var, environment_name, environment_vars }, ctx) {
    const runId = run_dir.replace(/^runs\//, "");

    // ── Load artifacts ──────────────────────────────────────────────────────
    const namedModel = JSON.parse(
      await readHostRunArtifact(runId, "named_endpoint_model.json"),
    ) as {
      collection_name: string;
      data_file_name: string;
      folder_map: Record<string, string>;
      endpoints: Record<string, unknown>[];
    };

    const matrix = JSON.parse(
      await readHostRunArtifact(runId, "pairwise_matrix.json"),
    ) as {
      endpoints: Record<string, { rows: Record<string, string>[] }>;
    };

    let assertionScripts: Record<string, string> = {};
    let tsnameMap: Record<string, string> = {};
    try {
      const raw = await readHostRunArtifact(runId, "assertion_scripts.json");
      const parsed = JSON.parse(raw) as {
        assertion_scripts?: Record<string, string>;
        tsname_suggestions?: Record<string, string>;
      };
      assertionScripts = parsed.assertion_scripts ?? {};
      tsnameMap = parsed.tsname_suggestions ?? {};
    } catch {
      // Assertion scripts optional; fallback scripts generated below
    }

    // ── Group endpoints by folder ────────────────────────────────────────────
    const folders: Record<string, unknown[]> = {};
    for (const ep of namedModel.endpoints) {
      const folderName = String(ep.folderName ?? ep.tag ?? "Default");
      if (!folders[folderName]) folders[folderName] = [];
      folders[folderName].push(ep);
    }

    // ── Build collection items + extract scripts ──────────────────────────────
    const scriptsByRequest: Record<string, string> = {};

    const items = Object.entries(folders).map(([folderName, eps]) => ({
      name: folderName,
      item: eps.map((ep) => {
        const endpoint = ep as Record<string, unknown>;
        const suffix = String(endpoint.assertionSuffix ?? "");
        const requestName = String(endpoint.requestName ?? "");
        const script = buildAssertionScript(
          assertionScripts[requestName],
          suffix,
        );
        scriptsByRequest[requestName] = script;

        const queryParams = (
          endpoint.parameters as { name: string; in: string }[] ?? []
        ).filter((p) => p.in === "query");

        return {
          name: requestName,
          request: {
            method: endpoint.method,
            header: [],
            url: buildUrl(String(endpoint.path ?? ""), base_url_var, queryParams),
            body: buildRequestBody(endpoint),
          },
          event: [
            {
              listen: "test",
              script: {
                type: "text/javascript",
                exec: script.split("\n"),
              },
            },
          ],
        };
      }),
    }));

    // ── Build Postman collection ──────────────────────────────────────────────
    const collectionAuth = buildAuth(auth_profile);
    const collection: Record<string, unknown> = {
      info: {
        _postman_id: randomUUID(),
        name: namedModel.collection_name.replace(".json", ""),
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      ...(collectionAuth ? { auth: collectionAuth } : {}),
      item: items,
      variable: [],
    };

    // ── Build iteration data (with classification) ────────────────────────────
    const iterations: Record<string, unknown>[] = [];
    const testCasesByCategory: Record<string, { testCaseName: string; requests: string[] }[]> = {};

    for (const ep of namedModel.endpoints) {
      const endpoint = ep as Record<string, unknown>;
      const opId = String(endpoint.operationId ?? "");
      const epMatrix = matrix.endpoints[opId];
      if (!epMatrix) continue;

      const feature = deriveFeature(String(endpoint.tag ?? opId));
      const capability = deriveCapability(String(endpoint.method ?? "GET"), String(endpoint.path ?? ""));
      const requestName = String(endpoint.requestName ?? opId);
      const suffix = String(endpoint.assertionSuffix ?? "");

      const responses = endpoint.responses as Record<string, { content_type: string | null }> ?? {};
      const statusEntry = Object.entries(responses).find(([s]) => s.startsWith("2"));
      const defaultStatus = statusEntry ? parseInt(statusEntry[0]) : 200;
      const defaultCt = statusEntry ? (statusEntry[1].content_type ?? "application/json") : "application/json";

      // Track for collection_data.yml
      const folderName = String(endpoint.folderName ?? feature);
      if (!testCasesByCategory[folderName]) testCasesByCategory[folderName] = [];

      epMatrix.rows.forEach((row, idx) => {
        const tsnameKey = `${opId}.${idx}`;
        const isRbacNeg = ["anonymous", "unauthorized", "none", ""].includes(
          (row.role ?? row.auth_role ?? "").toLowerCase(),
        );
        const isOverBoundary = Object.values(row).some((v) => String(v).includes("+1"));

        const expectedStatus = isRbacNeg ? 401 : isOverBoundary ? 400 : defaultStatus;
        const expectedCt = isRbacNeg ? "text/html" : defaultCt;
        const validationType = isRbacNeg
          ? "RBAC -ve"
          : idx === 0
            ? "Smoke"
            : isOverBoundary
              ? "Boundary"
              : "Functional";

        const defaultTSName = [
          requestName,
          Object.entries(row)
            .filter(([k]) => !["username", "password", "bearer_token", "api_key"].includes(k))
            .slice(0, 3)
            .map(([k, v]) => `${k}=${v}`)
            .join(" "),
          `· expect ${expectedStatus}`,
        ]
          .filter(Boolean)
          .join(" · ");

        const tsName = tsnameMap[tsnameKey] ?? defaultTSName;

        // Mandatory classification fields first, then TSName and operational keys
        const iterRow: Record<string, unknown> = {
          TSName: tsName,
          product: product || api_name.replace(/[^A-Za-z0-9]+/g, "").toUpperCase().slice(0, 8),
          feature,
          capability,
          ...(domain ? { domain } : {}),
          _validation_type: validationType,
          _comments: `Pairwise row ${idx} for ${opId}`,
          username: auth_profile.type === "basic" ? `{{${auth_profile.username_var}}}` : "",
          password: auth_profile.type === "basic" ? `{{${auth_profile.password_var}}}` : "",
          ...(auth_profile.type === "bearer" ? { [auth_profile.token_var]: `{{${auth_profile.token_var}}}` } : {}),
          ...(auth_profile.type === "apikey" ? { [auth_profile.key_var]: `{{${auth_profile.key_var}}}` } : {}),
          // Spread pairwise factor values (params, body fields)
          ...row,
          // Assertion keys — read by pm.iterationData.get() in the test script
          [`responseCodeFor${suffix}`]: expectedStatus,
          [`responseTextFor${suffix}`]: isRbacNeg ? "Unauthorized" : "",
          [`contentTypeFor${suffix}`]: expectedCt,
        };

        iterations.push(iterRow);

        testCasesByCategory[folderName].push({
          testCaseName: tsName,
          requests: [requestName],
        });
      });
    }

    // ── Build environment ─────────────────────────────────────────────────────
    const envName = environment_name ?? `${api_name} Local`;
    const envValues = [
      { key: "base_url", value: "http://localhost:8080", enabled: true },
      ...(auth_profile.type === "basic"
        ? [
            { key: auth_profile.username_var, value: "admin", enabled: true },
            { key: auth_profile.password_var, value: "changeme", enabled: true },
          ]
        : []),
      ...(auth_profile.type === "bearer"
        ? [{ key: auth_profile.token_var, value: "", enabled: true }]
        : []),
      ...(auth_profile.type === "apikey"
        ? [{ key: auth_profile.key_var, value: "", enabled: true }]
        : []),
      ...Object.entries(environment_vars).map(([k, v]) => ({ key: k, value: v, enabled: true })),
    ];
    const environment = {
      id: randomUUID(),
      name: envName,
      values: envValues,
      _postman_variable_scope: "environment",
    };

    // ── Build api_config.json ─────────────────────────────────────────────────
    const apiConfig = {
      api_name,
      collection_file: namedModel.collection_name,
      data_file: namedModel.data_file_name,
      environment_file: `${api_name}_environment.json`,
      base_url_var,
      auth: {
        type: auth_profile.type,
        ...(auth_profile.type === "basic"
          ? { username_var: auth_profile.username_var, password_var: auth_profile.password_var }
          : {}),
        ...(auth_profile.type === "bearer" ? { token_var: auth_profile.token_var } : {}),
        ...(auth_profile.type === "apikey"
          ? { key_header: auth_profile.key_header, key_var: auth_profile.key_var }
          : {}),
      },
      environment_name: envName,
      defaults: {
        timeout_ms: 30000,
        insecure: true,
        bail_on_failure: false,
      },
      endpoints: namedModel.endpoints.map((ep) => {
        const endpoint = ep as Record<string, unknown>;
        const feature = deriveFeature(String(endpoint.tag ?? "default"));
        const capability = deriveCapability(
          String(endpoint.method ?? "GET"),
          String(endpoint.path ?? ""),
        );
        return {
          operationId: endpoint.operationId,
          method: endpoint.method,
          path: endpoint.path,
          request_name: endpoint.requestName,
          product: product || api_name.toUpperCase().slice(0, 8),
          feature,
          capability,
          ...(domain ? { domain } : {}),
        };
      }),
    };

    // ── Build collection_data.yml ─────────────────────────────────────────────
    const collectionDataObj: Record<string, unknown[]> = {};
    for (const [category, testCases] of Object.entries(testCasesByCategory)) {
      if (!collectionDataObj[category]) {
        collectionDataObj[category] = [
          {
            collectionName: namedModel.collection_name,
            description: `API tests for ${category}`,
            testDataName: namedModel.data_file_name,
            product: product || api_name.toUpperCase().slice(0, 8),
            feature: deriveFeature(category),
            testCases: testCases.slice(0, 50), // cap to avoid huge YAML
          },
        ];
      }
    }

    // ── Write all artifacts ──────────────────────────────────────────────────
    const collFile = namedModel.collection_name;
    const dataFile = namedModel.data_file_name;
    const envFile = `${api_name}_environment.json`;

    const writes: Promise<unknown>[] = [
      writeRunArtifact(ctx, runId, collFile, JSON.stringify(collection, null, 2) + "\n"),
      writeRunArtifact(ctx, runId, dataFile, JSON.stringify(iterations, null, 2) + "\n"),
      writeRunArtifact(ctx, runId, envFile, JSON.stringify(environment, null, 2) + "\n"),
      writeRunArtifact(ctx, runId, "api_config.json", JSON.stringify(apiConfig, null, 2) + "\n"),
    ];

    // collection_data.yml — simple block-style YAML
    const yamlLines: string[] = [];
    for (const [cat, entries] of Object.entries(collectionDataObj)) {
      yamlLines.push(`${cat}:`);
      for (const entry of entries as Record<string, unknown>[]) {
        yamlLines.push(`  - collectionName: ${entry.collectionName}`);
        yamlLines.push(`    description: ${entry.description}`);
        yamlLines.push(`    testDataName: ${entry.testDataName}`);
        yamlLines.push(`    product: ${entry.product}`);
        yamlLines.push(`    feature: ${entry.feature}`);
        const tcs = entry.testCases as { testCaseName: string; requests: string[] }[];
        if (tcs.length > 0) {
          yamlLines.push(`    testCases:`);
          for (const tc of tcs) {
            yamlLines.push(`      - testCaseName: "${tc.testCaseName}"`);
            yamlLines.push(`        requests:`);
            for (const r of tc.requests) yamlLines.push(`          - ${r}`);
          }
        }
      }
      yamlLines.push("");
    }
    writes.push(writeRunArtifact(ctx, runId, "collection_data.yml", yamlLines.join("\n")));

    // test_scripts/ — one .js file per request (read-only reference)
    for (const [name, script] of Object.entries(scriptsByRequest)) {
      const safeName = name.replace(/[/\\:*?"<>|]/g, "_");
      writes.push(
        writeRunArtifact(
          ctx,
          runId,
          `test_scripts/${safeName}.js`,
          `// Test script for: ${name}\n// This file is a read-only reference.\n// Edit the collection JSON or re-generate to change these scripts.\n\n${script}\n`,
        ),
      );
    }

    const results = await Promise.all(writes);
    const collResult = results[0] as { hostPath: string };
    const dataResult = results[1] as { hostPath: string };

    return {
      collection_path: `${run_dir}/${collFile}`,
      environment_path: `${run_dir}/${envFile}`,
      data_files: [`${run_dir}/${dataFile}`],
      api_config_path: `${run_dir}/api_config.json`,
      collection_data_path: `${run_dir}/collection_data.yml`,
      test_scripts_dir: `${run_dir}/test_scripts/`,
      host_collection_path: collResult.hostPath,
      host_data_path: dataResult.hostPath,
      request_count: namedModel.endpoints.length,
      iteration_count: iterations.length,
    };
  },
});
