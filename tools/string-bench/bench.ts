// String benchmark (docs/design-one-byte-strings.md), derived from PR #17's
// typed code-generation harness (tools/typed-bench/bench.ts on
// perf/typed-codegen at 1aa3c9c16); fold the two together once both land.
// The kernels in kernels.ts run as one typed native image (general fallback
// disabled) and as the same text under Node 26.13.1, timed in-process:
//   node tools/string-bench/bench.ts prepare NODE26 PREPARED.json [--suite typed|general] [--steady N] [KERNEL ...]
//   tools/gate/with-lock.sh launch string-bench-smoke \
//     node tools/string-bench/bench.ts smoke PREPARED.json
//   tools/gate/with-lock.sh both string-bench \
//     node tools/string-bench/bench.ts measure PREPARED.json REPORT.json [ROUNDS] [CANDIDATE.json ...]
//   node tools/string-bench/bench.ts v8-script KERNEL SCRIPT.mjs
// Every run executes each kernel once cold and then `steady` times warm; a
// run's steady value is the median of its warm iterations. Each round runs
// every engine once; round r starts at engine r mod n and odd rounds run in
// reverse. Native images run under LLDB, which must report the stop at entry
// and exit status 42. Candidates are further prepared images of the same
// kernels (A/B against the first). On Linux (the shared `dev` machine),
// prepare and measure run inside the machine with its Node 26 build and a
// TMPDIR under the worktree.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { cpus, loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { imageText } from "../disasm/annotate.ts";
import { verifyHostedFixture } from "../hosted-fixture.ts";
import { nativeFixtureTarget } from "../native-host-target.ts";
import { nativeArtifact } from "../native-target-runner.ts";

/** Suites, one image each, kernels in table order. Scales target 10-20 ms of
 * steady Node 26.13.1 time per iteration on an M5 Max, except where Tint
 * was 100x or more slower at the baseline (numberString, utf8, clone,
 * upperCase, json): those keep each Tint iteration under about 0.5 s.
 * `typed` compiles with the general fallback disabled; `general` holds the
 * operations typed code does not lower yet and measures the general
 * runtime. */
const suites: Record<
  string,
  { file: string; typed: boolean; scales: Record<string, number> }
> = {
  typed: {
    file: "kernels.ts",
    typed: true,
    scales: {
      create: 12000,
      concat: 24000,
      concatTwoByte: 24000,
      equality: 120000,
      search: 12000,
      searchTwoByte: 12000,
      codeUnits: 4000,
      codeUnitsTwoByte: 4000,
      splitJoin: 12000,
      slice: 12000,
      sliceTwoByte: 12000,
      numberString: 400,
      template: 12000,
      mapKeys: 400,
      utf8: 4000,
      utf8TwoByte: 4000,
      clone1KiB: 20000,
      clone1MiB: 20,
      // PR #17's kernels at its scales (tools/typed-bench at aab393287).
      strings: 6000,
      stringBuild: 20000,
    },
  },
  general: {
    file: "general.ts",
    typed: false,
    scales: { upperCase: 4000, json: 2000 },
  },
};
/** The kernels' codec import: Node imports codec.ts; Tint's image inlines
 * native-codec.ts in place of the import line. */
const codecImport = '"./codec.ts"';
const codec = fileURLToPath(new URL("./codec.ts", import.meta.url));
const nativeCodec = readFileSync(
  new URL("./native-codec.ts", import.meta.url),
  "utf8",
);
const textEncoding = "packages/foundation/src/text/text-encoding/index.ts";
const objects = "packages/js-runtime/src/objects/index.ts";
const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const marker = "TINT_STRING_BENCH";
const lldb = process.env.TINT_LLDB ?? "lldb";

type Artifact = ReturnType<typeof nativeArtifact>;
interface Prepared {
  readonly suite: string;
  readonly typed: boolean;
  readonly head: string;
  readonly patchSha256: string;
  readonly platform: string;
  readonly node: string;
  readonly nodeSha256: string;
  readonly script: string;
  readonly scriptSha256: string;
  readonly native: Artifact;
  readonly debugSymbols: boolean;
  readonly steady: number;
  readonly kernels: Record<string, { scale: number; checksum: number }>;
}
interface RunValues {
  readonly cold: number;
  readonly steady: number;
  readonly warm: readonly number[];
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

function writeReport(path: string, report: unknown): void {
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
}

function median(values: readonly number[]): number {
  return distribution(values).median;
}

function distribution(values: readonly number[]) {
  const sorted = values.slice().sort((left, right) => left - right);
  function quantile(p: number): number {
    const index = (sorted.length - 1) * p;
    const lower = sorted[Math.floor(index)]!;
    return lower + (sorted[Math.ceil(index)]! - lower) * (index % 1);
  }
  return { median: quantile(0.5), q1: quantile(0.25), q3: quantile(0.75) };
}

/** The driver appended to the kernel text: each kernel cold, then warm. */
function driver(
  names: readonly string[],
  table: Prepared["kernels"],
  steady: number,
): string {
  const blocks = names.map(
    (
      name,
      index,
    ) => `  for (let iteration = 0; iteration <= ${steady}; iteration++) {
    const started = now();
    const sum = ${name}(${table[name]!.scale});
    const elapsed = now() - started;
    if (sum !== ${table[name]!.checksum}) return ${10 + index};
    console.log("${marker} ${name} " + String(iteration) + " " + String(elapsed) + " " + String(sum));
  }`,
  );
  return `
export function run(): number {
${blocks.join("\n")}
  return 42;
}
`;
}

async function prepare(
  node: string,
  suiteName: string,
  selected: readonly string[],
  steady: number,
): Promise<Prepared> {
  node = resolve(node);
  assert.equal(execute(node, ["--version"]).trim(), "v26.13.1");
  assert.ok(Number.isSafeInteger(steady) && steady >= 1);
  const suite = suites[suiteName];
  assert.ok(suite !== undefined, "unknown suite " + suiteName);
  const scales = suite.scales;
  for (const name of selected)
    assert.ok(scales[name] !== undefined, "unknown kernel " + name);
  const names = Object.keys(scales).filter(
    (name) => selected.length === 0 || selected.includes(name),
  );
  const url = new URL("./" + suite.file, import.meta.url);
  const operations = (await import(url.href)) as Record<
    string,
    (scale: number) => number
  >;
  const table: Prepared["kernels"] = {};
  for (const name of names) {
    const operation = operations[name];
    assert.ok(operation, "missing kernel " + name);
    const scale = scales[name]!;
    table[name] = { scale, checksum: operation(scale) };
  }
  const source = readFileSync(url, "utf8");
  const codecImports = source.split(codecImport).length - 1;
  assert.ok(codecImports <= 1, "at most one codec import");
  const workload = source + driver(names, table, steady);
  const work = mkdtempSync(join(tmpdir(), "tint-string-bench-"));
  const script = join(work, "string-bench.mjs");
  writeFileSync(
    script,
    "const now = () => performance.now();\n" +
      stripTypeScriptTypes(workload).replace(
        codecImport,
        JSON.stringify(new URL("file://" + codec).href),
      ) +
      "\nconst status = run();\nif (status !== 42) process.exitCode = status;\n",
  );
  process.env.TZ = "UTC";
  process.env.TINT_BUILD_ONLY = "1";
  // Typed suites measure typed code only: no general fallback anywhere.
  if (suite.typed) process.env.TINT_GENERAL_FALLBACK = "0";
  else delete process.env.TINT_GENERAL_FALLBACK;
  // Replace the codec import statement (up to its specifier) with the shim.
  let nativeWorkload = workload;
  if (codecImports === 1) {
    const importStart = workload.indexOf("import {"),
      importEnd = workload.indexOf(codecImport) + codecImport.length + 2;
    assert.ok(importStart >= 0 && importEnd > importStart, "codec import");
    nativeWorkload =
      workload.slice(0, importStart) + nativeCodec + workload.slice(importEnd);
  }
  let fellBack = false;
  const path = verifyHostedFixture(
    'import { monotonicMilliseconds as now } from "clock";\n' + nativeWorkload,
    "string-bench-" + suiteName,
    [
      ["clock", clock],
      ["@tint/foundation/text/text-encoding", textEncoding],
      ["@tint/js-runtime/objects", objects],
    ],
    [],
    [],
    [{ module: clock, namespace: "string-bench-clock" }],
    {
      requireTyped: suite.typed,
      onGeneralFallback: () => {
        fellBack = true;
      },
      hostBindings: [
        {
          module: clock,
          name: "monotonicMilliseconds",
          operation: "monotonic-time",
        },
      ],
      // PR #15's and PR #17's plain-program sizes, so the baselines compare.
      managedBytes: 268435456,
      allocationCapacity: 8388608,
      rootCapacity: 65536,
      stackBytes: 8388608,
    },
  );
  assert.equal(fellBack, !suite.typed, "general fallback of " + suiteName);
  const native = nativeArtifact(
    nativeFixtureTarget().name,
    path,
    path + ".manifest.json",
  );
  return {
    suite: suiteName,
    typed: suite.typed,
    head: execute("git", ["rev-parse", "HEAD"]).trim(),
    patchSha256: hash(
      execute("git", ["diff", "--binary", "HEAD", "--", "packages", "tools"]),
    ),
    platform: process.platform + "-" + process.arch,
    node,
    nodeSha256: fileHash(node),
    script,
    scriptSha256: fileHash(script),
    native,
    debugSymbols: imageText(readFileSync(path)).dwarf,
    steady,
    kernels: table,
  };
}

function runNative(artifact: Artifact): string {
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
  ]);
  assert.match(output, /^TINT_BENCH_VERIFIED$/m, output.slice(-4000));
  return output;
}

function readRun(
  output: string,
  prepared: Prepared,
): Record<string, RunValues> {
  const iterations: Record<string, number[]> = {};
  for (const match of output.matchAll(
    new RegExp(`^${marker} (\\w+) (\\d+) ([0-9.eE+-]+) (-?\\d+)\\r?$`, "gm"),
  )) {
    const name = match[1]!;
    const expected = prepared.kernels[name];
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
    Object.keys(prepared.kernels).sort(),
    output.slice(-4000),
  );
  return Object.fromEntries(
    Object.entries(iterations).map(([name, list]) => {
      assert.equal(list.length, prepared.steady + 1, "iterations of " + name);
      const warm = list.slice(1);
      return [name, { cold: list[0]!, steady: median(warm), warm }];
    }),
  );
}

function runNode(prepared: Prepared): string {
  return execute(prepared.node, [prepared.script]);
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

function checkPrepared(prepared: Prepared): void {
  assert.equal(prepared.platform, process.platform + "-" + process.arch);
  assert.equal(fileHash(prepared.node), prepared.nodeSha256);
  assert.equal(fileHash(prepared.script), prepared.scriptSha256);
  assert.equal(fileHash(prepared.native.path), prepared.native.imageSha256);
  const manifest = prepared.native.buildManifest;
  assert.ok(manifest !== undefined);
  assert.equal(fileHash(manifest.path), manifest.sha256);
}

function measure(
  prepared: Prepared,
  path: string,
  rounds: number,
  candidates: readonly Prepared[],
): void {
  checkPrepared(prepared);
  const artifacts = new Map<string, Prepared>([["tint", prepared]]);
  for (const [index, candidate] of candidates.entries()) {
    checkPrepared(candidate);
    assert.deepEqual(candidate.kernels, prepared.kernels);
    assert.equal(candidate.steady, prepared.steady);
    assert.equal(candidate.scriptSha256, prepared.scriptSha256);
    assert.equal(candidate.nodeSha256, prepared.nodeSha256);
    assert.equal(candidate.debugSymbols, prepared.debugSymbols);
    assert.equal(candidate.suite, prepared.suite);
    artifacts.set("candidate" + String(index + 1), candidate);
  }
  const engines = ["node", ...artifacts.keys()];
  assert.ok(Number.isInteger(rounds) && rounds >= 15);
  const samples: {
    round: number;
    engine: string;
    position: number;
    values: Record<string, RunValues>;
    wallMs: number;
    loadBefore: number[];
    loadAfter: number[];
    idlePercent: number | null;
  }[] = [];
  for (let round = 0; round < rounds; round++) {
    const order = engines.map(
      (_, position) => engines[(round + position) % engines.length]!,
    );
    if (round % 2 === 1) order.reverse();
    for (const [position, engine] of order.entries()) {
      const before = cpuTimes();
      const loadBefore = loadavg();
      const started = performance.now();
      const candidate = artifacts.get(engine);
      const output =
        candidate === undefined
          ? runNode(prepared)
          : runNative(candidate.native);
      const wallMs = performance.now() - started;
      const after = cpuTimes();
      const total = after.total - before.total;
      samples.push({
        round,
        engine,
        position,
        values: readRun(output, prepared),
        wallMs,
        loadBefore,
        loadAfter: loadavg(),
        idlePercent:
          total === 0 ? null : (100 * (after.idle - before.idle)) / total,
      });
    }
    console.error(`completed round ${round + 1}/${rounds}`);
  }
  const byEngine = (engine: string) =>
    samples
      .filter((row) => row.engine === engine)
      .sort((left, right) => left.round - right.round);
  const node = byEngine("node");
  const summary = Object.fromEntries(
    Object.keys(prepared.kernels).map((name) => [
      name,
      Object.fromEntries(
        engines.map((engine) => {
          const rows = byEngine(engine);
          const base = byEngine("tint");
          return [
            engine,
            {
              steadyMs: distribution(
                rows.map((row) => row.values[name]!.steady),
              ),
              coldMs: distribution(rows.map((row) => row.values[name]!.cold)),
              steadyOverNode: distribution(
                rows.map(
                  (row, i) =>
                    row.values[name]!.steady / node[i]!.values[name]!.steady,
                ),
              ),
              coldOverNode: distribution(
                rows.map(
                  (row, i) =>
                    row.values[name]!.cold / node[i]!.values[name]!.cold,
                ),
              ),
              ...(engine.startsWith("candidate")
                ? {
                    steadyOverBase: distribution(
                      rows.map(
                        (row, i) =>
                          row.values[name]!.steady /
                          base[i]!.values[name]!.steady,
                      ),
                    ),
                  }
                : {}),
            },
          ];
        }),
      ),
    ]),
  );
  writeReport(path, {
    prepared,
    candidates,
    cpu: cpus()[0]?.model,
    cpuCount: cpus().length,
    rounds,
    summary,
    samples,
  });
  printSummary(summary, engines);
}

function printSummary(
  summary: Record<
    string,
    Record<string, Record<string, { median: number; q1: number; q3: number }>>
  >,
  engines: readonly string[],
): void {
  const cell = (
    d: { median: number; q1: number; q3: number },
    digits: number,
  ) =>
    `${d.median.toFixed(digits)} (${d.q1.toFixed(digits)}–${d.q3.toFixed(digits)})`;
  console.log(
    "| Kernel | " +
      engines.map((engine) => engine + " ms").join(" | ") +
      " | " +
      engines
        .filter((engine) => engine !== "node")
        .map((engine) => engine + " / node")
        .join(" | ") +
      " |",
  );
  for (const [name, row] of Object.entries(summary))
    console.log(
      `| ${name} | ` +
        engines.map((engine) => cell(row[engine]!.steadyMs!, 1)).join(" | ") +
        " | " +
        engines
          .filter((engine) => engine !== "node")
          .map((engine) => cell(row[engine]!.steadyOverNode!, 2))
          .join(" | ") +
        " |",
    );
}

function readPrepared(path: string): Prepared {
  return JSON.parse(readFileSync(path, "utf8")) as Prepared;
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "prepare" && rest.length >= 2) {
  const [node, output, ...options] = rest;
  const valueOf = (flag: string) => {
    const at = options.indexOf(flag);
    return at < 0 ? undefined : options[at + 1];
  };
  const selected = options.filter(
    (option, index) =>
      !option.startsWith("--") && !options[index - 1]?.startsWith("--"),
  );
  writeReport(
    output!,
    await prepare(
      node!,
      valueOf("--suite") ?? "typed",
      selected,
      Number(valueOf("--steady") ?? 5),
    ),
  );
} else if (mode === "v8-script" && rest.length === 2) {
  // One kernel, stripped and run six times at its scale, for V8 code
  // inspection: node --print-opt-code --code-comments SCRIPT.mjs
  const [name, output] = rest;
  const suite = Object.values(suites).find(
    (candidate) => candidate.scales[name!] !== undefined,
  );
  assert.ok(suite !== undefined, "unknown kernel " + name);
  const scales = suite.scales;
  const source = readFileSync(new URL("./" + suite.file, import.meta.url));
  writeFileSync(
    output!,
    stripTypeScriptTypes(source.toString()).replace(
      codecImport,
      JSON.stringify(new URL("file://" + codec).href),
    ) + `\nfor (let i = 0; i < 6; i++) ${name}(${scales[name!]});\n`,
    { flag: "wx" },
  );
} else if (mode === "smoke" && rest.length === 1) {
  const prepared = readPrepared(rest[0]!);
  checkPrepared(prepared);
  const show = (label: string, values: Record<string, RunValues>) => {
    for (const [name, value] of Object.entries(values))
      console.log(
        label.padEnd(5) +
          name.padEnd(16) +
          ("cold " + value.cold.toFixed(1)).padStart(12) +
          ("steady " + value.steady.toFixed(1)).padStart(14),
      );
  };
  show("node", readRun(runNode(prepared), prepared));
  show("tint", readRun(runNative(prepared.native), prepared));
} else if (mode === "measure" && rest.length >= 2) {
  const [input, output, rounds, ...candidates] = rest;
  // The lock wrapper enters this process only after owning the shared locks
  // (Darwin); Linux runs on the dev machine take no macOS lock.
  measure(
    readPrepared(input!),
    output!,
    Number(rounds ?? 15),
    candidates.map(readPrepared),
  );
} else {
  throw Error(`Usage:
  node tools/string-bench/bench.ts prepare NODE26 PREPARED.json [--suite typed|general] [--steady N] [KERNEL ...]
  tools/gate/with-lock.sh launch string-bench-smoke node tools/string-bench/bench.ts smoke PREPARED.json
  tools/gate/with-lock.sh both string-bench node tools/string-bench/bench.ts measure PREPARED.json REPORT.json [ROUNDS] [CANDIDATE.json ...]
  node tools/string-bench/bench.ts v8-script KERNEL SCRIPT.mjs`);
}
