import { defineTool } from "eve/tools";
import { z } from "zod";

import { writeRunArtifact, readHostRunArtifact } from "shared/lib/run.js";

// ── Naming rule helpers ─────────────────────────────────────────────────────

function toTitleCase(str: string): string {
  return str
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function toRequestName(operationId: string, method: string, apiPath: string): string {
  // Try operationId first
  const fromOpId = operationId
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  if (fromOpId) return fromOpId;

  // Fallback from method + path
  const segment = apiPath.split("/").filter((s) => !s.startsWith("{")).pop() ?? "resource";
  const verbMap: Record<string, string> = {
    GET: apiPath.includes("{") ? "Get" : "List",
    POST: "Create",
    PUT: "Update",
    PATCH: "Update",
    DELETE: "Delete",
    OPTIONS: "Options",
    HEAD: "Head",
  };
  const verb = verbMap[method.toUpperCase()] ?? "Call";
  return `${verb} ${toTitleCase(segment)}`;
}

function toAssertionSuffix(requestName: string): string {
  return requestName
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function toFolderName(tag: string): string {
  const title = toTitleCase(tag);
  return title.length > 40 ? title.slice(0, 39) + "…" : title;
}

function toCollectionName(apiName: string): string {
  return `${apiName}_collection.json`;
}

function toDataFileName(apiName: string): string {
  return `${apiName.replace(/\s+/g, "_")}_data.json`;
}

interface RawEndpoint {
  operationId: string;
  method: string;
  path: string;
  tag: string;
  summary: string;
  description: string;
  deprecated: boolean;
  parameters: unknown[];
  requestBody: unknown;
  responses: Record<string, unknown>;
  security: string[];
}

interface NamedEndpoint extends RawEndpoint {
  requestName: string;
  folderName: string;
  assertionSuffix: string;
}

export default defineTool({
  description:
    "Apply organizational naming rules to the parsed endpoint model: derive " +
    "Postman folder names, request names, assertion key suffixes, and file names. " +
    "Writes named_endpoint_model.json to the run folder. Deterministic — no LLM.",
  inputSchema: z.object({
    run_dir: z.string().describe("Relative run directory."),
    endpoint_model_path: z
      .string()
      .describe("Path of endpoint_model.json, e.g. 'runs/<id>/endpoint_model.json'."),
    api_name: z.string().describe("Logical API name, e.g. 'PetStore'."),
    category: z
      .string()
      .optional()
      .describe("Optional override for the primary Postman folder category."),
  }),
  async execute({ run_dir, endpoint_model_path, api_name, category }, ctx) {
    const runId = run_dir.replace(/^runs\//, "");

    // ── Read endpoint model ──────────────────────────────────────────────────
    const raw = await readHostRunArtifact(runId, "endpoint_model.json");
    const model = JSON.parse(raw) as {
      info: Record<string, string>;
      endpoints: RawEndpoint[];
      warnings: string[];
    };

    const folderCache: Record<string, string> = {};
    const requestNameSeen = new Set<string>();

    const namedEndpoints: NamedEndpoint[] = model.endpoints.map((ep) => {
      const rawFolder = category ?? ep.tag;
      const folderName = (folderCache[rawFolder] ??= toFolderName(rawFolder));

      let requestName = toRequestName(ep.operationId, ep.method, ep.path);
      // Deduplicate: append method if collision
      if (requestNameSeen.has(requestName)) {
        requestName = `${requestName} (${ep.method})`;
      }
      requestNameSeen.add(requestName);

      return {
        ...ep,
        requestName,
        folderName,
        assertionSuffix: toAssertionSuffix(requestName),
      };
    });

    const collectionName = toCollectionName(api_name);
    const dataFileName = toDataFileName(api_name);
    const folderMap: Record<string, string> = {};
    for (const ep of namedEndpoints) {
      folderMap[ep.tag] = ep.folderName;
    }

    const namedModel = {
      info: model.info,
      api_name,
      collection_name: collectionName,
      data_file_name: dataFileName,
      folder_map: folderMap,
      endpoints: namedEndpoints,
    };

    const { hostPath } = await writeRunArtifact(
      ctx,
      runId,
      "named_endpoint_model.json",
      JSON.stringify(namedModel, null, 2) + "\n",
    );

    return {
      named_model_path: `${run_dir}/named_endpoint_model.json`,
      host_path: hostPath,
      collection_name: collectionName,
      data_file_name: dataFileName,
      folder_map: folderMap,
      endpoint_count: namedEndpoints.length,
    };
  },
});
