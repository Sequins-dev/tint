/** Prepare outside the shared timing lock, then measure in rotated rounds. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { imageText } from "../disasm/annotate.ts";
import { verifyHostedFixture } from "../hosted-fixture.ts";
import { nativeFixtureTarget } from "../native-host-target.ts";
import { nativeArtifact } from "../native-target-runner.ts";
import * as kernels from "./kernels.ts";
import * as generality from "./generality.ts";

const clock = "packages/native-runtime/src/intrinsics/clock.ts";
type Artifact = ReturnType<typeof nativeArtifact>;
interface Prepared {
  head: string;
  patchSha256: string;
  node: string;
  nodeSha256: string;
  script: string;
  scriptSha256: string;
  native: Record<string, Artifact>;
  checksums: Record<string, { sum: number; iterations: number; warm: number }>;
  nativeLaunch?: { args: string[]; exit: number };
  octane?: {
    revision: string;
    upstream: string;
    hashes: Record<string, string>;
  };
}

function execute(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, TZ: "UTC" },
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

function preparationIdentity(node: string) {
  return {
    head: execute("git", ["rev-parse", "HEAD"]).trim(),
    patchSha256: hash(
      execute("git", ["diff", "--binary", "HEAD", "--", "packages"]),
    ),
    node,
    nodeSha256: fileHash(node),
  };
}

function prepare(
  node: string,
  selected: string | undefined,
  scale: number,
  suite: "kernels" | "generality",
): Prepared {
  node = resolve(node);
  assert.equal(execute(node, ["--version"]).trim(), "v26.13.1");
  assert.ok(Number.isSafeInteger(scale) && scale > 0);
  const operations: Record<string, (iterations: number) => number> =
    suite === "kernels" ? kernels : generality;
  const names = Object.keys(operations).filter(
    (name) => selected === undefined || selected === name,
  );
  assert.ok(names.length > 0, "unknown benchmark case");
  const checksums: Prepared["checksums"] = {};
  const cases = names.map((name) => {
    const iterations = (name === "recursive" ? 2_000 : 100_000) * scale;
    const warm = name === "recursive" ? 2_000 : 20_000;
    const operation = operations[name]!;
    const sum = operation(iterations);
    checksums[name] = { sum, iterations, warm };
    return `{
      if (${name}(${warm}) !== ${operation(warm)}) return 1;
      const started = now();
      const sum = ${name}(${iterations});
      const elapsed = now() - started;
      if (sum !== ${sum}) return 2;
      console.log("TINT_GENERAL_BENCH ${name} " + elapsed + " " + sum);
    }`;
  });
  const source = readFileSync(
    new URL("./" + suite + ".ts", import.meta.url),
    "utf8",
  );
  const workload = `${source}
export function run(): number {
  ${cases.join("\n")}
  return 42;
}
`;
  const general = stripTypeScriptTypes(workload);
  const work = mkdtempSync(join(tmpdir(), "tint-general-call-bench-"));
  const script = join(work, "benchmark.mjs");
  writeFileSync(
    script,
    "const now = () => Number(process.hrtime.bigint()) / 1e6;\n" +
      general +
      "\nif (run() !== 42) process.exitCode = 1;\n",
  );
  const target = nativeFixtureTarget().name;
  process.env.TZ = "UTC";
  process.env.TINT_BUILD_ONLY = "1";
  delete process.env.TINT_GENERAL_FALLBACK;
  function build(typed: boolean): Artifact {
    let fellBack = false;
    // Force realm lowering even when the typed checker can infer a kernel.
    const realmGuard = "if (typeof Reflect !== 'object') return 3;";
    const body = typed
      ? workload
      : general.replace(
          /export function run\(\)\s*\{/,
          (entry) => entry + realmGuard,
        );
    const path = verifyHostedFixture(
      'import { monotonicMilliseconds as now } from "clock";\n' + body,
      "general-call-bench-" + (typed ? "typed" : "untyped"),
      [["clock", clock]],
      [],
      [],
      [{ module: clock, namespace: "general-call-bench-clock" }],
      {
        requireTyped: typed,
        hostBindings: [
          {
            module: clock,
            name: "monotonicMilliseconds",
            operation: "monotonic-time",
          },
        ],
        managedBytes: 128 * 1024 * 1024,
        allocationCapacity: 1_048_576,
        stackBytes: 4_194_304,
        onGeneralFallback: () => {
          fellBack = true;
        },
      },
    );
    assert.equal(fellBack, !typed);
    return nativeArtifact(target, path, path + ".manifest.json");
  }
  return {
    ...preparationIdentity(node),
    script,
    scriptSha256: fileHash(script),
    native: {
      untyped: build(false),
      ...(suite === "kernels" ? { typed: build(true) } : {}),
    },
    checksums,
  };
}

function distribution(values: number[]) {
  const sorted = values.slice().sort((left, right) => left - right);
  function quantile(p: number): number {
    const index = (sorted.length - 1) * p;
    const lower = sorted[Math.floor(index)]!;
    return lower + (sorted[Math.ceil(index)]! - lower) * (index % 1);
  }
  return { median: quantile(0.5), q1: quantile(0.25), q3: quantile(0.75) };
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

function runNative(
  artifact: Artifact,
  launch = { args: [] as string[], exit: 42 },
): string {
  const args = [
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
    "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == " +
      launch.exit +
      '; print("TINT_BENCH_VERIFIED")',
    "--",
    artifact.path,
    ...launch.args,
  ];
  const output = execute("lldb", args);
  assert.match(output, /^TINT_BENCH_VERIFIED$/m);
  return output;
}

function readSamples(output: string, checksums: Prepared["checksums"]) {
  const values: Record<string, number> = {};
  for (const match of output.matchAll(
    /^TINT_GENERAL_BENCH (\w+) ([0-9.eE+-]+) (\d+)\r?$/gm,
  )) {
    const name = match[1]!;
    const expected = checksums[name];
    const elapsed = Number(match[2]);
    assert.ok(
      expected &&
        Number(match[3]) === expected.sum &&
        Number.isFinite(elapsed) &&
        elapsed > 0,
      "invalid benchmark result: " + match[0],
    );
    assert.equal(values[name], undefined, "duplicate benchmark sample");
    values[name] = (elapsed * 1e6) / expected.iterations;
  }
  assert.deepEqual(
    Object.keys(values).sort(),
    Object.keys(checksums).sort(),
    output,
  );
  return values;
}

function measure(
  prepared: Prepared,
  path: string,
  rounds: number,
  candidates: Prepared[],
) {
  assert.equal(fileHash(prepared.node), prepared.nodeSha256);
  assert.equal(fileHash(prepared.script), prepared.scriptSha256);
  const artifacts: Record<string, Artifact> = { ...prepared.native };
  const previousUntyped = new Map<string, string>();
  const typedHashes = new Set([prepared.native.typed?.imageSha256]);
  for (const [index, candidate] of candidates.entries()) {
    assert.deepEqual(candidate.checksums, prepared.checksums);
    assert.equal(candidate.scriptSha256, prepared.scriptSha256);
    assert.equal(candidate.nodeSha256, prepared.nodeSha256);
    assert.deepEqual(candidate.nativeLaunch, prepared.nativeLaunch);
    const name = "candidate" + String(index + 1);
    artifacts[name + "Untyped"] = candidate.native.untyped!;
    previousUntyped.set(
      name + "Untyped",
      index === 0 ? "untyped" : "candidate" + String(index) + "Untyped",
    );
    const typed = candidate.native.typed;
    assert.equal(typed === undefined, prepared.native.typed === undefined);
    if (typed !== undefined && !typedHashes.has(typed.imageSha256)) {
      artifacts[name + "Typed"] = typed;
      typedHashes.add(typed.imageSha256);
    }
  }
  const debugModes = new Map<string, boolean>();
  for (const build of [prepared, ...candidates]) {
    for (const [kind, artifact] of Object.entries(build.native)) {
      const bytes = readFileSync(artifact.path);
      assert.equal(hash(bytes), artifact.imageSha256);
      const manifest = artifact.buildManifest;
      assert.ok(manifest);
      assert.equal(fileHash(manifest.path), manifest.sha256);
      const debug = imageText(bytes).dwarf;
      const expected = debugModes.get(kind);
      if (expected === undefined) debugModes.set(kind, debug);
      else
        assert.equal(
          debug,
          expected,
          "benchmark debug symbol mode differs for " + kind,
        );
    }
  }
  const engines = ["node", ...Object.keys(artifacts)];
  assert.ok(
    Number.isInteger(rounds) && rounds >= 15 && rounds % engines.length === 0,
  );
  const samples: {
    round: number;
    engine: string;
    position: number;
    values: Record<string, number>;
    exit: number;
    loadBefore: number[];
    loadAfter: number[];
    idlePercent: number | null;
  }[] = [];
  for (let round = 0; round < rounds; round++) {
    for (let position = 0; position < engines.length; position++) {
      const engine = engines[(round + position) % engines.length]!;
      const artifact = artifacts[engine];
      const before = cpuTimes();
      const loadBefore = loadavg();
      const output =
        artifact === undefined
          ? execute(prepared.node, [prepared.script])
          : runNative(artifact, prepared.nativeLaunch);
      const after = cpuTimes();
      const total = after.total - before.total;
      const values = readSamples(output, prepared.checksums);
      samples.push({
        round,
        engine,
        position,
        values,
        exit: artifact === undefined ? 0 : (prepared.nativeLaunch?.exit ?? 42),
        loadBefore,
        loadAfter: loadavg(),
        idlePercent:
          total === 0 ? null : (100 * (after.idle - before.idle)) / total,
      });
    }
    console.error(`completed round ${round + 1}/${rounds}`);
  }
  const summary = Object.fromEntries(
    Object.keys(prepared.checksums).map((name) => {
      const node = samples.filter((row) => row.engine === "node");
      return [
        name,
        Object.fromEntries(
          engines.map((engine) => {
            const rows = samples.filter((row) => row.engine === engine);
            const previous = previousUntyped.get(engine);
            const before = samples.filter((row) => row.engine === previous);
            return [
              engine,
              {
                ns: distribution(rows.map((row) => row.values[name]!)),
                deltaFromNodeNs: distribution(
                  rows.map(
                    (row, i) => row.values[name]! - node[i]!.values[name]!,
                  ),
                ),
                ...(previous !== undefined
                  ? {
                      deltaFromPreviousNs: distribution(
                        rows.map(
                          (row, i) =>
                            row.values[name]! - before[i]!.values[name]!,
                        ),
                      ),
                    }
                  : {}),
              },
            ];
          }),
        ),
      ];
    }),
  );
  writeReport(path, {
    prepared,
    candidates,
    cpu: cpus()[0]?.model,
    rounds,
    summary,
    samples,
  });
}

function readPrepared(path: string): Prepared {
  return JSON.parse(readFileSync(path, "utf8")) as Prepared;
}

const [mode, input, output, extra, ...additional] = process.argv.slice(2);
if ((mode === "prepare" || mode === "prepare-generality") && input && output) {
  writeReport(
    output,
    prepare(
      input,
      extra,
      Number(additional[0] ?? 1),
      mode === "prepare" ? "kernels" : "generality",
    ),
  );
} else if (mode === "fetch-octane" && input) {
  const { fetchOctane } = await import("./octane.ts");
  fetchOctane(input);
} else if (mode === "prepare-octane" && input && output && extra) {
  const { prepareOctane } = await import("./octane.ts");
  const node = resolve(input);
  assert.equal(execute(node, ["--version"]).trim(), "v26.13.1");
  const identity = preparationIdentity(node);
  const prepared = prepareOctane(extra, additional[0], node);
  writeReport(output, {
    ...identity,
    ...prepared,
    scriptSha256: fileHash(prepared.script),
  });
} else if (mode === "smoke" && input) {
  const prepared = readPrepared(input);
  console.log(
    "Node",
    readSamples(execute(prepared.node, [prepared.script]), prepared.checksums),
  );
  for (const [name, artifact] of Object.entries(prepared.native))
    console.log(
      name,
      readSamples(
        runNative(artifact, prepared.nativeLaunch),
        prepared.checksums,
      ),
    );
} else if (mode === "measure" && input && output) {
  assert.equal(process.platform, "darwin", "expected Darwin timing host");
  // The lock wrapper enters this process only after owning the shared lock.
  measure(
    readPrepared(input),
    output,
    Number(extra ?? 15),
    additional.map(readPrepared),
  );
} else {
  throw Error(`Usage:
  node tools/general-call-bench/benchmark.ts prepare NODE26 PREPARED.json [CASE] [SCALE]
  node tools/general-call-bench/benchmark.ts prepare-generality NODE26 PREPARED.json [CASE] [SCALE]
  node tools/general-call-bench/benchmark.ts fetch-octane DIRECTORY
  node tools/general-call-bench/benchmark.ts prepare-octane NODE26 PREPARED.json DIRECTORY [CASE]
  tools/gate/with-lock.sh launch general-calls-smoke node tools/general-call-bench/benchmark.ts smoke PREPARED.json
  tools/gate/with-lock.sh both general-calls node tools/general-call-bench/benchmark.ts measure PREPARED.json REPORT.json [ROUNDS] [CANDIDATE.json ...]`);
}
