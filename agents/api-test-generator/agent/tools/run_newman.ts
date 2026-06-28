import { defineTool } from "eve/tools";
import { z } from "zod";

import { writeRunArtifact } from "shared/lib/run.js";

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "content" in value) {
    const c = (value as { content: unknown }).content;
    if (typeof c === "string") return c;
  }
  return String(value ?? "");
}

export default defineTool({
  description:
    "Execute Newman against the assembled Postman collection and write HTML + " +
    "JSON reports to the run folder. Returns pass/fail counts and duration.",
  inputSchema: z.object({
    run_dir: z.string(),
    collection_path: z.string().describe("Relative path, e.g. 'runs/<id>/<name>_collection.json'."),
    environment_path: z.string().optional().describe("Relative path to environment JSON."),
    data_path: z.string().optional().describe("Relative path to iteration data JSON."),
    timeout_ms: z.number().default(30000),
    bail: z.boolean().default(false),
  }),
  async execute({ run_dir, collection_path, environment_path, data_path, timeout_ms, bail }, ctx) {
    const runId = run_dir.replace(/^runs\//, "");
    const sandbox = await ctx.getSandbox();
    const startedAt = new Date().toISOString();

    const collSandbox = collection_path.startsWith("/workspace/")
      ? collection_path
      : `/workspace/${collection_path}`;
    const envSandbox = environment_path
      ? environment_path.startsWith("/workspace/")
        ? environment_path
        : `/workspace/${environment_path}`
      : null;
    const dataSandbox = data_path
      ? data_path.startsWith("/workspace/")
        ? data_path
        : `/workspace/${data_path}`
      : null;

    const htmlReport = `/workspace/${run_dir}/newman_report.html`;
    const jsonReport = `/workspace/${run_dir}/newman_report.json`;

    // ── Ensure Newman is installed ───────────────────────────────────────────
    await sandbox.run({
      command: "command -v newman >/dev/null 2>&1 || npm install -g newman newman-reporter-htmlextra >/dev/null 2>&1 || true",
    });

    // ── Build Newman command ─────────────────────────────────────────────────
    const parts = [
      "newman run",
      JSON.stringify(collSandbox),
      envSandbox ? `-e ${JSON.stringify(envSandbox)}` : "",
      dataSandbox ? `-d ${JSON.stringify(dataSandbox)}` : "",
      `--timeout-request ${timeout_ms}`,
      bail ? "--bail" : "",
      `-r htmlextra,json`,
      `--reporter-htmlextra-export ${JSON.stringify(htmlReport)}`,
      `--reporter-json-export ${JSON.stringify(jsonReport)}`,
      "--color off",
    ].filter(Boolean).join(" ");

    const result = await sandbox.run({ command: `${parts} 2>&1; echo "EXIT_CODE:$?"` });
    const stdout = textOf((result as { stdout?: unknown }).stdout ?? result);
    const endedAt = new Date().toISOString();

    // ── Parse exit code ──────────────────────────────────────────────────────
    const exitMatch = /EXIT_CODE:(\d+)/.exec(stdout);
    const exitCode = exitMatch ? parseInt(exitMatch[1]) : 1;

    // ── Parse counts from Newman output ─────────────────────────────────────
    const passMatch = /(\d+)\s+passing/i.exec(stdout);
    const failMatch = /(\d+)\s+failing/i.exec(stdout);
    const skipMatch = /(\d+)\s+skipped/i.exec(stdout);
    const durationMatch = /(\d+)ms/i.exec(stdout);

    const passed = passMatch ? parseInt(passMatch[1]) : 0;
    const failed = failMatch ? parseInt(failMatch[1]) : 0;
    const skipped = skipMatch ? parseInt(skipMatch[1]) : 0;
    const durationMs = durationMatch ? parseInt(durationMatch[1]) : 0;

    // ── Try to copy reports to host via writeRunArtifact ────────────────────
    let htmlReportRelPath = "";
    let jsonReportRelPath = "";
    try {
      const htmlContent = textOf(await sandbox.readTextFile({ path: htmlReport }));
      if (htmlContent) {
        await writeRunArtifact(ctx, runId, "newman_report.html", htmlContent);
        htmlReportRelPath = `${run_dir}/newman_report.html`;
      }
    } catch { /* HTML reporter may not be installed — skip */ }

    try {
      const jsonContent = textOf(await sandbox.readTextFile({ path: jsonReport }));
      if (jsonContent) {
        await writeRunArtifact(ctx, runId, "newman_report.json", jsonContent);
        jsonReportRelPath = `${run_dir}/newman_report.json`;
      }
    } catch { /* JSON report missing — skip */ }

    // ── Write a summary text if reports didn't generate ─────────────────────
    const summary = exitCode === 0
      ? `Newman passed — ${passed} assertions passed, ${failed} failed, ${skipped} skipped (${durationMs}ms)`
      : `Newman exited with code ${exitCode} — ${passed} passed, ${failed} failed`;

    return {
      exit_code: exitCode,
      passed,
      failed,
      skipped,
      duration_ms: durationMs,
      html_report_path: htmlReportRelPath,
      json_report_path: jsonReportRelPath,
      summary,
      started_at: startedAt,
      ended_at: endedAt,
    };
  },
});
