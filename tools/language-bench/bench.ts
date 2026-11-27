// Comprehensive language syntax, feature, and builtin benchmark runner.
// Supports four suite modes over the kernels in registry.ts:
//   - typed:   kernels-typed.ts compiled with TINT_GENERAL_FALLBACK=0 (zero fallback)
//   - untyped: kernels-typed.ts stripped to plain JS + realm guard (untyped twin)
//   - general: kernels-general.ts (realm/stdlib/OOP/syntax constructs)
//   - async:   kernels-async.ts (Promise & async/await microtask throughput)
//
// Usage:
//   node tools/language-bench/bench.ts check-node [--quick] [KERNEL ...]
//   node tools/language-bench/bench.ts prepare NODE PREPARED.json \
//     [--suite typed|untyped|general|async] [--steady N] [--quick] [KERNEL ...]
//   tools/gate/with-lock.sh launch lang-bench-smoke \
//     node tools/language-bench/bench.ts smoke PREPARED.json
//   tools/gate/with-lock.sh both lang-bench \
//     node tools/language-bench/bench.ts measure PREPARED.json REPORT.json [ROUNDS]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { cpus, loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { imageText } from "../disasm/annotate.ts";
import { verifyHostedFixture } from "../hosted-fixture.ts";
import { nativeFixtureTarget } from "../native-host-target.ts";
import { nativeArtifact } from "../native-target-runner.ts";
import { writeNodeExecutable } from "../node-file-host.ts";
import { executionPlan } from "../test262-execution.ts";
import {
  benchmarkScriptHost,
  createNativeBatchBuilder,
  deferNativeCase,
  prepareNativeScripts,
} from "../test262-native.ts";
import {
  sharedBufferFixtureRuntimes,
  sharedBufferHostBindings,
} from "../worker-fixture-options.ts";
import {
  workspaceSourceIdentity,
  workspaceSources,
} from "../workspace-sources.ts";
import {
  LANGUAGE_KERNELS,
  kernelByName,
  kernelsBySuite,
  type KernelSpec,
  type LanguageCategory,
} from "./registry.ts";

export type LanguageBenchSuiteMode = "typed" | "untyped" | "general" | "async";

const clock = "packages/native-runtime/src/intrinsics/clock.ts";
export const LANG_BENCH_MARKER = "TINT_LANG_BENCH";
const lldb = process.env.TINT_LLDB ?? "lldb";

export type NativeArtifactRecord = ReturnType<typeof nativeArtifact>;

export interface PreparedKernelEntry {
  readonly scale: number;
  readonly checksum: number;
  readonly category: LanguageCategory;
  readonly typedStatus: "native" | "fallback";
}

export interface PreparedLanguageBench {
  readonly kind: "tint-language-bench-prepared";
  readonly version: 1;
  readonly suite: LanguageBenchSuiteMode;
  readonly typed: boolean;
  readonly fellBack: boolean;
  readonly head: string;
  readonly patchSha256: string;
  readonly platform: string;
  readonly node: string;
  readonly nodeVersion: string;
  readonly nodeSha256: string;
  readonly script: string;
  readonly scriptSha256: string;
  readonly native: NativeArtifactRecord;
  readonly nativeArgs: readonly string[];
  readonly debugSymbols: boolean;
  readonly steady: number;
  readonly quick: boolean;
  readonly kernels: Record<string, PreparedKernelEntry>;
}

export interface KernelRunValues {
  readonly cold: number;
  readonly steady: number;
  readonly warm: readonly number[];
}

export interface Distribution {
  readonly median: number;
  readonly q1: number;
  readonly q3: number;
}

export interface KernelSummaryRow {
  readonly category: LanguageCategory;
  readonly typedStatus: "native" | "fallback";
  readonly scale: number;
  readonly checksum: number;
  readonly nodeSteadyMs: Distribution;
  readonly tintSteadyMs: Distribution;
  readonly nodeColdMs: Distribution;
  readonly tintColdMs: Distribution;
  readonly steadyOverNode: Distribution;
  readonly coldOverNode: Distribution;
}

export interface LanguageBenchReport {
  readonly kind: "tint-language-bench-report";
  readonly version: 1;
  readonly suite: LanguageBenchSuiteMode;
  readonly prepared: PreparedLanguageBench;
  readonly cpu: string | undefined;
  readonly cpuCount: number;
  readonly rounds: number;
  readonly summary: Record<string, KernelSummaryRow>;
  readonly samples: readonly {
    readonly round: number;
    readonly engine: "node" | "tint";
    readonly position: number;
    readonly values: Record<string, KernelRunValues>;
    readonly wallMs: number;
    readonly loadBefore: readonly number[];
    readonly loadAfter: readonly number[];
    readonly idlePercent: number | null;
  }[];
}

export function resolveDefaultNode(): string {
  const envNode = process.env.TINT_BENCH_NODE ?? process.env.NODE26;
  if (envNode && existsSync(envNode)) return resolve(envNode);
  if (existsSync("/opt/homebrew/bin/node")) return "/opt/homebrew/bin/node";
  return process.execPath;
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

function hash(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fileHash(file: string): string {
  return hash(readFileSync(file));
}

export function distribution(values: readonly number[]): Distribution {
  assert.ok(values.length > 0, "distribution requires at least one value");
  const sorted = values.slice().sort((left, right) => left - right);
  function quantile(p: number): number {
    const index = (sorted.length - 1) * p;
    const lower = sorted[Math.floor(index)]!;
    return lower + (sorted[Math.ceil(index)]! - lower) * (index % 1);
  }
  return { median: quantile(0.5), q1: quantile(0.25), q3: quantile(0.75) };
}

export function median(values: readonly number[]): number {
  return distribution(values).median;
}

export function geometricMean(ratios: readonly number[]): number {
  const valid = ratios.filter((r) => Number.isFinite(r) && r > 0);
  if (valid.length === 0) return Number.NaN;
  const logSum = valid.reduce((sum, r) => sum + Math.log(r), 0);
  return Math.exp(logSum / valid.length);
}

function suiteSourceFile(suite: LanguageBenchSuiteMode): string {
  if (suite === "typed" || suite === "untyped") return "kernels-typed.ts";
  if (suite === "general") return "kernels-general.ts";
  return "kernels-async.ts";
}

export function selectSuiteKernels(
  suite: LanguageBenchSuiteMode,
  selected: readonly string[],
): readonly KernelSpec[] {
  const baseSuite = suite === "untyped" ? "typed" : suite;
  const pool = kernelsBySuite(baseSuite);
  if (selected.length === 0) {
    if (suite === "typed") return pool;
    return pool.filter((k) => k.requiresScriptHostInGeneral !== true);
  }
  const poolNames = new Set(pool.map((k) => k.name));
  for (const name of selected) {
    assert.ok(
      poolNames.has(name),
      `kernel "${name}" is not in language-bench suite "${suite}"`,
    );
  }
  return pool.filter((k) => selected.includes(k.name));
}

function buildSyncDriver(
  names: readonly string[],
  table: Record<string, PreparedKernelEntry>,
  steady: number,
  reportFn: string,
  exported: boolean,
  forceRealmGuard: boolean,
): string {
  const guard = forceRealmGuard
    ? '  if (typeof Reflect !== "object") return 3;\n'
    : "";
  const blocks = names.map(
    (
      name,
      index,
    ) => `  for (let iteration = 0; iteration <= ${steady}; iteration++) {
    const started = now();
    const sum = ${name}(${table[name]!.scale});
    const elapsed = now() - started;
    if (sum !== ${table[name]!.checksum}) return ${10 + index};
    ${reportFn}("${LANG_BENCH_MARKER} ${name} " + String(iteration) + " " + String(elapsed) + " " + String(sum));
  }`,
  );
  return `
${exported ? "export " : ""}function run(): number {
${guard}${blocks.join("\n")}
  return 42;
}
`;
}

function buildAsyncDriver(
  names: readonly string[],
  table: Record<string, PreparedKernelEntry>,
  steady: number,
  reportFn: string,
  exported: boolean,
  forceRealmGuard: boolean,
): string {
  const guard = forceRealmGuard
    ? '  if (typeof Reflect !== "object") return 3;\n'
    : "";
  const steps = names.map(
    (
      name,
    ) => `    for (let iteration = 0; iteration <= ${steady}; iteration++) {
      const started = now();
      const sum = await ${name}(${table[name]!.scale});
      const elapsed = now() - started;
      if (sum !== ${table[name]!.checksum}) throw new Error("checksum mismatch for ${name}: " + String(sum));
      ${reportFn}("${LANG_BENCH_MARKER} ${name} " + String(iteration) + " " + String(elapsed) + " " + String(sum));
    }`,
  );
  return `
async function runAll(): Promise<void> {
${steps.join("\n")}
}
${exported ? "export " : ""}function run(): number {
${guard}  runAll().then(
    () => {
      ${reportFn}("${LANG_BENCH_MARKER}_DONE 42");
    },
    (err) => {
      ${reportFn}("${LANG_BENCH_MARKER}_ERROR " + String(err));
      throw err;
    },
  );
  return 42;
}
`;
}

function buildGeneralScriptImage(
  suite: LanguageBenchSuiteMode,
  scriptText: string,
  workDir: string,
): NativeArtifactRecord {
  const plan = executionPlan(scriptText, "raw", {
    flags: ["raw"],
    features: [],
    includes: [],
  });
  const preparedScripts = prepareNativeScripts(
    plan,
    "raw",
    [],
    benchmarkScriptHost,
  );
  if (!preparedScripts.ok) {
    assert.fail(
      `prepareNativeScripts(${suite}): ${JSON.stringify(preparedScripts.outcome)}`,
    );
  }
  const scripts = preparedScripts.modules.map((mod, index) => ({
    ...mod,
    id: `language-bench-${suite}-${index}`,
  }));
  const snapshot = workspaceSources();
  const built = createNativeBatchBuilder(
    snapshot,
    false,
    undefined,
    true,
  )([deferNativeCase({ scripts, asynchronous: false })]);
  if (!built.ok) {
    assert.fail(
      `createNativeBatchBuilder(${suite}): ${JSON.stringify(built.outcome)}`,
    );
  }
  const imagePath = join(workDir, `language-bench-${suite}`);
  writeNodeExecutable(imagePath, built.bytes, true);
  const manifestPath = imagePath + ".manifest.json";
  const target = nativeFixtureTarget().name;
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        kind: "tint-language-bench-script-build",
        suite,
        target,
        debugSymbols: process.env.TINT_DEBUG_SYMBOLS === "1",
        sourceSnapshot: workspaceSourceIdentity(snapshot),
        imageSha256: hash(built.bytes),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  return nativeArtifact(target, imagePath, manifestPath);
}

export async function prepareLanguageBench(options: {
  readonly node: string;
  readonly suite: LanguageBenchSuiteMode;
  readonly selected?: readonly string[];
  readonly steady?: number;
  readonly quick?: boolean;
}): Promise<PreparedLanguageBench> {
  const node = resolve(options.node);
  const nodeVersion = execute(node, ["--version"]).trim();
  const steady = options.steady ?? 5;
  const quick = options.quick ?? false;
  assert.ok(Number.isSafeInteger(steady) && steady >= 1, "steady must be >= 1");

  const specs = selectSuiteKernels(options.suite, options.selected ?? []);
  assert.ok(specs.length > 0, "no kernels selected for " + options.suite);

  const file = suiteSourceFile(options.suite);
  const url = new URL("./" + file, import.meta.url);
  const operations = (await import(url.href)) as Record<
    string,
    (scale: number) => number | Promise<number>
  >;

  const table: Record<string, PreparedKernelEntry> = {};
  for (const spec of specs) {
    const operation = operations[spec.name];
    assert.ok(operation !== undefined, "missing kernel export " + spec.name);
    const scale = quick ? spec.quickScale : spec.scale;
    const checksum = await operation(scale);
    assert.ok(
      Number.isSafeInteger(checksum),
      `kernel ${spec.name} returned non-integer checksum: ${String(checksum)}`,
    );
    table[spec.name] = {
      scale,
      checksum,
      category: spec.category,
      typedStatus: spec.typedStatus,
    };
  }

  const names = specs.map((s) => s.name);
  const baseText = readFileSync(url, "utf8");
  const isAsync = options.suite === "async";
  const isTyped = options.suite === "typed";
  const useScriptHost =
    !isTyped && specs.some((s) => s.requiresScriptHostInGeneral === true);
  const forceRealmGuard =
    !useScriptHost && (options.suite === "untyped" || isAsync);

  const reportFn = useScriptHost ? "report" : "console.log";
  const exported = !useScriptHost;
  const driverText = isAsync
    ? buildAsyncDriver(
        names,
        table,
        steady,
        reportFn,
        exported,
        forceRealmGuard,
      )
    : buildSyncDriver(
        names,
        table,
        steady,
        reportFn,
        exported,
        forceRealmGuard,
      );

  const fullTypedSource = baseText + driverText;
  const strippedModuleSource = stripTypeScriptTypes(fullTypedSource);
  const strippedScriptSource = strippedModuleSource.replace(
    /^export\s+(?=(?:async\s+)?function\b)/gm,
    "",
  );

  const work = mkdtempSync(join(tmpdir(), `tint-lang-bench-${options.suite}-`));
  const script = join(work, `language-bench-${options.suite}.mjs`);
  writeFileSync(
    script,
    "const now = () => performance.now();\n" +
      "const report = (line) => console.log(line);\n" +
      strippedScriptSource +
      "\nconst status = run();\nif (status !== 42) process.exitCode = status;\n",
  );

  // Verify the stripped Node script produces valid output before building native.
  const nodeCheckOutput = execute(node, [script]);
  parseBenchmarkOutput(nodeCheckOutput, table, steady, isAsync);

  const savedTz = process.env.TZ;
  const savedBuildOnly = process.env.TINT_BUILD_ONLY;
  const savedFallback = process.env.TINT_GENERAL_FALLBACK;
  process.env.TZ = "UTC";
  process.env.TINT_BUILD_ONLY = "1";
  if (isTyped) process.env.TINT_GENERAL_FALLBACK = "0";
  else delete process.env.TINT_GENERAL_FALLBACK;

  let fellBack = false;
  let native: NativeArtifactRecord;
  let nativeArgs: readonly string[];
  try {
    if (useScriptHost) {
      fellBack = true;
      const scriptBody =
        '"use strict";\n' +
        "const now = tintBenchmarkNow;\n" +
        "const report = tintBenchmarkReport;\n" +
        strippedScriptSource +
        "\nconst __status = run();\nif (__status !== 42) throw new Error('benchmark status ' + String(__status));\n";
      native = buildGeneralScriptImage(options.suite, scriptBody, work);
      nativeArgs = ["0"];
    } else {
      const needsSharedBuffer =
        isTyped && specs.some((spec) => spec.needsSharedBuffer === true);
      const additionalRuntimes = needsSharedBuffer
        ? sharedBufferFixtureRuntimes
        : [{ module: clock, namespace: "language-bench-clock" }];
      const hostBindings = needsSharedBuffer
        ? sharedBufferHostBindings
        : [
            {
              module: clock,
              name: "monotonicMilliseconds",
              operation: "monotonic-time" as const,
            },
          ];
      const tintBody =
        options.suite === "untyped" ? strippedModuleSource : fullTypedSource;
      const path = verifyHostedFixture(
        'import { monotonicMilliseconds as now } from "clock";\n' + tintBody,
        "language-bench-" + options.suite,
        [["clock", clock]],
        [],
        [],
        additionalRuntimes,
        {
          requireTyped: isTyped,
          runtimeEntry: "initializeGenerationalRuntime",
          onGeneralFallback: () => {
            fellBack = true;
          },
          hostBindings,
          managedBytes: 268435456,
          allocationCapacity: 8388608,
          rootCapacity: 65536,
          stackBytes: 8388608,
        },
      );
      assert.equal(
        fellBack,
        !isTyped,
        `unexpected fallback state for suite "${options.suite}": fellBack=${String(fellBack)}`,
      );
      native = nativeArtifact(
        nativeFixtureTarget().name,
        path,
        path + ".manifest.json",
      );
      nativeArgs = [];
    }
  } finally {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
    if (savedBuildOnly === undefined) delete process.env.TINT_BUILD_ONLY;
    else process.env.TINT_BUILD_ONLY = savedBuildOnly;
    if (savedFallback === undefined) delete process.env.TINT_GENERAL_FALLBACK;
    else process.env.TINT_GENERAL_FALLBACK = savedFallback;
  }

  return {
    kind: "tint-language-bench-prepared",
    version: 1,
    suite: options.suite,
    typed: isTyped,
    fellBack,
    head: execute("git", ["rev-parse", "HEAD"]).trim(),
    patchSha256: hash(
      execute("git", ["diff", "--binary", "HEAD", "--", "packages", "tools"]),
    ),
    platform: process.platform + "-" + process.arch,
    node,
    nodeVersion,
    nodeSha256: fileHash(node),
    script,
    scriptSha256: fileHash(script),
    native,
    nativeArgs,
    debugSymbols: imageText(readFileSync(native.path)).dwarf,
    steady,
    quick,
    kernels: table,
  };
}

export function runNativeImage(
  artifact: NativeArtifactRecord,
  args: readonly string[] = [],
): string {
  const output = execute(lldb, [
    "--no-lldbinit",
    "--batch",
    "-o",
    "settings set target.disable-aslr false",
    "-o",
    "process launch --stop-at-entry",
    "-o",
    "script assert lldb.process.GetState() == lldb.eStateStopped",
    "-o",
    "continue",
    "-o",
    "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42; print('TINT_BENCH_VERIFIED')",
    "--",
    artifact.path,
    ...args,
  ]);
  assert.match(output, /^TINT_BENCH_VERIFIED$/m, output.slice(-4000));
  return output;
}

export function parseBenchmarkOutput(
  output: string,
  kernels: Readonly<Record<string, { readonly checksum: number }>>,
  steady: number,
  isAsync = false,
): Record<string, KernelRunValues> {
  if (isAsync) {
    assert.doesNotMatch(
      output,
      new RegExp(`^${LANG_BENCH_MARKER}_ERROR `, "m"),
      output.slice(-4000),
    );
    assert.match(
      output,
      new RegExp(`^${LANG_BENCH_MARKER}_DONE 42\\r?$`, "m"),
      output.slice(-4000),
    );
  }
  const iterations: Record<string, number[]> = {};
  for (const match of output.matchAll(
    new RegExp(
      `^${LANG_BENCH_MARKER} (\\w+) (\\d+) ([0-9.eE+-]+) (-?\\d+)\\r?$`,
      "gm",
    ),
  )) {
    const name = match[1]!;
    const expected = kernels[name];
    const elapsed = Number(match[3]);
    assert.ok(
      expected !== undefined &&
        Number(match[4]) === expected.checksum &&
        Number.isFinite(elapsed) &&
        elapsed >= 0,
      "invalid benchmark line: " + match[0],
    );
    const list = (iterations[name] ??= []);
    assert.equal(Number(match[2]), list.length, "iteration order " + match[0]);
    list.push(elapsed);
  }
  assert.deepEqual(
    Object.keys(iterations).sort(),
    Object.keys(kernels).sort(),
    output.slice(-4000),
  );
  return Object.fromEntries(
    Object.entries(iterations).map(([name, list]) => {
      assert.equal(list.length, steady + 1, "iterations of " + name);
      const warm = list.slice(1);
      return [name, { cold: list[0]!, steady: median(warm), warm }];
    }),
  );
}

function cpuTimes() {
  let idle = 0,
    total = 0;
  for (const { times } of cpus()) {
    idle += times.idle;
    total += times.idle + times.user + times.nice + times.sys + times.irq;
  }
  return { idle, total };
}

export function checkPrepared(prepared: PreparedLanguageBench): void {
  assert.equal(prepared.platform, process.platform + "-" + process.arch);
  assert.equal(fileHash(prepared.node), prepared.nodeSha256);
  assert.equal(fileHash(prepared.script), prepared.scriptSha256);
  assert.equal(fileHash(prepared.native.path), prepared.native.imageSha256);
  const manifest = prepared.native.buildManifest;
  assert.ok(manifest !== undefined);
  assert.equal(fileHash(manifest.path), manifest.sha256);
}

export function measureLanguageBench(
  prepared: PreparedLanguageBench,
  rounds: number,
): LanguageBenchReport {
  checkPrepared(prepared);
  assert.ok(Number.isInteger(rounds) && rounds >= 1, "rounds must be >= 1");
  const engines: readonly ("node" | "tint")[] = ["node", "tint"];
  const isAsync = prepared.suite === "async";
  const samples: {
    round: number;
    engine: "node" | "tint";
    position: number;
    values: Record<string, KernelRunValues>;
    wallMs: number;
    loadBefore: number[];
    loadAfter: number[];
    idlePercent: number | null;
  }[] = [];

  for (let round = 0; round < rounds; round++) {
    const order: ("node" | "tint")[] =
      round % 2 === 0 ? [engines[0]!, engines[1]!] : [engines[1]!, engines[0]!];
    for (const [position, engine] of order.entries()) {
      const before = cpuTimes();
      const loadBefore = loadavg();
      const started = performance.now();
      const output =
        engine === "node"
          ? execute(prepared.node, [prepared.script])
          : runNativeImage(prepared.native, prepared.nativeArgs);
      const wallMs = performance.now() - started;
      const after = cpuTimes();
      const total = after.total - before.total;
      samples.push({
        round,
        engine,
        position,
        values: parseBenchmarkOutput(
          output,
          prepared.kernels,
          prepared.steady,
          isAsync,
        ),
        wallMs,
        loadBefore,
        loadAfter: loadavg(),
        idlePercent:
          total === 0 ? null : (100 * (after.idle - before.idle)) / total,
      });
    }
    console.error(
      `[language-bench:${prepared.suite}] completed round ${round + 1}/${rounds}`,
    );
  }

  const nodeRows = samples
    .filter((s) => s.engine === "node")
    .sort((a, b) => a.round - b.round);
  const tintRows = samples
    .filter((s) => s.engine === "tint")
    .sort((a, b) => a.round - b.round);

  const summary: Record<string, KernelSummaryRow> = {};
  for (const [name, meta] of Object.entries(prepared.kernels)) {
    const safeRatio = (t: number, n: number) =>
      n > 0 ? t / n : t === 0 ? 1 : Infinity;
    summary[name] = {
      category: meta.category,
      typedStatus: meta.typedStatus,
      scale: meta.scale,
      checksum: meta.checksum,
      nodeSteadyMs: distribution(nodeRows.map((r) => r.values[name]!.steady)),
      tintSteadyMs: distribution(tintRows.map((r) => r.values[name]!.steady)),
      nodeColdMs: distribution(nodeRows.map((r) => r.values[name]!.cold)),
      tintColdMs: distribution(tintRows.map((r) => r.values[name]!.cold)),
      steadyOverNode: distribution(
        tintRows.map((r, i) =>
          safeRatio(r.values[name]!.steady, nodeRows[i]!.values[name]!.steady),
        ),
      ),
      coldOverNode: distribution(
        tintRows.map((r, i) =>
          safeRatio(r.values[name]!.cold, nodeRows[i]!.values[name]!.cold),
        ),
      ),
    };
  }

  return {
    kind: "tint-language-bench-report",
    version: 1,
    suite: prepared.suite,
    prepared,
    cpu: cpus()[0]?.model,
    cpuCount: cpus().length,
    rounds,
    summary,
    samples,
  };
}

export function formatSummaryTable(report: LanguageBenchReport): string {
  const lines: string[] = [
    "| Kernel | Category | Node ms | Tint ms | Tint / Node |",
    "| --- | --- | ---: | ---: | ---: |",
  ];
  const ratios: number[] = [];
  for (const [name, row] of Object.entries(report.summary)) {
    ratios.push(row.steadyOverNode.median);
    lines.push(
      `| ${name} | ${row.category} | ${row.nodeSteadyMs.median.toFixed(2)} | ${row.tintSteadyMs.median.toFixed(2)} | ${row.steadyOverNode.median.toFixed(2)}× |`,
    );
  }
  const geo = geometricMean(ratios);
  lines.push(
    `| **Geomean (${ratios.length} kernels)** | **${report.suite}** | - | - | **${geo.toFixed(2)}×** |`,
  );
  return lines.join("\n");
}

function writeJsonExclusive(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
}

async function checkNodeCalibration(
  quick: boolean,
  selected: readonly string[],
): Promise<void> {
  const specs =
    selected.length === 0
      ? LANGUAGE_KERNELS
      : selected.map((name) => {
          const spec = kernelByName(name);
          assert.ok(spec !== undefined, "unknown kernel: " + name);
          return spec;
        });

  const typedOps = (await import("./kernels-typed.ts")) as Record<
    string,
    (scale: number) => number
  >;
  const generalOps = (await import("./kernels-general.ts")) as Record<
    string,
    (scale: number) => number
  >;
  const asyncOps = (await import("./kernels-async.ts")) as Record<
    string,
    (scale: number) => Promise<number>
  >;

  console.log(
    "kernel".padEnd(28) +
      "suite".padEnd(9) +
      "scale".padStart(8) +
      "cold ms".padStart(10) +
      "warm ms".padStart(10) +
      "checksum".padStart(14),
  );
  for (const spec of specs) {
    const scale = quick ? spec.quickScale : spec.scale;
    const fn =
      spec.suite === "typed"
        ? typedOps[spec.name]
        : spec.suite === "general"
          ? generalOps[spec.name]
          : asyncOps[spec.name];
    assert.ok(fn !== undefined, "missing export for " + spec.name);
    const t0 = performance.now();
    const sum1 = await fn(scale);
    const coldMs = performance.now() - t0;
    const t1 = performance.now();
    const sum2 = await fn(scale);
    const warmMs = performance.now() - t1;
    assert.equal(sum1, sum2, "non-deterministic checksum for " + spec.name);
    console.log(
      spec.name.padEnd(28) +
        spec.suite.padEnd(9) +
        String(scale).padStart(8) +
        coldMs.toFixed(2).padStart(10) +
        warmMs.toFixed(2).padStart(10) +
        String(sum1).padStart(14),
    );
  }
}

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "check-node") {
    const quick = rest.includes("--quick");
    const selected = rest.filter((arg) => !arg.startsWith("--"));
    await checkNodeCalibration(quick, selected);
    return;
  }
  if (mode === "prepare" && rest.length >= 2) {
    const [node, output, ...options] = rest;
    const valueOf = (flag: string): string | undefined => {
      const at = options.indexOf(flag);
      return at < 0 ? undefined : options[at + 1];
    };
    const quick = options.includes("--quick");
    const suite = (valueOf("--suite") ?? "typed") as LanguageBenchSuiteMode;
    assert.ok(
      suite === "typed" ||
        suite === "untyped" ||
        suite === "general" ||
        suite === "async",
      "unknown suite: " + suite,
    );
    const steady = Number(valueOf("--steady") ?? (quick ? "3" : "5"));
    const selected = options.filter(
      (option, index) =>
        !option.startsWith("--") &&
        options[index - 1] !== "--suite" &&
        options[index - 1] !== "--steady",
    );
    const prepared = await prepareLanguageBench({
      node: node!,
      suite,
      selected,
      steady,
      quick,
    });
    writeJsonExclusive(output!, prepared);
    console.error(
      `Prepared ${suite} (${Object.keys(prepared.kernels).length} kernels, fellBack=${String(prepared.fellBack)}) -> ${output}`,
    );
    return;
  }
  if (mode === "smoke" && rest.length === 1) {
    const prepared = JSON.parse(
      readFileSync(rest[0]!, "utf8"),
    ) as PreparedLanguageBench;
    checkPrepared(prepared);
    const isAsync = prepared.suite === "async";
    const nodeVals = parseBenchmarkOutput(
      execute(prepared.node, [prepared.script]),
      prepared.kernels,
      prepared.steady,
      isAsync,
    );
    const tintVals = parseBenchmarkOutput(
      runNativeImage(prepared.native, prepared.nativeArgs),
      prepared.kernels,
      prepared.steady,
      isAsync,
    );
    console.log(
      "kernel".padEnd(26) +
        "node ms".padStart(10) +
        "tint ms".padStart(10) +
        "tint/node".padStart(11),
    );
    const ratios: number[] = [];
    for (const name of Object.keys(prepared.kernels)) {
      const n = nodeVals[name]!.steady;
      const t = tintVals[name]!.steady;
      const ratio = n > 0 ? t / n : 1;
      ratios.push(ratio);
      console.log(
        name.padEnd(26) +
          n.toFixed(2).padStart(10) +
          t.toFixed(2).padStart(10) +
          (ratio.toFixed(2) + "x").padStart(11),
      );
    }
    console.log(`geomean: ${geometricMean(ratios).toFixed(2)}x`);
    return;
  }
  if (mode === "measure" && rest.length >= 2) {
    const [input, output, roundsArg] = rest;
    const prepared = JSON.parse(
      readFileSync(input!, "utf8"),
    ) as PreparedLanguageBench;
    const rounds = Number(roundsArg ?? (prepared.quick ? "3" : "9"));
    const report = measureLanguageBench(prepared, rounds);
    writeJsonExclusive(output!, report);
    console.log(formatSummaryTable(report));
    return;
  }
  throw Error(`Usage:
  node tools/language-bench/bench.ts check-node [--quick] [KERNEL ...]
  node tools/language-bench/bench.ts prepare NODE PREPARED.json [--suite typed|untyped|general|async] [--steady N] [--quick] [KERNEL ...]
  tools/gate/with-lock.sh launch lang-bench-smoke node tools/language-bench/bench.ts smoke PREPARED.json
  tools/gate/with-lock.sh both lang-bench node tools/language-bench/bench.ts measure PREPARED.json REPORT.json [ROUNDS]`);
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
