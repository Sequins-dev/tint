/** Compare the public FFI API on one target with one workload and one DSO. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { withGateLock } from "./gate/lock.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";
import {
  nativeArtifact,
  runNativeBatch,
  type NativeResult,
} from "./native-target-runner.ts";
import {
  cpuTimes,
  cpuIdlePercent,
  idleMonitor,
  idleThreshold,
} from "./node-ffi-benchmark-idle.ts";

export { cpuIdlePercent } from "./node-ffi-benchmark-idle.ts";

const arities = [0, 1, 2, 4, 8, 12, 24];
const controlCase = "js-only-control";
const measuredCases = [
  ...arities.map((arity) => "arity-" + arity),
  "buffer",
  "callback",
];
const engines = [
  "node",
  "tintUntypedLiteral",
  "tintUntypedRuntime",
  "tintTypedLiteral",
  "tintTypedRuntime",
] as const;
type Engine = (typeof engines)[number];
type TintEngine = Exclude<Engine, "node">;
type NativeArtifact = ReturnType<typeof nativeArtifact>;
type NativeLaunch = { engine: TintEngine; result: NativeResult };

const definitions = Object.fromEntries([
  ...arities.map((arity) => [
    "bench_" + arity,
    arity === 0
      ? { return: "i32" }
      : {
          arguments: Array.from({ length: arity }, () => "i32"),
          return: "i32",
        },
  ]),
  ["bench_callback", { arguments: ["function", "i32"], return: "i32" }],
  ["bench_buffer", { arguments: ["buffer"], return: "i32" }],
]);
const setupScalars = arities
  .map((arity) => "const f" + arity + " = functions.bench_" + arity + ";")
  .join("\n");

export function benchmarkBody(
  dso: string,
  literal: boolean,
  typed: boolean,
  iterations: number,
  warm: number,
): string {
  const operation = (call: string) =>
    typed ? "(): number => " + call + " as number" : "() => " + call;
  const scalarCases = arities
    .map(
      (arity) =>
        "measure(" +
        JSON.stringify("arity-" + arity) +
        ", " +
        operation(
          "f" +
            arity +
            "(" +
            Array.from({ length: arity }, () => "1").join(",") +
            ")",
        ) +
        ", " +
        (arity + 1) +
        ");",
    )
    .join("\n");
  const open =
    "dlopen(" +
    JSON.stringify(dso) +
    ", " +
    (literal ? JSON.stringify(definitions) : "definitions") +
    ")";
  return `
export function run()${typed ? ": number" : ""} {
  ${literal ? "" : "const definitions = " + JSON.stringify(definitions) + ";"}
  const { lib, functions } = ${open};
  ${setupScalars}
  function measure(${
    typed
      ? "name: string, operation: () => number, expected: number): void"
      : "name, operation, expected)"
  }
  {
    let sum = 0;
    for (let i = 0; i < ${warm}; i++) sum += operation();
    if (sum !== ${warm} * expected) throw new Error(name + " warmup checksum " + sum);
    sum = 0;
    const start = now();
    for (let i = 0; i < ${iterations}; i++) sum += operation();
    const elapsed = now() - start;
    if (sum !== ${iterations} * expected) throw new Error(name + " checksum " + sum);
    console.log("TINT_FFI_BENCH " + name + " " + elapsed + " " + sum);
  }
  try {
    ${scalarCases}
    const bytes = Buffer.from([42]);
    const bufferCall = functions.bench_buffer;
    measure("buffer", ${operation("bufferCall(bytes)")}, 42);
    const callback = lib.registerCallback({ arguments: ["i32"], return: "i32" },
      ${typed ? "(value: number): number => value + 1" : "(value) => value + 1"});
    const callbackCall = functions.bench_callback;
    measure("callback", ${operation("callbackCall(callback, 41)")}, 42);
    measure(${JSON.stringify(controlCase)}, ${typed ? "(): number => 42" : "() => 42"}, 42);
  } finally { lib.close(); }
  return 42;
}
`;
}

type Measurement = {
  case: string;
  round: number;
  milliseconds: number;
  checksum: number;
};
function median(samples: number[]): number {
  samples.sort((left, right) => left - right);
  const index = Math.floor(samples.length / 2);
  const upper = samples[index];
  if (upper === undefined) throw Error("empty benchmark sample");
  return samples.length % 2 === 0
    ? ((samples[index - 1] ?? upper) + upper) / 2
    : upper;
}

export function caseTiming(
  samples: readonly Measurement[],
  name: string,
  iterations: number,
  rounds: number,
): { callNs: number; controlNs: number; overheadNs: number } {
  const controls = new Map(
    samples
      .filter((sample) => sample.case === controlCase)
      .map((sample) => [sample.round, sample.milliseconds]),
  );
  const calls = samples.filter((sample) => sample.case === name);
  if (calls.length !== rounds || controls.size !== rounds)
    throw Error("incomplete paired samples");
  const scale = 1e6 / iterations;
  return {
    callNs: median(calls.map((sample) => sample.milliseconds * scale)),
    controlNs: median(
      [...controls.values()].map((milliseconds) => milliseconds * scale),
    ),
    overheadNs: median(
      calls.map((sample) => {
        const control = controls.get(sample.round);
        if (control === undefined)
          throw Error("missing control for round " + sample.round);
        return (sample.milliseconds - control) * scale;
      }),
    ),
  };
}

function parse(
  output: string,
  round: number,
  iterations: number,
): Measurement[] {
  const values: Measurement[] = [];
  for (const match of output.matchAll(
    /^TINT_FFI_BENCH ([\w-]+) ([0-9.eE+-]+) (\d+)\r?$/gm,
  )) {
    const name = match[1];
    if (name === undefined) throw Error("benchmark record is missing its name");
    const expected = name.startsWith("arity-") ? Number(name.slice(6)) + 1 : 42;
    const milliseconds = Number(match[2]),
      checksum = Number(match[3]);
    if (
      !Number.isFinite(milliseconds) ||
      milliseconds <= 0 ||
      checksum !== iterations * expected ||
      (name !== controlCase && !measuredCases.includes(name))
    )
      throw Error("invalid benchmark sample for " + name);
    values.push({ case: name, round, milliseconds, checksum });
  }
  if (
    values.length !== measuredCases.length + 1 ||
    new Set(values.map((value) => value.case)).size !== values.length
  )
    throw Error("incomplete benchmark output");
  return values;
}

function execute(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, TZ: "UTC" },
  });
  if (result.status !== 0)
    throw Error(
      command +
        " exited " +
        result.status +
        "\n" +
        (result.error ?? result.stderr),
    );
  return result.stdout.trim();
}
const hashes = (file: string): string =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

interface PreparedBenchmark {
  readonly head: string;
  readonly node: string;
  readonly nodeSha256: string;
  readonly benchmark: string;
  readonly sourceSha256: string;
  readonly dso: string;
  readonly dsoSha256: string;
  readonly target: string;
  readonly iterations: number;
  readonly warm: number;
  readonly artifacts: Readonly<Record<TintEngine, NativeArtifact>>;
}

function prepare(node: string, iterations: number): PreparedBenchmark {
  const work = mkdtempSync(join(tmpdir(), "tint-node-ffi-bench-"));
  const target = nativeFixtureTarget().name;
  const darwin = target === "darwin-aarch64";
  if (
    process.platform !== (darwin ? "darwin" : "linux") ||
    process.arch !== (target === "linux-x86_64" ? "x64" : "arm64")
  )
    throw Error("build and measure both engines on the same target host");
  if (execute(node, ["--version"]) !== "v26.13.1")
    throw Error("expected Node v26.13.1");

  const scalar = arities
    .map((arity) => {
      const parameters = Array.from({ length: arity }, (_, i) => "a" + i);
      return (
        "int32_t bench_" +
        arity +
        "(" +
        (arity === 0
          ? "void"
          : parameters.map((name) => "int32_t " + name).join(", ")) +
        ") { return 1" +
        parameters.map((name) => " + " + name).join("") +
        "; }"
      );
    })
    .join("\n");
  const c = join(work, "library.c");
  const dso = join(work, darwin ? "library.dylib" : "library.so");
  writeFileSync(
    c,
    "#include <stdint.h>\n" +
      scalar +
      `
int32_t bench_callback(int32_t (*fn)(int32_t), int32_t value) { return fn(value); }
int32_t bench_buffer(const uint8_t *buffer) { return buffer[0]; }
`,
  );
  execute("clang", [
    "-O2",
    "-fPIC",
    darwin ? "-dynamiclib" : "-shared",
    c,
    "-o",
    dso,
  ]);

  const warm = Math.min(20000, iterations);
  const benchmark = join(work, "benchmark.mjs");
  writeFileSync(
    benchmark,
    `
import { dlopen } from "node:ffi";
import { Buffer } from "node:buffer";
const now = () => Number(process.hrtime.bigint()) / 1e6;
${benchmarkBody(dso, true, false, iterations, warm)}
if (run() !== 42) process.exitCode = 1;
`,
  );
  process.env.TZ = "UTC";
  process.env.TINT_BUILD_ONLY = "defer-admission";
  delete process.env.TINT_GENERAL_FALLBACK;
  const clock = "packages/native-runtime/src/intrinsics/clock.ts";
  function build(
    engine: TintEngine,
    literal: boolean,
    typed: boolean,
  ): NativeArtifact {
    const image = verifyHostedFixture(
      `import { dlopen } from "node:ffi";
import { Buffer } from "node:buffer";
import { monotonicMilliseconds as now } from "clock";
${benchmarkBody(dso, literal, typed, iterations, warm)}`,
      "node-ffi-benchmark-" + engine,
      [
        ["node:ffi", "packages/native-runtime/src/node/ffi.ts"],
        ["node:buffer", "packages/native-runtime/src/node/buffer.ts"],
        ["clock", clock],
      ],
      [],
      [],
      [{ module: clock, namespace: "node-ffi-bench-clock" }],
      {
        allowJit: true,
        requireTyped: typed,
        hostBindings: [
          {
            module: clock,
            name: "monotonicMilliseconds",
            operation: "monotonic-time",
          },
        ],
        managedBytes: 128 * 1024 * 1024,
        allocationCapacity: 1048576,
        stackBytes: 4194304,
      },
    );
    return nativeArtifact(target, image, image + ".manifest.json");
  }
  return {
    head: execute("git", ["rev-parse", "HEAD"]),
    node,
    nodeSha256: hashes(node),
    benchmark,
    sourceSha256: hashes(benchmark),
    dso,
    dsoSha256: hashes(dso),
    target,
    iterations,
    warm,
    artifacts: {
      tintUntypedLiteral: build("tintUntypedLiteral", true, false),
      tintUntypedRuntime: build("tintUntypedRuntime", false, false),
      tintTypedLiteral: build("tintTypedLiteral", true, true),
      tintTypedRuntime: build("tintTypedRuntime", false, true),
    },
  };
}

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
function pause(ms: number): void {
  Atomics.wait(sleepBuffer, 0, 0, ms);
}
function preflightIdle(): number {
  const start = cpuTimes();
  pause(1000);
  return cpuIdlePercent(start, cpuTimes());
}

function measureRound(
  prepared: PreparedBenchmark,
  round: number,
): {
  idle: number[];
  samples: Record<Engine, Measurement[]>;
  native: NativeLaunch[];
} {
  const state = new Int32Array(new SharedArrayBuffer(4096 * 4));
  const sampler = new Worker(
    new URL("./node-ffi-benchmark-idle.ts", import.meta.url),
    {
      workerData: state.buffer,
    },
  );
  const samples = {} as Record<Engine, Measurement[]>;
  const native: NativeLaunch[] = [];
  try {
    if (Atomics.wait(state, idleMonitor.lifecycle, 0, 10000) === "timed-out")
      throw Error("CPU idle monitor did not start");
    const first = round % engines.length;
    const order = [...engines.slice(first), ...engines.slice(0, first)];
    for (const engine of order) {
      if (Atomics.load(state, idleMonitor.busy) !== 0) break;
      let output: string;
      if (engine === "node")
        output = execute(prepared.node, [prepared.benchmark]);
      else {
        const [result] = runNativeBatch([
          { artifact: prepared.artifacts[engine], timeoutMs: 120000 },
        ]);
        if (result?.kind !== "exited" || result.status !== 42)
          throw Error(
            "native benchmark did not exit 42: " + JSON.stringify(result),
          );
        native.push({ engine, result });
        output = result.stdout;
      }
      samples[engine] = parse(output, round, prepared.iterations);
    }
  } finally {
    Atomics.store(state, idleMonitor.stop, 1);
    if (Atomics.wait(state, idleMonitor.lifecycle, 1, 5000) === "timed-out") {
      void sampler.terminate();
      throw Error("CPU idle monitor did not finish");
    }
  }
  const count = Atomics.load(state, idleMonitor.count);
  const idle = Array.from(
    state.subarray(idleMonitor.samples, idleMonitor.samples + count),
    (value) => value / 100,
  );
  if (idle.length === 0) throw Error("CPU idle monitor recorded no samples");
  return { idle, samples, native };
}

function writeReport(file: string, report: unknown): void {
  writeFileSync(resolve(file), JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
}

function measure(prepared: PreparedBenchmark, file: string): void {
  if (
    prepared.target !== nativeFixtureTarget().name ||
    hashes(prepared.node) !== prepared.nodeSha256 ||
    hashes(prepared.benchmark) !== prepared.sourceSha256 ||
    hashes(prepared.dso) !== prepared.dsoSha256
  )
    throw Error("prepared benchmark inputs changed");
  for (const artifact of Object.values(prepared.artifacts)) {
    if (
      hashes(artifact.path) !== artifact.imageSha256 ||
      artifact.buildManifest === undefined ||
      hashes(artifact.buildManifest.path) !== artifact.buildManifest.sha256
    )
      throw Error("prepared native image or manifest changed");
  }

  const timingLock =
    process.env.TINT_FFI_BENCH_TIMING_LOCK ??
    join(homedir(), ".t3", "tint-timing.lock");
  const maximumWait = Number(process.env.TINT_FFI_BENCH_IDLE_TIMEOUT_MS ?? "0");
  if (!Number.isSafeInteger(maximumWait) || maximumWait < 0)
    throw Error("invalid idle wait timeout");
  const started = Date.now();
  // Two complete rotations give each engine equal launch positions.
  const rounds = engines.length * 2;
  const results = Object.fromEntries(
    engines.map((engine) => [engine, [] as Measurement[]]),
  ) as Record<Engine, Measurement[]>;
  const native: ({ round: number } & NativeLaunch)[] = [];
  const host: { before: number; during: number[] }[] = [];
  let rejectedRounds = 0;
  for (let round = 0; round < rounds;) {
    const accepted = withGateLock(
      [timingLock],
      "node-ffi-benchmark",
      undefined,
      () => {
        const before = preflightIdle();
        if (before <= idleThreshold) return false;
        const trial = measureRound(prepared, round);
        if (trial.idle.some((sample) => sample <= idleThreshold)) {
          console.error(
            "Discarded round " +
              (round + 1) +
              " after idle fell to " +
              Math.min(...trial.idle).toFixed(2) +
              "%",
          );
          return false;
        }
        for (const engine of engines)
          results[engine].push(...trial.samples[engine]);
        native.push(...trial.native.map((launch) => ({ round, ...launch })));
        host.push({ before, during: trial.idle });
        return true;
      },
    );
    if (accepted) {
      round++;
      console.error("Accepted quiet round " + round + "/" + rounds);
      continue;
    }
    rejectedRounds++;
    if (maximumWait > 0 && Date.now() - started >= maximumWait)
      throw Error(
        "quiet CPU requirement was not met. Accepted " +
          round +
          "/" +
          rounds +
          " rounds",
      );
    if (rejectedRounds === 1 || rejectedRounds % 6 === 0)
      console.error(
        "Waiting for CPU idle above 95%. Accepted " +
          round +
          "/" +
          rounds +
          " rounds",
      );
    pause(5000);
  }
  const medians = measuredCases.map((name) => {
    const timing = Object.fromEntries(
      engines.map((engine) => [
        engine,
        caseTiming(results[engine], name, prepared.iterations, rounds),
      ]),
    ) as Record<Engine, ReturnType<typeof caseTiming>>;
    return {
      case: name,
      ...timing,
      typedParity:
        timing.tintTypedLiteral.overheadNs <= timing.node.overheadNs &&
        timing.tintTypedRuntime.overheadNs <= timing.node.overheadNs,
    };
  });
  writeReport(file, {
    ...prepared,
    cpu: cpus()[0]?.model,
    rounds,
    timingLock,
    idleThreshold,
    host,
    rejectedRounds,
    native,
    results,
    medians,
  });
  if (
    process.env.TINT_FFI_BENCH_REQUIRE_PARITY === "1" &&
    medians.some((sample) => !sample.typedParity)
  )
    process.exitCode = 2;
}

if (import.meta.main) {
  const [command, destination, optional] = process.argv.slice(2);
  if (
    command === "--measure" &&
    destination !== undefined &&
    optional !== undefined
  ) {
    measure(
      JSON.parse(readFileSync(destination, "utf8")) as PreparedBenchmark,
      optional,
    );
  } else {
    const iterations = Number(optional ?? "100000");
    if (
      command === undefined ||
      destination === undefined ||
      !Number.isSafeInteger(iterations) ||
      iterations < 1
    )
      throw Error(
        "usage: node tools/node-ffi-benchmark.ts NODE_V26_13_1 NEW_REPORT_JSON [iterations]",
      );
    const prepared = prepare(resolve(command), iterations);
    if (process.env.TINT_FFI_BENCH_PREPARE_ONLY === "1")
      writeReport(destination, prepared);
    else measure(prepared, destination);
  }
}
