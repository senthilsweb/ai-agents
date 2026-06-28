import { defineTool } from "eve/tools";
import { z } from "zod";
import { writeRunArtifact } from "shared/lib/run.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "content" in value) {
    const c = (value as { content: unknown }).content;
    if (typeof c === "string") return c;
  }
  return String(value ?? "");
}

/** Build the Hive-style partition suffix: year=YYYY/month=MM/day=DD/... */
function buildPartitionSuffix(
  year: string,
  month: string,
  day: string,
  apiName: string,
  runId: string,
  mode: "date/api_name/run_id" | "api_name/date/run_id" | "flat",
): string {
  const safeApi = apiName.replace(/[^A-Za-z0-9_-]/g, "_");
  const safeRun = runId.replace(/[^A-Za-z0-9_T-]/g, "_");
  switch (mode) {
    case "api_name/date/run_id":
      return `api_name=${safeApi}/year=${year}/month=${month}/day=${day}/run_id=${safeRun}`;
    case "flat":
      return safeRun;
    default: // date/api_name/run_id
      return `year=${year}/month=${month}/day=${day}/api_name=${safeApi}/run_id=${safeRun}`;
  }
}

/** Strip trailing slash, ensure no double slashes. */
function joinUri(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, "") : p.replace(/^\/+|\/+$/g, "")))
    .filter(Boolean)
    .join("/");
}

/** Shell-escape a value for use inside double quotes. */
function shellEsc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
}

// ── Tool ─────────────────────────────────────────────────────────────────────

export default defineTool({
  description:
    "Publish structured run artifacts (test_results.jsonl, coverage.json, matrix.jsonl) " +
    "to a remote S3-compatible object store. Path is Hive-partitioned so DuckDB can " +
    "query across runs with hive_partitioning=true. Deterministic — no LLM involved. " +
    "Optional: set PUBLISH_S3_URI in .env to auto-trigger from instructions.",
  inputSchema: z.object({
    run_dir: z.string(),
    run_id: z.string(),
    s3_uri: z
      .string()
      .describe(
        "Base S3 URI: s3://<bucket> or s3://<bucket>/optional/prefix. " +
          "Override at runtime; falls back to PUBLISH_S3_URI env var.",
      )
      .optional(),
    partition_by: z
      .enum(["date/api_name/run_id", "api_name/date/run_id", "flat"])
      .default("date/api_name/run_id")
      .describe(
        "Hive partition order. 'date/api_name/run_id' is the default — DuckDB can " +
          "prune by year/month before scanning api names. " +
          "'flat' puts everything directly under the base URI (no partition columns).",
      ),
    include_raw: z
      .boolean()
      .default(false)
      .describe(
        "Also publish raw artifacts: *_collection.json, *_data.json, " +
          "pairwise_matrix.csv, api_config.json, collection_data.yml.",
      ),
    endpoint_url: z
      .string()
      .optional()
      .describe(
        "Override S3 endpoint URL — for MinIO or other S3-compatible stores. " +
          "Falls back to PUBLISH_S3_ENDPOINT_URL env var.",
      ),
    aws_region: z
      .string()
      .optional()
      .describe("AWS region. Falls back to PUBLISH_S3_BUCKET_REGION or AWS_DEFAULT_REGION env var."),
  }),
  async execute({ run_dir, run_id, s3_uri, partition_by, include_raw, endpoint_url, aws_region }, ctx) {
    const sandbox = await ctx.getSandbox();

    // ── Resolve configuration from env if not provided ───────────────────────
    const resolvedUri = s3_uri ?? process.env.PUBLISH_S3_URI ?? "";
    if (!resolvedUri) {
      return {
        skipped: true,
        reason: "No S3 URI provided. Set PUBLISH_S3_URI in .env or pass s3_uri to the tool.",
        published_uri: null,
        files_uploaded: [],
      };
    }

    const resolvedEndpoint = endpoint_url ?? process.env.PUBLISH_S3_ENDPOINT_URL ?? "";
    const resolvedRegion =
      aws_region ??
      process.env.PUBLISH_S3_BUCKET_REGION ??
      process.env.AWS_DEFAULT_REGION ??
      "us-east-1";

    // ── Read run metadata to get date parts and api_name ────────────────────
    let year = "unknown", month = "unknown", day = "unknown";
    let apiName = "unknown";
    try {
      const metaRaw = textOf(
        await sandbox.readTextFile({ path: `/workspace/${run_dir}/run-meta.json` }),
      );
      const meta = JSON.parse(metaRaw) as Record<string, unknown>;
      const options = (meta.options as Record<string, unknown> | undefined) ?? {};
      apiName = String(options.api_name ?? meta.request ?? "API");
      const startedAt = String(meta.started_at ?? run_id);
      const m = /(\d{4})-(\d{2})-(\d{2})/.exec(startedAt);
      if (m) { year = m[1]; month = m[2]; day = m[3]; }
    } catch {
      // Fallback: parse from run_id format "2026-06-28T..."
      const m = /(\d{4})-(\d{2})-(\d{2})/.exec(run_id);
      if (m) { year = m[1]; month = m[2]; day = m[3]; }
    }

    // ── Build partition suffix and full destination URI ───────────────────────
    const partitionSuffix = buildPartitionSuffix(year, month, day, apiName, run_id, partition_by);
    const destUri = joinUri(resolvedUri, partitionSuffix);

    // ── Install AWS CLI in sandbox if not present ────────────────────────────
    const installResult = await sandbox.run({
      command: [
        "if ! command -v aws >/dev/null 2>&1; then",
        "  pip3 install awscli --quiet --break-system-packages 2>/dev/null ||",
        "  pip3 install awscli --quiet 2>/dev/null ||",
        "  apt-get install -y awscli -qq 2>/dev/null ||",
        "  echo 'AWS_CLI_NOT_FOUND';",
        "fi;",
        "aws --version 2>&1 || echo 'AWS_CLI_NOT_FOUND'",
      ].join(" "),
    });
    const installOut = textOf((installResult as { stdout?: unknown }).stdout ?? installResult);
    if (installOut.includes("AWS_CLI_NOT_FOUND")) {
      return {
        skipped: true,
        reason:
          "AWS CLI could not be installed in the sandbox. " +
          "Pre-install it in the sandbox Docker image or use a sandbox with awscli.",
        published_uri: null,
        files_uploaded: [],
      };
    }

    // ── Build env prefix for the shell command ───────────────────────────────
    // Credentials come from the host .env → available as process.env on host,
    // must be passed explicitly into the sandbox shell.
    const envPairs: string[] = [];
    if (process.env.AWS_ACCESS_KEY_ID)
      envPairs.push(`AWS_ACCESS_KEY_ID="${shellEsc(process.env.AWS_ACCESS_KEY_ID)}"`);
    if (process.env.AWS_SECRET_ACCESS_KEY)
      envPairs.push(`AWS_SECRET_ACCESS_KEY="${shellEsc(process.env.AWS_SECRET_ACCESS_KEY)}"`);
    if (process.env.AWS_SESSION_TOKEN)
      envPairs.push(`AWS_SESSION_TOKEN="${shellEsc(process.env.AWS_SESSION_TOKEN)}"`);
    envPairs.push(`AWS_DEFAULT_REGION="${shellEsc(resolvedRegion)}"`);
    // MinIO endpoint
    if (resolvedEndpoint)
      envPairs.push(`AWS_ENDPOINT_URL="${shellEsc(resolvedEndpoint)}"`);

    const envPrefix = envPairs.join(" ");

    // ── Publish structured/ directory ────────────────────────────────────────
    const structuredSrc = `/workspace/${run_dir}/structured/`;
    const structuredDest = joinUri(destUri, "structured");

    const syncCmd = [
      envPrefix,
      "aws s3 sync",
      `"${shellEsc(structuredSrc)}"`,
      `"${shellEsc(structuredDest)}/"`,
      resolvedEndpoint ? `--endpoint-url "${shellEsc(resolvedEndpoint)}"` : "",
      "--no-progress",
      "--content-type application/json",
      "2>&1; echo \"SYNC_EXIT:$?\"",
    ].filter(Boolean).join(" ");

    const syncResult = await sandbox.run({ command: syncCmd });
    const syncOut = textOf((syncResult as { stdout?: unknown }).stdout ?? syncResult);
    const syncExit = /SYNC_EXIT:(\d+)/.exec(syncOut)?.[1] ?? "1";

    const filesUploaded: string[] = [
      `${destUri}/structured/test_results.jsonl`,
      `${destUri}/structured/coverage.json`,
      `${destUri}/structured/matrix.jsonl`,
    ];

    // ── Optionally publish raw artifacts ─────────────────────────────────────
    const rawUploaded: string[] = [];
    if (include_raw && syncExit === "0") {
      const rawFiles = [
        `${run_dir}/api_config.json`,
        `${run_dir}/collection_data.yml`,
        `${run_dir}/pairwise_matrix.csv`,
      ];

      // Discover collection, data, environment files
      try {
        const lsResult = await sandbox.run({
          command: `ls /workspace/${run_dir}/*.json 2>/dev/null && ls /workspace/${run_dir}/*.yml 2>/dev/null || true`,
        });
        const lsOut = textOf((lsResult as { stdout?: unknown }).stdout ?? lsResult);
        const extraFiles = lsOut
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.includes("_collection.json") || l.includes("_data.json") || l.includes("_environment.json"))
          .map((l) => l.replace("/workspace/", ""));
        rawFiles.push(...extraFiles);
      } catch { /* skip listing errors */ }

      for (const f of rawFiles) {
        const fileName = f.split("/").pop() ?? f;
        const destFile = joinUri(destUri, fileName);
        const cpCmd = [
          envPrefix,
          "aws s3 cp",
          `"/workspace/${shellEsc(f)}"`,
          `"${shellEsc(destFile)}"`,
          resolvedEndpoint ? `--endpoint-url "${shellEsc(resolvedEndpoint)}"` : "",
          "--no-progress 2>&1 || true",
        ].filter(Boolean).join(" ");
        await sandbox.run({ command: cpCmd });
        rawUploaded.push(destFile);
      }
    }

    // ── Build DuckDB query hints ─────────────────────────────────────────────
    const duckdbHints = [
      `-- Query all test results across runs:`,
      `SELECT feature, capability, status, COUNT(*) AS n`,
      `FROM read_json_auto('${joinUri(resolvedUri, "/**/test_results.jsonl")}',`,
      `     hive_partitioning=true, union_by_name=true)`,
      `GROUP BY 1, 2, 3 ORDER BY n DESC;`,
      ``,
      `-- Coverage trend:`,
      `SELECT year, month, day, api_name, newman_pass_rate_pct`,
      `FROM read_json_auto('${joinUri(resolvedUri, "/**/coverage.json")}',`,
      `     hive_partitioning=true, union_by_name=true)`,
      `ORDER BY year, month, day, api_name;`,
    ];

    // ── Write a _query_hints.sql file to the run for convenience ─────────────
    try {
      await writeRunArtifact(
        ctx,
        run_id,
        "structured/query_hints.sql",
        duckdbHints.join("\n") + "\n",
      );
      filesUploaded.push(`${destUri}/structured/query_hints.sql`);

      // Upload the hints file too
      const hintsSrc = `/workspace/${run_dir}/structured/query_hints.sql`;
      const hintsDest = joinUri(destUri, "structured/query_hints.sql");
      await sandbox.run({
        command: [
          envPrefix,
          "aws s3 cp",
          `"${shellEsc(hintsSrc)}"`,
          `"${shellEsc(hintsDest)}"`,
          resolvedEndpoint ? `--endpoint-url "${shellEsc(resolvedEndpoint)}"` : "",
          "--no-progress 2>&1 || true",
        ].filter(Boolean).join(" "),
      });
    } catch { /* query hints are optional */ }

    const succeeded = syncExit === "0";

    return {
      skipped: false,
      succeeded,
      published_uri: destUri,
      partition: {
        year,
        month,
        day,
        api_name: apiName,
        run_id,
        mode: partition_by,
      },
      structured_uri: `${destUri}/structured/`,
      files_uploaded: filesUploaded,
      raw_files_uploaded: rawUploaded,
      duckdb_example: duckdbHints.join("\n"),
      sync_output: syncOut.replace(/SYNC_EXIT:\d+/, "").trim(),
      error: succeeded ? null : `aws s3 sync exited with code ${syncExit}`,
    };
  },
});
