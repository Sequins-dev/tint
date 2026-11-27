// Test262-derived broad-coverage batch-throughput benchmark canary.
// Loads unchanged Test262 semantic tests listed in test262-canary-manifest.json
// from a local Test262 checkout (never copying Test262 sources into git), wraps
// each test in an isolated function, and times batched loop execution on both
// Node and Tint (general/realm path) so execution speed across dozens of
// ECMAScript syntax and builtin corners is measured rather than process startup.
//
// Usage:
//   node tools/language-bench/test262-canary.ts prepare NODE PREPARED.json \
//     [--test262 DIR] [--iterations N] [--steady N] [--quick] [--allow-missing]
//   tools/gate/with-lock.sh launch test262-canary-smoke \
//     node tools/language-bench/test262-canary.ts smoke PREPARED.json
//   tools/gate/with-lock.sh both test262-canary \
//     node tools/language-bench/test262-canary.ts measure PREPARED.json REPORT.json [ROUNDS]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyHostedFixture } from "../hosted-fixture.ts";
import { nativeFixtureTarget } from "../native-host-target.ts";
import { nativeArtifact } from "../native-target-runner.ts";
import {
  distribution,
  geometricMean,
  median,
  runNativeImage,
  type Distribution,
  type KernelRunValues,
  type NativeArtifactRecord,
} from "./bench.ts";

export const TEST262_CANARY_MARKER = "TINT_TEST262_CANARY";
const clock = "packages/native-runtime/src/intrinsics/clock.ts";

export interface Test262CanaryCase {
  readonly group: string;
  readonly family: string;
  readonly path: string;
}

export interface Test262CanaryManifest {
  readonly version: 1;
  readonly description: string;
  readonly harnesses: readonly string[];
  readonly defaultIterations: number;
  readonly quickIterations: number;
  readonly cases: readonly Test262CanaryCase[];
}

export interface Test262CanaryGroupSpec {
  readonly group: string;
  readonly caseCount: number;
  readonly iterations: number;
  readonly expectedExecutions: number;
}

export interface PreparedTest262Canary {
  readonly kind: "tint-test262-canary-prepared";
  readonly version: 1;
  readonly test262Dir: string;
  readonly test262Revision: string | undefined;
  readonly head: string;
  readonly platform: string;
  readonly node: string;
  readonly nodeVersion: string;
  readonly nodeSha256: string;
  readonly script: string;
  readonly scriptSha256: string;
  readonly native: NativeArtifactRecord;
  readonly steady: number;
  readonly iterations: number;
  readonly totalCases: number;
  readonly groups: Record<string, Test262CanaryGroupSpec>;
}

export interface SkippedTest262Canary {
  readonly kind: "tint-test262-canary-skipped";
  readonly version: 1;
  readonly reason: string;
}

export interface Test262CanaryGroupSummary {
  readonly caseCount: number;
  readonly iterations: number;
  readonly expectedExecutions: number;
  readonly nodeSteadyMs: Distribution;
  readonly tintSteadyMs: Distribution;
  readonly steadyOverNode: Distribution;
  readonly nodeCasesPerSec: number;
  readonly tintCasesPerSec: number;
}

export interface Test262CanaryReport {
  readonly kind: "tint-test262-canary-report";
  readonly version: 1;
  readonly prepared: PreparedTest262Canary;
  readonly cpu: string | undefined;
  readonly rounds: number;
  readonly summary: Record<string, Test262CanaryGroupSummary>;
  readonly overallGeomeanOverNode: number;
  readonly totalNodeCasesPerSec: number;
  readonly totalTintCasesPerSec: number;
}

export function loadCanaryManifest(): Test262CanaryManifest {
  const url = new URL("./test262-canary-manifest.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Test262CanaryManifest;
}

export function isValidTest262Checkout(dir: string): boolean {
  return (
    existsSync(join(dir, "test")) &&
    existsSync(join(dir, "harness", "assert.js")) &&
    existsSync(join(dir, "harness", "sta.js"))
  );
}

/** Locate a local Test262 checkout without requiring one to be present in CI.
 * Checks explicit arg, TINT_TEST262_DIR, cwd/.tint-bootstrap/test262, and the
 * shared git common-dir parent's .tint-bootstrap/test262 (for worktrees). */
export function resolveTest262Directory(explicit?: string): string | undefined {
  if (explicit !== undefined) {
    const resolved = resolve(explicit);
    return isValidTest262Checkout(resolved) ? resolved : undefined;
  }
  const candidates: string[] = [];
  if (process.env.TINT_TEST262_DIR)
    candidates.push(resolve(process.env.TINT_TEST262_DIR));
  candidates.push(resolve(".tint-bootstrap/test262"));
  const common = spawnSync("git", ["rev-parse", "--git-common-dir"], {
    encoding: "utf8",
  });
  if (common.status === 0 && common.stdout.trim()) {
    const commonDir = resolve(common.stdout.trim());
    candidates.push(resolve(dirname(commonDir), ".tint-bootstrap/test262"));
  }
  for (const candidate of candidates) {
    if (isValidTest262Checkout(candidate)) return candidate;
  }
  return undefined;
}

export function stripTest262Frontmatter(source: string): string {
  const match = /\/\*---[\s\S]*?---\*\//.exec(source);
  if (match === null) return source;
  return source.slice(match.index + match[0].length);
}

/** Build a single self-contained JS module that embeds the Test262 harnesses
 * and wraps each manifest test in an isolated function grouped by category. */
export function synthesizeCanaryWorkload(
  test262Dir: string,
  manifest: Test262CanaryManifest,
  iterations: number,
  steady: number,
): {
  readonly workload: string;
  readonly groups: Record<string, Test262CanaryGroupSpec>;
  readonly totalCases: number;
} {
  assert.ok(
    Number.isSafeInteger(iterations) && iterations >= 1,
    "iterations must be >= 1",
  );
  assert.ok(Number.isSafeInteger(steady) && steady >= 1, "steady must be >= 1");

  const harnessCode = manifest.harnesses
    .map((file) => {
      const full = join(test262Dir, "harness", file);
      assert.ok(existsSync(full), "missing Test262 harness: " + full);
      return `// --- harness/${file} ---\n` + readFileSync(full, "utf8");
    })
    .join("\n\n");

  const grouped = new Map<
    string,
    { index: number; path: string; body: string }[]
  >();
  manifest.cases.forEach((entry, index) => {
    const full = join(test262Dir, "test", entry.path);
    assert.ok(existsSync(full), "missing Test262 case: " + full);
    const body = stripTest262Frontmatter(readFileSync(full, "utf8"));
    const list = grouped.get(entry.group) ?? [];
    list.push({ index, path: entry.path, body });
    grouped.set(entry.group, list);
  });

  const caseFunctions: string[] = [];
  const groupFunctions: string[] = [];
  const groups: Record<string, Test262CanaryGroupSpec> = {};

  for (const [group, entries] of grouped) {
    const fnId = group.replace(/[^a-zA-Z0-9_]/g, "_");
    for (const item of entries) {
      caseFunctions.push(
        `function __t262_case_${item.index}() {\n  "use strict";\n${item.body}\n}`,
      );
    }
    const calls = entries
      .map(
        (item) =>
          `    try { __t262_case_${item.index}(); } catch (err) { report("${TEST262_CANARY_MARKER}_FAIL ${item.path} " + String(err)); throw err; }`,
      )
      .join("\n");
    groupFunctions.push(
      `function __t262_group_${fnId}(iterations) {
  let executed = 0;
  for (let i = 0; i < iterations; i++) {
${calls}
    executed += ${entries.length};
  }
  return executed;
}`,
    );
    groups[group] = {
      group,
      caseCount: entries.length,
      iterations,
      expectedExecutions: entries.length * iterations,
    };
  }

  const driverBlocks = Object.entries(groups).map(([group, spec], idx) => {
    const fnId = group.replace(/[^a-zA-Z0-9_]/g, "_");
    return `  for (let iteration = 0; iteration <= ${steady}; iteration++) {
    const started = now();
    const executed = __t262_group_${fnId}(${spec.iterations});
    const elapsed = now() - started;
    if (executed !== ${spec.expectedExecutions}) return ${10 + idx};
    report("${TEST262_CANARY_MARKER} ${group} " + String(iteration) + " " + String(elapsed) + " " + String(executed));
  }`;
  });

  const workload = `${harnessCode}

${caseFunctions.join("\n\n")}

${groupFunctions.join("\n\n")}

export function run() {
  if (typeof Reflect !== "object") return 3;
${driverBlocks.join("\n")}
  return 42;
}
`;

  return { workload, groups, totalCases: manifest.cases.length };
}

export function parseCanaryOutput(
  output: string,
  groups: Readonly<Record<string, Test262CanaryGroupSpec>>,
  steady: number,
): Record<string, KernelRunValues> {
  const iterations: Record<string, number[]> = {};
  for (const match of output.matchAll(
    new RegExp(
      `^${TEST262_CANARY_MARKER} ([\\w-]+) (\\d+) ([0-9.eE+-]+) (\\d+)\\r?$`,
      "gm",
    ),
  )) {
    const group = match[1]!;
    const spec = groups[group];
    const elapsed = Number(match[3]);
    assert.ok(
      spec !== undefined &&
        Number(match[4]) === spec.expectedExecutions &&
        Number.isFinite(elapsed) &&
        elapsed >= 0,
      "invalid canary line: " + match[0],
    );
    const list = (iterations[group] ??= []);
    assert.equal(Number(match[2]), list.length, "iteration order " + match[0]);
    list.push(elapsed);
  }
  assert.deepEqual(
    Object.keys(iterations).sort(),
    Object.keys(groups).sort(),
    output.slice(-4000),
  );
  return Object.fromEntries(
    Object.entries(iterations).map(([group, list]) => {
      assert.equal(list.length, steady + 1, "iterations of " + group);
      const warm = list.slice(1);
      return [group, { cold: list[0]!, steady: median(warm), warm }];
    }),
  );
}

function execute(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, TZ: "UTC" },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

function fileHash(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function prepareTest262Canary(options: {
  readonly node: string;
  readonly test262Dir?: string | undefined;
  readonly iterations?: number | undefined;
  readonly steady?: number | undefined;
  readonly quick?: boolean | undefined;
  readonly allowMissing?: boolean | undefined;
}): PreparedTest262Canary | SkippedTest262Canary {
  const resolvedDir = resolveTest262Directory(options.test262Dir);
  if (resolvedDir === undefined) {
    if (options.allowMissing) {
      return {
        kind: "tint-test262-canary-skipped",
        version: 1,
        reason: "test262-checkout-not-found",
      };
    }
    throw new Error(
      "Test262 checkout not found (pass --test262 DIR, set TINT_TEST262_DIR, or pass --allow-missing)",
    );
  }

  const manifest = loadCanaryManifest();
  const quick = options.quick ?? false;
  const iterations =
    options.iterations ??
    (quick ? manifest.quickIterations : manifest.defaultIterations);
  const steady = options.steady ?? (quick ? 2 : 5);

  const node = resolve(options.node);
  const nodeVersion = execute(node, ["--version"]).trim();
  const { workload, groups, totalCases } = synthesizeCanaryWorkload(
    resolvedDir,
    manifest,
    iterations,
    steady,
  );

  const work = mkdtempSync(join(tmpdir(), "tint-test262-canary-"));
  const script = join(work, "test262-canary.mjs");
  writeFileSync(
    script,
    "const now = () => performance.now();\n" +
      "const report = (line) => console.log(line);\n" +
      workload +
      "\nconst status = run();\nif (status !== 42) process.exitCode = status;\n",
  );

  // Verify every single Test262 test passes on Node before building native.
  const nodeOut = execute(node, [script]);
  parseCanaryOutput(nodeOut, groups, steady);

  const savedTz = process.env.TZ;
  const savedBuildOnly = process.env.TINT_BUILD_ONLY;
  const savedFallback = process.env.TINT_GENERAL_FALLBACK;
  process.env.TZ = "UTC";
  process.env.TINT_BUILD_ONLY = "1";
  delete process.env.TINT_GENERAL_FALLBACK;

  let path: string;
  try {
    path = verifyHostedFixture(
      'import { monotonicMilliseconds as now } from "clock";\n' +
        "const report = (line: string) => console.log(line);\n" +
        workload,
      "test262-canary",
      [["clock", clock]],
      [],
      [],
      [{ module: clock, namespace: "test262-canary-clock" }],
      {
        runtimeEntry: "initializeGenerationalRuntime",
        hostBindings: [
          {
            module: clock,
            name: "monotonicMilliseconds",
            operation: "monotonic-time",
          },
        ],
        managedBytes: 268435456,
        allocationCapacity: 8388608,
        rootCapacity: 65536,
        stackBytes: 8388608,
      },
    );
  } finally {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
    if (savedBuildOnly === undefined) delete process.env.TINT_BUILD_ONLY;
    else process.env.TINT_BUILD_ONLY = savedBuildOnly;
    if (savedFallback === undefined) delete process.env.TINT_GENERAL_FALLBACK;
    else process.env.TINT_GENERAL_FALLBACK = savedFallback;
  }

  const rev = spawnSync("git", ["-C", resolvedDir, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  return {
    kind: "tint-test262-canary-prepared",
    version: 1,
    test262Dir: resolvedDir,
    test262Revision: rev.status === 0 ? rev.stdout.trim() : undefined,
    head: execute("git", ["rev-parse", "HEAD"]).trim(),
    platform: process.platform + "-" + process.arch,
    node,
    nodeVersion,
    nodeSha256: fileHash(node),
    script,
    scriptSha256: fileHash(script),
    native: nativeArtifact(
      nativeFixtureTarget().name,
      path,
      path + ".manifest.json",
    ),
    steady,
    iterations,
    totalCases,
    groups,
  };
}

export function measureTest262Canary(
  prepared: PreparedTest262Canary,
  rounds: number,
): Test262CanaryReport {
  assert.ok(Number.isInteger(rounds) && rounds >= 1);
  const nodeRuns: Record<string, KernelRunValues>[] = [];
  const tintRuns: Record<string, KernelRunValues>[] = [];

  for (let round = 0; round < rounds; round++) {
    const order: readonly ("node" | "tint")[] =
      round % 2 === 0 ? ["node", "tint"] : ["tint", "node"];
    for (const engine of order) {
      const output =
        engine === "node"
          ? execute(prepared.node, [prepared.script])
          : runNativeImage(prepared.native);
      const parsed = parseCanaryOutput(
        output,
        prepared.groups,
        prepared.steady,
      );
      if (engine === "node") nodeRuns.push(parsed);
      else tintRuns.push(parsed);
    }
    console.error(`[test262-canary] completed round ${round + 1}/${rounds}`);
  }

  const summary: Record<string, Test262CanaryGroupSummary> = {};
  const ratios: number[] = [];
  let totalExecutions = 0;
  let totalNodeMs = 0;
  let totalTintMs = 0;

  for (const [group, spec] of Object.entries(prepared.groups)) {
    const nodeSteady = distribution(nodeRuns.map((r) => r[group]!.steady));
    const tintSteady = distribution(tintRuns.map((r) => r[group]!.steady));
    const ratioDist = distribution(
      tintRuns.map((r, i) => {
        const n = nodeRuns[i]![group]!.steady;
        return n > 0 ? r[group]!.steady / n : 1;
      }),
    );
    ratios.push(ratioDist.median);
    totalExecutions += spec.expectedExecutions;
    totalNodeMs += nodeSteady.median;
    totalTintMs += tintSteady.median;
    summary[group] = {
      caseCount: spec.caseCount,
      iterations: spec.iterations,
      expectedExecutions: spec.expectedExecutions,
      nodeSteadyMs: nodeSteady,
      tintSteadyMs: tintSteady,
      steadyOverNode: ratioDist,
      nodeCasesPerSec:
        nodeSteady.median > 0
          ? (spec.expectedExecutions * 1000) / nodeSteady.median
          : 0,
      tintCasesPerSec:
        tintSteady.median > 0
          ? (spec.expectedExecutions * 1000) / tintSteady.median
          : 0,
    };
  }

  return {
    kind: "tint-test262-canary-report",
    version: 1,
    prepared,
    cpu: cpus()[0]?.model,
    rounds,
    summary,
    overallGeomeanOverNode: geometricMean(ratios),
    totalNodeCasesPerSec:
      totalNodeMs > 0 ? (totalExecutions * 1000) / totalNodeMs : 0,
    totalTintCasesPerSec:
      totalTintMs > 0 ? (totalExecutions * 1000) / totalTintMs : 0,
  };
}

export function formatCanaryTable(report: Test262CanaryReport): string {
  const lines = [
    "| Test262 Group | Cases | Node ms | Tint ms | Tint / Node | Tint cases/s |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const [group, row] of Object.entries(report.summary)) {
    lines.push(
      `| ${group} | ${row.caseCount} | ${row.nodeSteadyMs.median.toFixed(2)} | ${row.tintSteadyMs.median.toFixed(2)} | ${row.steadyOverNode.median.toFixed(2)}× | ${Math.round(row.tintCasesPerSec).toLocaleString("en-US")} |`,
    );
  }
  lines.push(
    `| **Overall (${report.prepared.totalCases} tests)** | **${report.prepared.totalCases}** | - | - | **${report.overallGeomeanOverNode.toFixed(2)}×** | **${Math.round(report.totalTintCasesPerSec).toLocaleString("en-US")}** |`,
  );
  return lines.join("\n");
}

function main(): void {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "prepare" && rest.length >= 2) {
    const [node, output, ...options] = rest;
    const valueOf = (flag: string): string | undefined => {
      const at = options.indexOf(flag);
      return at < 0 ? undefined : options[at + 1];
    };
    const quick = options.includes("--quick");
    const allowMissing = options.includes("--allow-missing");
    const prepared = prepareTest262Canary({
      node: node!,
      test262Dir: valueOf("--test262"),
      iterations: valueOf("--iterations")
        ? Number(valueOf("--iterations"))
        : undefined,
      steady: valueOf("--steady") ? Number(valueOf("--steady")) : undefined,
      quick,
      allowMissing,
    });
    writeFileSync(output!, JSON.stringify(prepared, null, 2) + "\n", {
      flag: "wx",
    });
    if (prepared.kind === "tint-test262-canary-skipped") {
      console.error(`Skipped Test262 canary (${prepared.reason}) -> ${output}`);
    } else {
      console.error(
        `Prepared Test262 canary (${prepared.totalCases} tests across ${Object.keys(prepared.groups).length} groups) -> ${output}`,
      );
    }
    return;
  }
  if (mode === "smoke" && rest.length === 1) {
    const parsed = JSON.parse(readFileSync(rest[0]!, "utf8")) as
      PreparedTest262Canary | SkippedTest262Canary;
    if (parsed.kind === "tint-test262-canary-skipped") {
      console.log(`Test262 canary skipped: ${parsed.reason}`);
      return;
    }
    const report = measureTest262Canary(parsed, 1);
    console.log(formatCanaryTable(report));
    return;
  }
  if (mode === "measure" && rest.length >= 2) {
    const [input, output, roundsArg] = rest;
    const parsed = JSON.parse(readFileSync(input!, "utf8")) as
      PreparedTest262Canary | SkippedTest262Canary;
    if (parsed.kind === "tint-test262-canary-skipped") {
      writeFileSync(output!, JSON.stringify(parsed, null, 2) + "\n", {
        flag: "wx",
      });
      console.log(`Test262 canary skipped: ${parsed.reason}`);
      return;
    }
    const report = measureTest262Canary(parsed, Number(roundsArg ?? "3"));
    writeFileSync(output!, JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
    });
    console.log(formatCanaryTable(report));
    return;
  }
  throw Error(`Usage:
  node tools/language-bench/test262-canary.ts prepare NODE PREPARED.json [--test262 DIR] [--iterations N] [--steady N] [--quick] [--allow-missing]
  tools/gate/with-lock.sh launch test262-canary-smoke node tools/language-bench/test262-canary.ts smoke PREPARED.json
  tools/gate/with-lock.sh both test262-canary node tools/language-bench/test262-canary.ts measure PREPARED.json REPORT.json [ROUNDS]`);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
