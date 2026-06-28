import { defineTool } from "eve/tools";
import { z } from "zod";

import { writeRunArtifact, readHostRunArtifact } from "shared/lib/run.js";

interface Violation {
  severity: "ERROR" | "WARN";
  rule: string;
  location: string;
  detail: string;
}

function toSuffix(requestName: string): string {
  return requestName
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function extractExec(event: unknown): string {
  if (!event || typeof event !== "object") return "";
  const e = event as { listen?: string; script?: { exec?: string[] | string } };
  if (e.listen !== "test") return "";
  const exec = e.script?.exec;
  if (Array.isArray(exec)) return exec.join("\n");
  return typeof exec === "string" ? exec : "";
}

export default defineTool({
  description:
    "Validate the assembled Postman collection for naming compliance, assertion " +
    "coverage, variable hygiene, and endpoint coverage. Writes validation_report.md " +
    "to the run folder. Deterministic — no LLM involved.",
  inputSchema: z.object({
    run_dir: z.string(),
    collection_path: z
      .string()
      .describe("Relative path to postman_collection.json."),
    named_model_path: z
      .string()
      .describe("Relative path to named_endpoint_model.json."),
  }),
  async execute({ run_dir, collection_path, named_model_path }, ctx) {
    const runId = run_dir.replace(/^runs\//, "");
    const violations: Violation[] = [];

    // ── Load artifacts ──────────────────────────────────────────────────────
    const collFile = collection_path.replace(/^runs\/[^/]+\//, "");
    const modelFile = named_model_path.replace(/^runs\/[^/]+\//, "");

    const collection = JSON.parse(
      await readHostRunArtifact(runId, collFile),
    ) as Record<string, unknown>;
    const namedModel = JSON.parse(
      await readHostRunArtifact(runId, modelFile),
    ) as {
      collection_name: string;
      endpoints: { requestName: string; operationId: string; assertionSuffix: string }[];
    };

    // ── Rule 1: Collection file name ends in _collection.json ────────────────
    if (!collFile.endsWith("_collection.json")) {
      violations.push({
        severity: "ERROR",
        rule: "Collection file name",
        location: collFile,
        detail: `Collection file must end in "_collection.json" — got "${collFile}"`,
      });
    }

    // ── Rule 2: info.name matches file name minus .json ──────────────────────
    const info = collection.info as Record<string, string> | undefined;
    const expectedInfoName = namedModel.collection_name.replace(".json", "");
    if (info?.name !== expectedInfoName) {
      violations.push({
        severity: "WARN",
        rule: "info.name",
        location: "collection.info.name",
        detail: `info.name "${info?.name ?? "(missing)"}" does not match expected "${expectedInfoName}"`,
      });
    }

    // ── Rule 3: Every request has 3 mandatory pm.test() blocks ──────────────
    const collectItems = (items: unknown[]): { name: string; events: unknown[] }[] => {
      const result: { name: string; events: unknown[] }[] = [];
      for (const item of items) {
        const i = item as Record<string, unknown>;
        if (Array.isArray(i.item)) {
          result.push(...collectItems(i.item as unknown[]));
        } else {
          result.push({ name: String(i.name ?? ""), events: Array.isArray(i.event) ? i.event as unknown[] : [] });
        }
      }
      return result;
    };

    const allRequests = collectItems(Array.isArray(collection.item) ? collection.item as unknown[] : []);

    for (const req of allRequests) {
      const script = req.events.map(extractExec).join("\n");
      if (!script.includes("pm.test(\"Status code\"")) {
        violations.push({
          severity: "ERROR",
          rule: "Missing assertion",
          location: req.name,
          detail: `pm.test("Status code", …) missing`,
        });
      }
      if (!script.includes("pm.test(\"Content-Type header validation\"")) {
        violations.push({
          severity: "ERROR",
          rule: "Missing assertion",
          location: req.name,
          detail: `pm.test("Content-Type header validation", …) missing`,
        });
      }
      if (!script.includes("pm.test(\"Response body validation\"")) {
        violations.push({
          severity: "ERROR",
          rule: "Missing assertion",
          location: req.name,
          detail: `pm.test("Response body validation", …) missing`,
        });
      }

      // Rule 4: No hard-coded hostnames in scripts
      if (/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(script)) {
        violations.push({
          severity: "ERROR",
          rule: "Hard-coded URL",
          location: req.name,
          detail: "Script contains a hard-coded URL — use {{base_url}} placeholder",
        });
      }

      // Rule 5: assertionSuffix keys present in script
      const ep = namedModel.endpoints.find((e) => e.requestName === req.name);
      if (ep) {
        const suffix = ep.assertionSuffix;
        if (!script.includes(`responseCodeFor${suffix}`)) {
          violations.push({
            severity: "ERROR",
            rule: "Missing assertion key",
            location: req.name,
            detail: `responseCodeFor${suffix} not referenced in script`,
          });
        }
      }
    }

    // ── Rule 6: Endpoint coverage ────────────────────────────────────────────
    const requestNames = new Set(allRequests.map((r) => r.name));
    for (const ep of namedModel.endpoints) {
      if (!requestNames.has(ep.requestName)) {
        violations.push({
          severity: "WARN",
          rule: "Endpoint coverage",
          location: ep.operationId,
          detail: `Endpoint "${ep.requestName}" (${ep.operationId}) has no request in collection`,
        });
      }
    }

    // ── Rule 7: Data file — classification fields present ────────────────────
    let dataRows: Record<string, unknown>[] = [];
    try {
      const apiName = namedModel.collection_name.replace("_collection.json", "");
      const rawData = await readHostRunArtifact(runId, `${apiName}_data.json`);
      dataRows = JSON.parse(rawData) as Record<string, unknown>[];
    } catch {
      violations.push({
        severity: "WARN",
        rule: "Data file",
        location: "data file",
        detail: "Could not load data file for classification field check",
      });
    }

    if (dataRows.length === 0 && namedModel.endpoints.length > 0) {
      violations.push({
        severity: "ERROR",
        rule: "Empty data file",
        location: "data file",
        detail: `Data file is empty (0 rows) but ${namedModel.endpoints.length} endpoint(s) were parsed — assemble_collection likely failed to read the pairwise matrix`,
      });
    }

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowId = String(row.TSName ?? `row[${i}]`);
      for (const field of ["product", "feature", "capability"] as const) {
        if (!row[field]) {
          violations.push({
            severity: "ERROR",
            rule: "Classification field missing",
            location: rowId,
            detail: `Mandatory field "${field}" is absent or empty in data row ${i}`,
          });
        }
      }
      // Warn if _validation_type is missing
      if (!row._validation_type) {
        violations.push({
          severity: "WARN",
          rule: "Missing _validation_type",
          location: rowId,
          detail: `"_validation_type" not set in data row ${i}`,
        });
      }
    }

    // ── Rule 8: No hard-coded credentials in collection JSON ─────────────────
    const collectionStr = JSON.stringify(collection);
    const credPatterns = [
      /password["']?\s*:\s*["'][^{][^"']{3,}["']/i,
      /api[_-]?key["']?\s*:\s*["'][A-Za-z0-9+/=]{10,}["']/i,
    ];
    for (const pat of credPatterns) {
      if (pat.test(collectionStr)) {
        violations.push({
          severity: "ERROR",
          rule: "Hard-coded credentials",
          location: "collection JSON",
          detail: "Potential hard-coded credential detected — use {{variable}} placeholders",
        });
        break;
      }
    }

    const errors = violations.filter((v) => v.severity === "ERROR");
    const warnings = violations.filter((v) => v.severity === "WARN");
    const passed = errors.length === 0;

    // ── Render validation_report.md ──────────────────────────────────────────
    const lines: string[] = [
      `# Collection Validation Report — ${runId}`,
      "",
      `**Result:** ${passed ? "✅ PASSED" : "❌ FAILED"}  ·  **Errors:** ${errors.length}  ·  **Warnings:** ${warnings.length}`,
      "",
    ];

    if (errors.length > 0) {
      lines.push("## Errors (must fix)");
      lines.push("| Rule | Location | Detail |");
      lines.push("|---|---|---|");
      for (const v of errors) {
        lines.push(`| ${v.rule} | ${v.location} | ${v.detail} |`);
      }
      lines.push("");
    }

    if (warnings.length > 0) {
      lines.push("## Warnings (should fix)");
      lines.push("| Rule | Location | Detail |");
      lines.push("|---|---|---|");
      for (const v of warnings) {
        lines.push(`| ${v.rule} | ${v.location} | ${v.detail} |`);
      }
      lines.push("");
    }

    if (violations.length === 0) {
      lines.push("_All checks passed._");
      lines.push("");
    }

    const markdown = lines.join("\n").trim() + "\n";
    const { hostPath } = await writeRunArtifact(ctx, runId, "validation_report.md", markdown);

    return {
      validation_path: `${run_dir}/validation_report.md`,
      host_path: hostPath,
      passed,
      violations,
      error_count: errors.length,
      warning_count: warnings.length,
    };
  },
});
