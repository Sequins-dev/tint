// Unified holistic Tint vs Node benchmark scorecard runner.
// Orchestrates Tint's comprehensive language-bench suites, Test262 batch canary,
// and existing benchmark suites (typed-bench, string-bench, general-call-bench)
// without modifying any existing benchmark CLI.
//
// Preparation (native compilation + Node parity checks) runs outside the timing
// lock; timed execution automatically acquires `tools/gate/with-lock.sh both`
// unless already running under an outer lock (`--locked` / TINT_SCORECARD_LOCKED=1).
//
// Usage:
//   node tools/scorecard.ts --quick [--suite a,b] [--label NAME] [--out-dir DIR]
//   node tools/scorecard.ts --full  [--suite a,b] [--label NAME] [--out-dir DIR]
//   node tools/scorecard.ts --suite language-typed,language-untyped --rounds 3
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  geometricMean,
  measureLanguageBench,
  prepareLanguageBench,
  resolveDefaultNode,
  type LanguageBenchReport,
  type PreparedLanguageBench,
} from "./language-bench/bench.ts";
import {
  measureTest262Canary,
  prepareTest262Canary,
  type PreparedTest262Canary,
  type SkippedTest262Canary,
  type Test262CanaryReport,
} from "./language-bench/test262-canary.ts";

export type ScorecardSuiteId =
  | "language-typed"
  | "language-untyped"
  | "language-general"
  | "language-async"
  | "test262-canary"
  | "typed-bench"
  | "string-bench"
  | "general-call-bench";

export const ALL_SCORECARD_SUITES: readonly ScorecardSuiteId[] = [
  "language-typed",
  "language-untyped",
  "language-general",
  "language-async",
  "test262-canary",
  "typed-bench",
  "string-bench",
  "general-call-bench",
];

export const QUICK_SCORECARD_SUITES: readonly ScorecardSuiteId[] = [
  "language-typed",
  "language-untyped",
  "language-general",
  "language-async",
  "test262-canary",
];

export type EntryMode = "typed" | "untyped" | "general" | "async" | "canary";

export interface ScorecardEntry {
  readonly suite: ScorecardSuiteId;
  readonly mode: EntryMode;
  readonly category: string;
  readonly kernel: string;
  readonly typedStatus?: "native" | "fallback";
  readonly nodeMs: number;
  readonly tintMs: number;
  readonly ratio: number;
  readonly scale?: number;
}

export interface GroupAggregate {
  readonly key: string;
  readonly count: number;
  readonly geomean: number;
  readonly minRatio: number;
  readonly maxRatio: number;
  readonly bestKernel: string;
  readonly worstKernel: string;
  readonly fasterThanNode: number;
  readonly withinParity: number;
  readonly slowDeficits: number;
}

export interface TypedTwinComparison {
  readonly kernel: string;
  readonly category: string;
  readonly typedRatio: number;
  readonly untypedRatio: number;
  readonly typedSpeedupOverUntyped: number;
}

export interface ScorecardSummary {
  readonly totalMeasurements: number;
  readonly typedCount: number;
  readonly untypedCount: number;
  readonly overallGeomean: number | null;
  readonly typedGeomean: number | null;
  readonly untypedGeomean: number | null;
  readonly typedVsUntypedSpeedupGeomean: number | null;
  readonly byCategory: readonly GroupAggregate[];
  readonly bySuite: readonly GroupAggregate[];
  readonly deficitsOver2x: readonly ScorecardEntry[];
  readonly typedTwins: readonly TypedTwinComparison[];
}

export interface SuiteStatusRecord {
  readonly suite: ScorecardSuiteId;
  readonly status: "completed" | "skipped";
  readonly reason?: string;
  readonly measurements: number;
}

export interface ScorecardReport {
  readonly kind: "tint-holistic-scorecard";
  readonly version: 1;
  readonly label: string;
  readonly profile: "quick" | "full" | "custom";
  readonly recordedAt: string;
  readonly head: string;
  readonly platform: string;
  readonly cpu: string | undefined;
  readonly node: string;
  readonly nodeVersion: string;
  readonly rounds: number;
  readonly steady: number;
  readonly suites: readonly SuiteStatusRecord[];
  readonly summary: ScorecardSummary;
  readonly entries: readonly ScorecardEntry[];
}

function summarizeGroup(
  key: string,
  items: readonly ScorecardEntry[],
): GroupAggregate {
  const valid = items.filter((e) => Number.isFinite(e.ratio) && e.ratio > 0);
  let best = valid[0] ?? items[0]!;
  let worst = valid[0] ?? items[0]!;
  let fasterThanNode = 0;
  let withinParity = 0;
  let slowDeficits = 0;
  for (const item of valid) {
    if (item.ratio < best.ratio) best = item;
    if (item.ratio > worst.ratio) worst = item;
    if (item.ratio < 1.0) fasterThanNode++;
    if (item.ratio <= 1.25) withinParity++;
    if (item.ratio > 2.0) slowDeficits++;
  }
  return {
    key,
    count: items.length,
    geomean: geometricMean(valid.map((e) => e.ratio)),
    minRatio: best.ratio,
    maxRatio: worst.ratio,
    bestKernel: `${best.suite}:${best.kernel}`,
    worstKernel: `${worst.suite}:${worst.kernel}`,
    fasterThanNode,
    withinParity,
    slowDeficits,
  };
}

export function aggregateScorecard(
  entries: readonly ScorecardEntry[],
): ScorecardSummary {
  const validRatios = (list: readonly ScorecardEntry[]) =>
    list.map((e) => e.ratio).filter((r) => Number.isFinite(r) && r > 0);

  const typedEntries = entries.filter((e) => e.mode === "typed");
  const untypedEntries = entries.filter((e) => e.mode !== "typed");

  const byCategoryMap = new Map<string, ScorecardEntry[]>();
  const bySuiteMap = new Map<string, ScorecardEntry[]>();
  for (const entry of entries) {
    const catList = byCategoryMap.get(entry.category) ?? [];
    catList.push(entry);
    byCategoryMap.set(entry.category, catList);

    const suiteList = bySuiteMap.get(entry.suite) ?? [];
    suiteList.push(entry);
    bySuiteMap.set(entry.suite, suiteList);
  }

  const byCategory = [...byCategoryMap.entries()]
    .map(([key, items]) => summarizeGroup(key, items))
    .sort((a, b) => a.key.localeCompare(b.key));
  const bySuite = [...bySuiteMap.entries()]
    .map(([key, items]) => summarizeGroup(key, items))
    .sort((a, b) => a.key.localeCompare(b.key));

  const deficitsOver2x = entries
    .filter((e) => Number.isFinite(e.ratio) && e.ratio > 2.0)
    .slice()
    .sort((a, b) => b.ratio - a.ratio);

  const langTypedByKernel = new Map(
    entries
      .filter((e) => e.suite === "language-typed")
      .map((e) => [e.kernel, e]),
  );
  const typedTwins: TypedTwinComparison[] = [];
  for (const untyped of entries.filter((e) => e.suite === "language-untyped")) {
    const typed = langTypedByKernel.get(untyped.kernel);
    if (
      typed !== undefined &&
      typed.tintMs > 0 &&
      untyped.tintMs > 0 &&
      Number.isFinite(typed.ratio) &&
      Number.isFinite(untyped.ratio)
    ) {
      typedTwins.push({
        kernel: untyped.kernel,
        category: untyped.category,
        typedRatio: typed.ratio,
        untypedRatio: untyped.ratio,
        typedSpeedupOverUntyped: untyped.tintMs / typed.tintMs,
      });
    }
  }
  typedTwins.sort(
    (a, b) => b.typedSpeedupOverUntyped - a.typedSpeedupOverUntyped,
  );

  const safeGeo = (values: readonly number[]) =>
    values.length === 0 ? null : geometricMean(values);

  return {
    totalMeasurements: entries.length,
    typedCount: typedEntries.length,
    untypedCount: untypedEntries.length,
    overallGeomean: safeGeo(validRatios(entries)),
    typedGeomean: safeGeo(validRatios(typedEntries)),
    untypedGeomean: safeGeo(validRatios(untypedEntries)),
    typedVsUntypedSpeedupGeomean: safeGeo(
      typedTwins.map((t) => t.typedSpeedupOverUntyped),
    ),
    byCategory,
    bySuite,
    deficitsOver2x,
    typedTwins,
  };
}

export function renderScorecardMarkdown(report: ScorecardReport): string {
  const fmtRatio = (v: number | null) =>
    v === null || !Number.isFinite(v) ? "n/a" : `${v.toFixed(2)}×`;
  const lines: string[] = [
    `# Tint Holistic Language & Builtin Scorecard (${report.label})`,
    "",
    `- **Recorded:** ${report.recordedAt}`,
    `- **Profile:** \`${report.profile}\` (rounds=${report.rounds}, steady=${report.steady})`,
    `- **Commit:** \`${report.head}\``,
    `- **Host:** ${report.platform}${report.cpu ? ` (${report.cpu})` : ""}`,
    `- **Node:** ${report.nodeVersion} (\`${report.node}\`)`,
    "",
    "## Executive Summary",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Total measurements (Node checksum verified) | ${report.summary.totalMeasurements} |`,
    `| **Overall Geomean (Tint / Node)** | **${fmtRatio(report.summary.overallGeomean)}** |`,
    `| **Typed Geomean (${report.summary.typedCount} measurements)** | **${fmtRatio(report.summary.typedGeomean)}** |`,
    `| **Untyped / General / Async / Canary Geomean (${report.summary.untypedCount} measurements)** | **${fmtRatio(report.summary.untypedGeomean)}** |`,
    `| **Typed Speedup vs Untyped Twin Geomean (${report.summary.typedTwins.length} pairs)** | **${fmtRatio(report.summary.typedVsUntypedSpeedupGeomean)}** |`,
    `| Deficits > 2.00× slower than Node | ${report.summary.deficitsOver2x.length} |`,
    "",
    "## Suite Status",
    "",
    "| Suite | Status | Measurements | Notes |",
    "| --- | --- | ---: | --- |",
  ];
  for (const s of report.suites) {
    lines.push(
      `| \`${s.suite}\` | ${s.status} | ${s.measurements} | ${s.reason ?? "-"} |`,
    );
  }

  lines.push(
    "",
    "## Per-Suite Summary (Tint / Node, lower is better)",
    "",
    "| Suite | Count | Geomean | Best | Worst | < 1.0× | <= 1.25× | > 2.0× |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const row of report.summary.bySuite) {
    lines.push(
      `| \`${row.key}\` | ${row.count} | ${fmtRatio(row.geomean)} | ${fmtRatio(row.minRatio)} | ${fmtRatio(row.maxRatio)} (\`${row.worstKernel}\`) | ${row.fasterThanNode} | ${row.withinParity} | ${row.slowDeficits} |`,
    );
  }

  lines.push(
    "",
    "## Per-Category Summary (Tint / Node, lower is better)",
    "",
    "| Category | Count | Geomean | Best | Worst | < 1.0× | <= 1.25× | > 2.0× |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const row of report.summary.byCategory) {
    lines.push(
      `| \`${row.key}\` | ${row.count} | ${fmtRatio(row.geomean)} | ${fmtRatio(row.minRatio)} | ${fmtRatio(row.maxRatio)} (\`${row.worstKernel}\`) | ${row.fasterThanNode} | ${row.withinParity} | ${row.slowDeficits} |`,
    );
  }

  if (report.summary.typedTwins.length > 0) {
    lines.push(
      "",
      "## Typed vs Untyped Twin Comparison",
      "",
      "| Kernel | Category | Typed / Node | Untyped / Node | Typed Speedup vs Untyped |",
      "| --- | --- | ---: | ---: | ---: |",
    );
    for (const twin of report.summary.typedTwins) {
      lines.push(
        `| \`${twin.kernel}\` | \`${twin.category}\` | ${fmtRatio(twin.typedRatio)} | ${fmtRatio(twin.untypedRatio)} | ${twin.typedSpeedupOverUntyped.toFixed(2)}× |`,
      );
    }
  }

  if (report.summary.deficitsOver2x.length > 0) {
    lines.push(
      "",
      "## Deficits > 2.00× Slower Than Node (Perf-Queue Candidates)",
      "",
      "| Suite | Mode | Category | Kernel | Node ms | Tint ms | Tint / Node |",
      "| --- | --- | --- | --- | ---: | ---: | ---: |",
    );
    for (const d of report.summary.deficitsOver2x.slice(0, 40)) {
      lines.push(
        `| \`${d.suite}\` | ${d.mode} | \`${d.category}\` | \`${d.kernel}\` | ${d.nodeMs.toFixed(2)} | ${d.tintMs.toFixed(2)} | **${d.ratio.toFixed(2)}×** |`,
      );
    }
  }

  lines.push(
    "",
    "## Full Kernel Table",
    "",
    "| Suite | Mode | Category | Kernel | Node ms | Tint ms | Tint / Node |",
    "| --- | --- | --- | --- | ---: | ---: | ---: |",
  );
  for (const e of report.entries) {
    lines.push(
      `| \`${e.suite}\` | ${e.mode} | \`${e.category}\` | \`${e.kernel}\` | ${e.nodeMs.toFixed(2)} | ${e.tintMs.toFixed(2)} | ${e.ratio.toFixed(2)}× |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function entriesFromLanguageReport(
  suiteId: ScorecardSuiteId,
  mode: EntryMode,
  report: LanguageBenchReport,
): ScorecardEntry[] {
  return Object.entries(report.summary).map(([kernel, row]) => ({
    suite: suiteId,
    mode,
    category: row.category,
    kernel,
    typedStatus: row.typedStatus,
    nodeMs: row.nodeSteadyMs.median,
    tintMs: row.tintSteadyMs.median,
    ratio: row.steadyOverNode.median,
    scale: row.scale,
  }));
}

export function entriesFromCanaryReport(
  report: Test262CanaryReport,
): ScorecardEntry[] {
  return Object.entries(report.summary).map(([group, row]) => ({
    suite: "test262-canary",
    mode: "canary",
    category: "test262-canary",
    kernel: group,
    nodeMs: row.nodeSteadyMs.median,
    tintMs: row.tintSteadyMs.median,
    ratio: row.steadyOverNode.median,
    scale: row.expectedExecutions,
  }));
}

/** Parse smoke output from existing tools/typed-bench/bench.ts or
 * tools/string-bench/bench.ts without altering those scripts. */
export function parseLegacyBenchSmoke(
  output: string,
  suiteId: ScorecardSuiteId,
  mode: EntryMode,
  category: string,
): ScorecardEntry[] {
  const nodeSteady = new Map<string, number>();
  const tintSteady = new Map<string, number>();
  for (const match of output.matchAll(
    /^(node|tint)\s+(\S+)\s+cold\s+([0-9.]+)\s+steady\s+([0-9.]+)\s*$/gm,
  )) {
    const engine = match[1]!;
    const kernel = match[2]!;
    const steady = Number(match[4]);
    if (engine === "node") nodeSteady.set(kernel, steady);
    else tintSteady.set(kernel, steady);
  }
  const entries: ScorecardEntry[] = [];
  for (const [kernel, n] of nodeSteady) {
    const t = tintSteady.get(kernel);
    if (t === undefined) continue;
    entries.push({
      suite: suiteId,
      mode,
      category,
      kernel,
      nodeMs: n,
      tintMs: t,
      ratio: n > 0 ? t / n : 1,
    });
  }
  return entries;
}

/** Parse measure JSON report from existing tools/typed-bench/bench.ts or
 * tools/string-bench/bench.ts. */
export function parseLegacyBenchReport(
  json: {
    readonly summary: Record<
      string,
      {
        readonly node: { readonly steadyMs: { readonly median: number } };
        readonly tint: {
          readonly steadyMs: { readonly median: number };
          readonly steadyOverNode: { readonly median: number };
        };
      }
    >;
  },
  suiteId: ScorecardSuiteId,
  mode: EntryMode,
  category: string,
): ScorecardEntry[] {
  return Object.entries(json.summary).map(([kernel, row]) => ({
    suite: suiteId,
    mode,
    category,
    kernel,
    nodeMs: row.node.steadyMs.median,
    tintMs: row.tint.steadyMs.median,
    ratio: row.tint.steadyOverNode.median,
  }));
}

interface PreparedWorkManifest {
  readonly label: string;
  readonly profile: "quick" | "full" | "custom";
  readonly node: string;
  readonly nodeVersion: string;
  readonly head: string;
  readonly rounds: number;
  readonly steady: number;
  readonly quick: boolean;
  readonly outDir: string;
  readonly suites: readonly ScorecardSuiteId[];
  readonly items: {
    readonly suite: ScorecardSuiteId;
    readonly mode: EntryMode;
    readonly kind:
      | "language-bench"
      | "test262-canary"
      | "legacy-typed-bench"
      | "legacy-string-bench"
      | "legacy-general-call-bench"
      | "skipped";
    readonly preparedPath?: string;
    readonly reason?: string;
    readonly subSuite?: string;
  }[];
}

function execute(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, TZ: "UTC", ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

function parseSuitesOption(
  raw: string | undefined,
  profile: "quick" | "full" | "custom",
): readonly ScorecardSuiteId[] {
  if (!raw) {
    return profile === "full" ? ALL_SCORECARD_SUITES : QUICK_SCORECARD_SUITES;
  }
  if (raw === "all") return ALL_SCORECARD_SUITES;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    assert.ok(
      (ALL_SCORECARD_SUITES as readonly string[]).includes(part),
      `unknown scorecard suite "${part}"; valid suites: ${ALL_SCORECARD_SUITES.join(", ")}`,
    );
  }
  return parts as ScorecardSuiteId[];
}

async function prepareWork(options: {
  readonly label: string;
  readonly profile: "quick" | "full" | "custom";
  readonly suites: readonly ScorecardSuiteId[];
  readonly node: string;
  readonly rounds: number;
  readonly steady: number;
  readonly quick: boolean;
  readonly outDir: string;
}): Promise<{ readonly workDir: string; readonly manifestPath: string }> {
  const workDir = mkdtempSync(join(tmpdir(), "tint-scorecard-"));
  const node = resolve(options.node);
  const nodeVersion = execute(node, ["--version"]).trim();
  const head = execute("git", ["rev-parse", "HEAD"]).trim();
  const items: PreparedWorkManifest["items"] = [];

  for (const suite of options.suites) {
    if (
      suite === "language-typed" ||
      suite === "language-untyped" ||
      suite === "language-general" ||
      suite === "language-async"
    ) {
      const langSuite = suite.replace("language-", "") as
        "typed" | "untyped" | "general" | "async";
      const prepared = await prepareLanguageBench({
        node,
        suite: langSuite,
        steady: options.steady,
        quick: options.quick,
      });
      const preparedPath = join(workDir, `${suite}.prepared.json`);
      writeFileSync(preparedPath, JSON.stringify(prepared, null, 2) + "\n");
      items.push({
        suite,
        mode: langSuite,
        kind: "language-bench",
        preparedPath,
      });
    } else if (suite === "test262-canary") {
      const prepared = prepareTest262Canary({
        node,
        steady: options.steady,
        quick: options.quick,
        allowMissing: true,
      });
      if (prepared.kind === "tint-test262-canary-skipped") {
        items.push({
          suite,
          mode: "canary",
          kind: "skipped",
          reason: prepared.reason,
        });
      } else {
        const preparedPath = join(workDir, "test262-canary.prepared.json");
        writeFileSync(preparedPath, JSON.stringify(prepared, null, 2) + "\n");
        items.push({
          suite,
          mode: "canary",
          kind: "test262-canary",
          preparedPath,
        });
      }
    } else if (suite === "typed-bench") {
      if (nodeVersion !== "v26.13.1") {
        items.push({
          suite,
          mode: "typed",
          kind: "skipped",
          reason: `typed-bench requires Node v26.13.1 (found ${nodeVersion})`,
        });
      } else {
        for (const sub of ["typed", "classes"] as const) {
          const preparedPath = join(
            workDir,
            `typed-bench-${sub}.prepared.json`,
          );
          execute(process.execPath, [
            "tools/typed-bench/bench.ts",
            "prepare",
            node,
            preparedPath,
            "--suite",
            sub,
            "--steady",
            String(options.steady),
          ]);
          items.push({
            suite,
            mode: "typed",
            kind: "legacy-typed-bench",
            preparedPath,
            subSuite: sub,
          });
        }
      }
    } else if (suite === "string-bench") {
      if (nodeVersion !== "v26.13.1") {
        items.push({
          suite,
          mode: "typed",
          kind: "skipped",
          reason: `string-bench requires Node v26.13.1 (found ${nodeVersion})`,
        });
      } else {
        for (const sub of ["typed", "general"] as const) {
          const preparedPath = join(
            workDir,
            `string-bench-${sub}.prepared.json`,
          );
          execute(process.execPath, [
            "tools/string-bench/bench.ts",
            "prepare",
            node,
            preparedPath,
            "--suite",
            sub,
            "--steady",
            String(options.steady),
          ]);
          items.push({
            suite,
            mode: sub,
            kind: "legacy-string-bench",
            preparedPath,
            subSuite: sub,
          });
        }
      }
    } else if (suite === "general-call-bench") {
      if (nodeVersion !== "v26.13.1") {
        items.push({
          suite,
          mode: "untyped",
          kind: "skipped",
          reason: `general-call-bench requires Node v26.13.1 (found ${nodeVersion})`,
        });
      } else {
        const preparedPath = join(workDir, "general-call-bench.prepared.json");
        execute(process.execPath, [
          "tools/general-call-bench/benchmark.ts",
          "prepare",
          node,
          preparedPath,
        ]);
        items.push({
          suite,
          mode: "untyped",
          kind: "legacy-general-call-bench",
          preparedPath,
        });
      }
    }
  }

  const manifest: PreparedWorkManifest = {
    label: options.label,
    profile: options.profile,
    node,
    nodeVersion,
    head,
    rounds: options.rounds,
    steady: options.steady,
    quick: options.quick,
    outDir: resolve(options.outDir),
    suites: options.suites,
    items,
  };
  const manifestPath = join(workDir, "scorecard-work.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return { workDir, manifestPath };
}

function runPreparedManifest(manifestPath: string): ScorecardReport {
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as PreparedWorkManifest;
  const entries: ScorecardEntry[] = [];
  const suiteCounts = new Map<ScorecardSuiteId, number>();
  const suiteSkipped = new Map<ScorecardSuiteId, string>();

  for (const item of manifest.items) {
    if (item.kind === "skipped") {
      suiteSkipped.set(item.suite, item.reason ?? "skipped");
      continue;
    }
    if (item.kind === "language-bench") {
      const prepared = JSON.parse(
        readFileSync(item.preparedPath!, "utf8"),
      ) as PreparedLanguageBench;
      const report = measureLanguageBench(prepared, manifest.rounds);
      const added = entriesFromLanguageReport(item.suite, item.mode, report);
      entries.push(...added);
      suiteCounts.set(
        item.suite,
        (suiteCounts.get(item.suite) ?? 0) + added.length,
      );
    } else if (item.kind === "test262-canary") {
      const prepared = JSON.parse(readFileSync(item.preparedPath!, "utf8")) as
        PreparedTest262Canary | SkippedTest262Canary;
      if (prepared.kind === "tint-test262-canary-skipped") {
        suiteSkipped.set(item.suite, prepared.reason);
      } else {
        const report = measureTest262Canary(prepared, manifest.rounds);
        const added = entriesFromCanaryReport(report);
        entries.push(...added);
        suiteCounts.set(
          item.suite,
          (suiteCounts.get(item.suite) ?? 0) + added.length,
        );
      }
    } else if (
      item.kind === "legacy-typed-bench" ||
      item.kind === "legacy-string-bench"
    ) {
      const tool =
        item.kind === "legacy-typed-bench"
          ? "tools/typed-bench/bench.ts"
          : "tools/string-bench/bench.ts";
      const category =
        item.kind === "legacy-typed-bench"
          ? `typed-bench:${item.subSuite ?? "typed"}`
          : `string-bench:${item.subSuite ?? "typed"}`;
      if (manifest.quick) {
        const out = execute(process.execPath, [
          tool,
          "smoke",
          item.preparedPath!,
        ]);
        const added = parseLegacyBenchSmoke(
          out,
          item.suite,
          item.mode,
          category,
        );
        entries.push(...added);
        suiteCounts.set(
          item.suite,
          (suiteCounts.get(item.suite) ?? 0) + added.length,
        );
      } else {
        const reportPath = item.preparedPath!.replace(
          ".prepared.json",
          ".report.json",
        );
        execute(process.execPath, [
          tool,
          "measure",
          item.preparedPath!,
          reportPath,
          String(Math.max(15, manifest.rounds)),
        ]);
        const parsed = JSON.parse(
          readFileSync(reportPath, "utf8"),
        ) as Parameters<typeof parseLegacyBenchReport>[0];
        const added = parseLegacyBenchReport(
          parsed,
          item.suite,
          item.mode,
          category,
        );
        entries.push(...added);
        suiteCounts.set(
          item.suite,
          (suiteCounts.get(item.suite) ?? 0) + added.length,
        );
      }
    } else if (item.kind === "legacy-general-call-bench") {
      if (manifest.quick) {
        const out = execute(process.execPath, [
          "tools/general-call-bench/benchmark.ts",
          "smoke",
          item.preparedPath!,
        ]);
        // Parse smoke dict lines: "Node { ... }" / "untyped { ... }" / "typed { ... }"
        const nodeMap = new Map<string, number>();
        const untypedMap = new Map<string, number>();
        const typedMap = new Map<string, number>();
        let current: Map<string, number> | undefined;
        for (const line of out.split("\n")) {
          if (line.startsWith("Node ")) current = nodeMap;
          else if (line.startsWith("untyped ")) current = untypedMap;
          else if (line.startsWith("typed ")) current = typedMap;
          const kv = /^\s*(\w+):\s*([0-9.eE+-]+)/.exec(line);
          if (kv && current) current.set(kv[1]!, Number(kv[2]));
        }
        for (const [kernel, n] of nodeMap) {
          const u = untypedMap.get(kernel);
          if (u !== undefined) {
            entries.push({
              suite: item.suite,
              mode: "untyped",
              category: "general-call-bench:untyped",
              kernel,
              nodeMs: n,
              tintMs: u,
              ratio: n > 0 ? u / n : 1,
            });
          }
          const t = typedMap.get(kernel);
          if (t !== undefined) {
            entries.push({
              suite: item.suite,
              mode: "typed",
              category: "general-call-bench:typed",
              kernel,
              nodeMs: n,
              tintMs: t,
              ratio: n > 0 ? t / n : 1,
            });
          }
        }
        suiteCounts.set(
          item.suite,
          (suiteCounts.get(item.suite) ?? 0) + untypedMap.size + typedMap.size,
        );
      } else {
        const reportPath = item.preparedPath!.replace(
          ".prepared.json",
          ".report.json",
        );
        const rounds = Math.max(15, Math.ceil(manifest.rounds / 3) * 3);
        execute(process.execPath, [
          "tools/general-call-bench/benchmark.ts",
          "measure",
          item.preparedPath!,
          reportPath,
          String(rounds),
        ]);
        const parsed = JSON.parse(readFileSync(reportPath, "utf8")) as {
          summary: Record<string, Record<string, { ns: { median: number } }>>;
        };
        let count = 0;
        for (const [kernel, row] of Object.entries(parsed.summary)) {
          const n = row.node?.ns.median ?? 0;
          if (row.untyped) {
            entries.push({
              suite: item.suite,
              mode: "untyped",
              category: "general-call-bench:untyped",
              kernel,
              nodeMs: n,
              tintMs: row.untyped.ns.median,
              ratio: n > 0 ? row.untyped.ns.median / n : 1,
            });
            count++;
          }
          if (row.typed) {
            entries.push({
              suite: item.suite,
              mode: "typed",
              category: "general-call-bench:typed",
              kernel,
              nodeMs: n,
              tintMs: row.typed.ns.median,
              ratio: n > 0 ? row.typed.ns.median / n : 1,
            });
            count++;
          }
        }
        suiteCounts.set(item.suite, (suiteCounts.get(item.suite) ?? 0) + count);
      }
    }
  }

  const suites: SuiteStatusRecord[] = manifest.suites.map((suite) => {
    const skippedReason = suiteSkipped.get(suite);
    if (skippedReason !== undefined) {
      return {
        suite,
        status: "skipped",
        reason: skippedReason,
        measurements: 0,
      };
    }
    return {
      suite,
      status: "completed",
      measurements: suiteCounts.get(suite) ?? 0,
    };
  });

  const report: ScorecardReport = {
    kind: "tint-holistic-scorecard",
    version: 1,
    label: manifest.label,
    profile: manifest.profile,
    recordedAt: new Date().toISOString(),
    head: manifest.head,
    platform: process.platform + "-" + process.arch,
    cpu: cpus()[0]?.model,
    node: manifest.node,
    nodeVersion: manifest.nodeVersion,
    rounds: manifest.rounds,
    steady: manifest.steady,
    suites,
    summary: aggregateScorecard(entries),
    entries,
  };

  mkdirSync(manifest.outDir, { recursive: true });
  const jsonPath = join(manifest.outDir, `scorecard-${manifest.label}.json`);
  const mdPath = join(manifest.outDir, `scorecard-${manifest.label}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(mdPath, renderScorecardMarkdown(report));
  console.error(`Wrote scorecard JSON: ${jsonPath}`);
  console.error(`Wrote scorecard Markdown: ${mdPath}`);
  console.log(renderScorecardMarkdown(report));
  return report;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flagValue = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at < 0 ? undefined : argv[at + 1];
  };

  const measurePrepared = flagValue("--measure-prepared");
  if (measurePrepared !== undefined) {
    runPreparedManifest(measurePrepared);
    return;
  }

  const isQuick = argv.includes("--quick");
  const isFull = argv.includes("--full");
  assert.ok(!(isQuick && isFull), "cannot pass both --quick and --full");
  const suiteFlag = flagValue("--suite");
  const profile: "quick" | "full" | "custom" = isFull
    ? "full"
    : isQuick
      ? "quick"
      : suiteFlag !== undefined
        ? "custom"
        : "quick";

  const suites = parseSuitesOption(suiteFlag, profile);
  const quick = profile !== "full";
  const rounds = Number(flagValue("--rounds") ?? (quick ? "2" : "5"));
  const steady = Number(flagValue("--steady") ?? (quick ? "2" : "5"));
  const node = flagValue("--node") ?? resolveDefaultNode();
  const shortHead = execute("git", ["rev-parse", "--short=9", "HEAD"]).trim();
  const label =
    flagValue("--label") ??
    `${profile}-${process.platform}-${process.arch}-${shortHead}`;
  const outDir = flagValue("--out-dir") ?? "docs/results";
  const alreadyLocked =
    argv.includes("--locked") ||
    argv.includes("--no-lock") ||
    process.env.TINT_SCORECARD_LOCKED === "1";

  console.error(
    `[scorecard] preparing ${suites.length} suites (${suites.join(", ")}) for profile=${profile}...`,
  );
  const { manifestPath } = await prepareWork({
    label,
    profile,
    suites,
    node,
    rounds,
    steady,
    quick,
    outDir,
  });

  if (alreadyLocked || !existsSync("tools/gate/with-lock.sh")) {
    runPreparedManifest(manifestPath);
  } else {
    console.error(
      "[scorecard] acquiring tools/gate/with-lock.sh both for timed execution...",
    );
    const result = spawnSync(
      "tools/gate/with-lock.sh",
      [
        "both",
        `scorecard-${label}`,
        process.execPath,
        "tools/scorecard.ts",
        "--measure-prepared",
        manifestPath,
      ],
      {
        stdio: "inherit",
        env: { ...process.env, TZ: "UTC", TINT_SCORECARD_LOCKED: "1" },
      },
    );
    if (result.error !== undefined) throw result.error;
    assert.equal(
      result.status,
      0,
      `locked scorecard failed with ${String(result.status)}`,
    );
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
