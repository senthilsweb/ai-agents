import { defineTool } from "eve/tools";
import { z } from "zod";

import { writeRunArtifact, readHostRunArtifact } from "shared/lib/run.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface Factor {
  name: string;
  levels: string[];
}

interface Constraint {
  if: Record<string, string>;
  expect_status?: number;
  skip?: Record<string, string>;
}

interface FactorDefinition {
  strength?: number;
  factors: Factor[];
  constraints?: Constraint[];
  must_include?: Record<string, string>[];
}

interface EndpointFactorDefinition extends FactorDefinition {
  operationId?: string;
}

interface FactorsModel {
  endpoints: Record<string, FactorDefinition> | EndpointFactorDefinition[];
}

type Row = Record<string, string>;

// ── IPOG pairwise algorithm (strength 2) ────────────────────────────────────
// Reference: Lei & Tai, "In-Parameter-Order: A Test Generation Strategy for
// Pairwise Testing", IEEE HASE 1998.

function cartesian(factors: Factor[]): Row[] {
  if (factors.length === 0) return [{}];
  const [first, ...rest] = factors;
  const restCombos = cartesian(rest);
  return first.levels.flatMap((v) =>
    restCombos.map((r) => ({ [first.name]: v, ...r })),
  );
}

interface Pair {
  f1: string;
  v1: string;
  f2: string;
  v2: string;
}

function allPairs(factors: Factor[]): Pair[] {
  const pairs: Pair[] = [];
  for (let i = 0; i < factors.length - 1; i++) {
    for (let j = i + 1; j < factors.length; j++) {
      for (const v1 of factors[i].levels) {
        for (const v2 of factors[j].levels) {
          pairs.push({ f1: factors[i].name, v1, f2: factors[j].name, v2 });
        }
      }
    }
  }
  return pairs;
}

function pairKey(p: Pair): string {
  return `${p.f1}=${p.v1}|${p.f2}=${p.v2}`;
}

function rowCoversPair(row: Row, pair: Pair): boolean {
  return row[pair.f1] === pair.v1 && row[pair.f2] === pair.v2;
}

function passesConstraints(row: Row, constraints: Constraint[]): boolean {
  for (const c of constraints) {
    const matches = Object.entries(c.if).every(([k, v]) => row[k] === v);
    if (!matches) continue;
    if (c.skip) {
      const skipMatch = Object.entries(c.skip).some(([k, v]) => row[k] === v);
      if (skipMatch) return false;
    }
  }
  return true;
}

function countCoverage(row: Row, uncovered: Set<string>, allPairsArr: Pair[]): number {
  return allPairsArr.filter(
    (p) => uncovered.has(pairKey(p)) && rowCoversPair(row, p),
  ).length;
}

function generatePairwise(
  factors: Factor[],
  constraints: Constraint[],
  mustInclude: Row[],
  strength: number,
): { rows: Row[]; totalPairs: number; feasiblePairs: number; coveredPairs: number } {
  if (factors.length === 0) return { rows: [{}], totalPairs: 0, feasiblePairs: 0, coveredPairs: 0 };
  if (factors.length === 1) {
    const rows = factors[0].levels
      .map((v) => ({ [factors[0].name]: v }))
      .filter((r) => passesConstraints(r, constraints));
    return { rows, totalPairs: 0, feasiblePairs: 0, coveredPairs: 0 };
  }

  const targetStrength = Math.min(strength, factors.length);
  const pairsArr = allPairs(factors);
  const totalPairs = pairsArr.length;

  // Mark infeasible pairs
  const feasiblePairs = pairsArr.filter((p) => {
    const partialRow: Row = { [p.f1]: p.v1, [p.f2]: p.v2 };
    // Fill remaining with first level and check constraints
    const fullRow = { ...partialRow };
    for (const f of factors) {
      if (!(f.name in fullRow)) fullRow[f.name] = f.levels[0];
    }
    return passesConstraints(fullRow, constraints);
  });

  const uncovered = new Set(feasiblePairs.map(pairKey));
  const testRows: Row[] = [];

  // Force-include must_include rows
  for (const must of mustInclude) {
    const fullRow: Row = { ...must };
    for (const f of factors) {
      if (!(f.name in fullRow)) fullRow[f.name] = f.levels[0];
    }
    if (passesConstraints(fullRow, constraints)) {
      testRows.push(fullRow);
      for (const p of pairsArr) {
        if (rowCoversPair(fullRow, p)) uncovered.delete(pairKey(p));
      }
    }
  }

  // IPOG: start with cartesian of first `targetStrength` factors
  const seedFactors = factors.slice(0, targetStrength);
  const seeds = cartesian(seedFactors).filter((r) => passesConstraints(r, constraints));

  // Bootstrap coverage from seeds (extend with remaining factors)
  let working: Row[] = seeds.map((seed) => {
    const row = { ...seed };
    for (const f of factors.slice(targetStrength)) {
      // Pick level that covers most uncovered pairs
      let best = f.levels[0];
      let bestCount = -1;
      for (const level of f.levels) {
        const candidate = { ...row, [f.name]: level };
        if (!passesConstraints(candidate, constraints)) continue;
        const count = countCoverage(candidate, uncovered, pairsArr);
        if (count > bestCount) {
          bestCount = count;
          best = level;
        }
      }
      row[f.name] = best;
    }
    return row;
  });

  for (const row of working) {
    if (passesConstraints(row, constraints)) {
      testRows.push(row);
      for (const p of pairsArr) {
        if (rowCoversPair(row, p)) uncovered.delete(pairKey(p));
      }
    }
  }

  // Greedy extension: cover remaining pairs
  const MAX_EXTRA = 200;
  let iterations = 0;
  while (uncovered.size > 0 && iterations++ < MAX_EXTRA) {
    const [firstKey] = uncovered;
    const [lhs, rhs] = firstKey.split("|");
    const [f1Name, v1] = lhs.split("=");
    const [f2Name, v2] = rhs.split("=");

    const row: Row = { [f1Name]: v1, [f2Name]: v2 };
    for (const f of factors) {
      if (f.name in row) continue;
      let best = f.levels[0];
      let bestCount = -1;
      for (const level of f.levels) {
        const candidate = { ...row, [f.name]: level };
        if (!passesConstraints(candidate, constraints)) continue;
        const count = countCoverage(candidate, uncovered, pairsArr);
        if (count > bestCount) {
          bestCount = count;
          best = level;
        }
      }
      row[f.name] = best;
    }

    if (passesConstraints(row, constraints)) {
      testRows.push(row);
      for (const p of pairsArr) {
        if (rowCoversPair(row, p)) uncovered.delete(pairKey(p));
      }
    } else {
      // Pair is structurally infeasible — skip it
      uncovered.delete(firstKey);
    }
  }

  return {
    rows: testRows,
    totalPairs,
    feasiblePairs: feasiblePairs.length,
    coveredPairs: feasiblePairs.length - uncovered.size,
  };
}

// ── PICT model file builder ──────────────────────────────────────────────────
// Generates a human-readable PICT-style model file alongside the JSON matrix.
// The file is auditable, version-controllable, and can be replayed with the
// PICT CLI. CI can diff it to detect unintentional factor drift.

function buildPictFile(opId: string, path: string, method: string, def: FactorDefinition): string {
  const timestamp = new Date().toISOString();
  const strength = def.strength ?? 2;
  const lines: string[] = [
    `# PICT Model — ${opId} (${method.toUpperCase()} ${path})`,
    `# Strength: ${strength} (${strength === 2 ? "pairwise" : strength === 3 ? "triples" : `t=${strength}`})`,
    `# Generated: ${timestamp}`,
    `# Tip: The constraint block is the most valuable part — keep it version-controlled.`,
    ``,
  ];

  for (const f of def.factors ?? []) {
    const vals = f.levels.map((v) => (v.includes(",") ? `"${v}"` : v)).join(", ");
    lines.push(`${f.name}: ${vals}`);
  }

  const constraints = def.constraints ?? [];
  if (constraints.length > 0) {
    lines.push(``);
    lines.push(`# Constraints`);
    for (const c of constraints) {
      const ifParts = Object.entries(c.if)
        .map(([k, v]) => `[${k}] = "${v}"`)
        .join(" AND ");
      if (c.skip) {
        const skipParts = Object.entries(c.skip)
          .map(([k, v]) => `[${k}] <> "${v}"`)
          .join(" AND ");
        lines.push(`IF ${ifParts} THEN ${skipParts};`);
      } else if (c.expect_status) {
        lines.push(`# IF ${ifParts} → expect HTTP ${c.expect_status} (see constraints in factors_model.json)`);
      }
    }
  }

  const mustInclude = def.must_include ?? [];
  if (mustInclude.length > 0) {
    lines.push(``);
    lines.push(`# Must-include rows (≥1 Smoke + ≥1 RBAC-negative per endpoint)`);
    for (const row of mustInclude) {
      const rowStr = Object.entries(row)
        .map(([k, v]) => `[${k}]="${v}"`)
        .join(", ");
      lines.push(`# MUST: ${rowStr}`);
    }
  }

  lines.push(``);
  return lines.join("\n");
}

// ── Tool ─────────────────────────────────────────────────────────────────────

export default defineTool({
  description:
    "Run the IPOG pairwise algorithm against the factors_model.json produced by " +
    "the Pairwise Designer subagent. Generates a minimum test matrix with maximum " +
    "pair coverage. Deterministic — no LLM involved.",
  inputSchema: z.object({
    run_dir: z.string().describe("Relative run directory."),
    factors_model_path: z
      .string()
      .describe("Path of factors_model.json, e.g. 'runs/<id>/factors_model.json'."),
  }),
  async execute({ run_dir, factors_model_path }, ctx) {
    const runId = run_dir.replace(/^runs\//, "");

    // ── Read factors model ──────────────────────────────────────────────────
    const raw = await readHostRunArtifact(runId, "factors_model.json");
    const factorsModelRaw = JSON.parse(raw) as FactorsModel;

    // Normalise: Pairwise Designer may emit endpoints as an array [{operationId, ...}]
    // or as a Record<operationId, FactorDefinition>. Unify to Record before processing.
    let endpointsDict: Record<string, FactorDefinition>;
    if (Array.isArray(factorsModelRaw.endpoints)) {
      endpointsDict = {};
      for (const ep of factorsModelRaw.endpoints) {
        const id = ep.operationId ?? String(Object.keys(endpointsDict).length);
        const { operationId: _drop, ...def } = ep as EndpointFactorDefinition;
        endpointsDict[id] = def as FactorDefinition;
      }
    } else {
      endpointsDict = factorsModelRaw.endpoints as Record<string, FactorDefinition>;
    }
    const factorsModel: FactorsModel = { ...factorsModelRaw, endpoints: endpointsDict };

    const matrixByEndpoint: Record<
      string,
      {
        strength: number;
        factors: number;
        rows: Row[];
        total_possible_pairs: number;
        feasible_pairs: number;
        covered_pairs: number;
        pair_coverage_pct: number;
        generated_rows: number;
        must_include_rows: number;
      }
    > = {};

    let totalRows = 0;
    let totalFeasible = 0;
    let totalCovered = 0;
    let endpointCount = 0;

    for (const [opId, def] of Object.entries(factorsModel.endpoints)) {
      const strength = def.strength ?? 2;
      const factors: Factor[] = def.factors ?? [];
      const constraints: Constraint[] = def.constraints ?? [];
      const mustInclude: Row[] = def.must_include ?? [];

      if (factors.length === 0) {
        matrixByEndpoint[opId] = {
          strength,
          factors: 0,
          rows: [{}],
          total_possible_pairs: 0,
          feasible_pairs: 0,
          covered_pairs: 0,
          pair_coverage_pct: 100,
          generated_rows: 1,
          must_include_rows: 0,
        };
        totalRows += 1;
        endpointCount++;
        continue;
      }

      const { rows, totalPairs, feasiblePairs, coveredPairs } = generatePairwise(
        factors,
        constraints,
        mustInclude,
        strength,
      );

      // Annotate each row with expected_status from constraints (for boundary/auth rows).
      // assemble_collection uses this to set the correct HTTP status in the data file.
      const annotatedRows: Row[] = rows.map((row) => {
        for (const c of constraints) {
          if (c.expect_status) {
            const matches = Object.entries(c.if).every(([k, v]) => row[k] === v);
            if (matches) {
              return { ...row, expected_status: String(c.expect_status) };
            }
          }
        }
        return row;
      });

      const coveragePct =
        feasiblePairs === 0 ? 100 : Math.round((coveredPairs / feasiblePairs) * 100);

      matrixByEndpoint[opId] = {
        strength,
        factors: factors.length,
        rows: annotatedRows,
        total_possible_pairs: totalPairs,
        feasible_pairs: feasiblePairs,
        covered_pairs: coveredPairs,
        pair_coverage_pct: coveragePct,
        generated_rows: rows.length,
        must_include_rows: mustInclude.length,
      };

      totalRows += rows.length;
      totalFeasible += feasiblePairs;
      totalCovered += coveredPairs;
      endpointCount++;
    }

    const overallCoverage =
      totalFeasible === 0 ? 100 : Math.round((totalCovered / totalFeasible) * 100);

    const matrix = { endpoints: matrixByEndpoint, total_rows: totalRows, pair_coverage_pct: overallCoverage };

    // ── Write JSON matrix ────────────────────────────────────────────────────
    const { hostPath: jsonPath } = await writeRunArtifact(
      ctx,
      runId,
      "pairwise_matrix.json",
      JSON.stringify(matrix, null, 2) + "\n",
    );

    // ── Write CSV ────────────────────────────────────────────────────────────
    const csvLines: string[] = [];
    const allFactorNames = new Set<string>();
    for (const def of Object.values(factorsModel.endpoints)) {
      for (const f of def.factors ?? []) allFactorNames.add(f.name);
    }
    const headers = ["endpoint", "row_index", ...allFactorNames];
    csvLines.push(headers.join(","));

    for (const [opId, data] of Object.entries(matrixByEndpoint)) {
      data.rows.forEach((row, idx) => {
        const vals = headers.map((h) => {
          if (h === "endpoint") return opId;
          if (h === "row_index") return String(idx);
          const v = row[h] ?? "";
          return v.includes(",") ? `"${v}"` : v;
        });
        csvLines.push(vals.join(","));
      });
    }

    const { hostPath: csvPath } = await writeRunArtifact(
      ctx,
      runId,
      "pairwise_matrix.csv",
      csvLines.join("\n") + "\n",
    );

    // ── Write .pict model files for auditability ─────────────────────────────
    const pictWrites: Promise<unknown>[] = [];
    for (const [opId, def] of Object.entries(factorsModel.endpoints)) {
      // Recover path/method from factors_model if present (optional metadata)
      const meta = def as FactorDefinition & { path?: string; method?: string };
      const pictContent = buildPictFile(opId, meta.path ?? `/<${opId}>`, meta.method ?? "GET", def);
      pictWrites.push(writeRunArtifact(ctx, runId, `pict_models/${opId}.pict`, pictContent));
    }
    await Promise.all(pictWrites);

    return {
      matrix_path: `${run_dir}/pairwise_matrix.json`,
      csv_path: `${run_dir}/pairwise_matrix.csv`,
      pict_models_dir: `${run_dir}/pict_models/`,
      host_json_path: jsonPath,
      host_csv_path: csvPath,
      total_rows: totalRows,
      endpoints_covered: endpointCount,
      pair_coverage_pct: overallCoverage,
    };
  },
});
