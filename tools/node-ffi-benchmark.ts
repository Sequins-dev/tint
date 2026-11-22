/** Compare the public FFI API on one target with one workload and one DSO. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, homedir, loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { withGateLock } from "./gate/lock.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";
import {
  nativeArtifact,
  runNativeBatch,
  type NativeResult,
} from "./native-target-runner.ts";
import { cpuTimes, cpuIdlePercent } from "./node-ffi-benchmark-idle.ts";

export { cpuIdlePercent } from "./node-ffi-benchmark-idle.ts";

const arities = [0, 1, 2, 4, 8, 12, 24];
const controlCase = "js-only-control";
const measuredCases = [
  ...arities.map((arity) => "arity-" + arity),
  "buffer",
  "callback",
];
/** Each measured case has a JavaScript twin with the same call shape: the
 * same arity and arguments, the same Buffer argument, or the same callback
 * invocation. Subtracting it leaves the FFI boundary's own cost. The Buffer
 * twin returns a constant, so the C read stays in the FFI cost. */
const shapeControl = (name: string): string => "js-" + name;
const shapeControls = measuredCases.map(shapeControl);
/** General engines also call a built-in twin of each shape: `Number()`,
 * `Math.max` over the same arguments, `ArrayBuffer.isView` on the Buffer and
 * `Reflect.apply` of the callback. Its cost is the engine's call protocol for
 * a built-in function, which an FFI wrapper also uses. */
const builtinControl = (name: string): string => "builtin-" + name;
const builtinControls = measuredCases.map(builtinControl);
const expectedChecksum = (name: string): number => {
  if (name.startsWith("builtin-")) {
    const measured = name.slice(8);
    if (measured === "arity-0") return 0;
    return measured === "callback" ? 42 : 1;
  }
  const measured = name.startsWith("js-") ? name.slice(3) : name;
  return measured.startsWith("arity-") ? Number(measured.slice(6)) + 1 : 42;
};
const tintEngines = [
  "tintUntypedLiteral",
  "tintUntypedRuntime",
  "tintTypedLiteral",
  "tintTypedRuntime",
] as const;
type TintEngine = (typeof tintEngines)[number];
type NativeArtifact = ReturnType<typeof nativeArtifact>;

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
  const number = typed ? ": number" : "";
  const shapeFunctions = arities
    .map((arity) => {
      const parameters = Array.from({ length: arity }, (_, i) => "a" + i);
      return (
        "const j" +
        arity +
        " = (" +
        parameters.map((name) => name + number).join(", ") +
        ")" +
        number +
        " => 1" +
        parameters.map((name) => " + " + name).join("") +
        ";"
      );
    })
    .join("\n  ");
  const scalarCases = arities
    .flatMap((arity) => {
      const args =
        "(" + Array.from({ length: arity }, () => "1").join(",") + ")";
      const name = "arity-" + arity;
      const measured = [
        { call: "f" + arity + args, label: name, expected: arity + 1 },
        {
          call: "j" + arity + args,
          label: shapeControl(name),
          expected: arity + 1,
        },
      ];
      if (!typed)
        measured.push({
          call: arity === 0 ? "num()" : "max" + args,
          label: builtinControl(name),
          expected: expectedChecksum(builtinControl(name)),
        });
      return measured.map(
        ({ call, label, expected }) =>
          "measure(" +
          JSON.stringify(label) +
          ", " +
          operation(call) +
          ", " +
          expected +
          ");",
      );
    })
    .join("\n    ");
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
  ${shapeFunctions}
  const bufferShape = ${typed ? "(input: unknown): number => 42" : "(input) => 42"};
  const increment = ${typed ? "(value: number): number => value + 1" : "(value) => value + 1"};
  const callbackShape = ${typed ? "(target: (value: number) => number, value: number): number => target(value)" : "(target, value) => target(value)"};
  ${typed ? "" : "const num = Number, max = Math.max, isView = ArrayBuffer.isView, apply = Reflect.apply, applied = [41];"}
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
    measure(${JSON.stringify(shapeControl("buffer"))}, ${operation("bufferShape(bytes)")}, 42);
    ${typed ? "" : "measure(" + JSON.stringify(builtinControl("buffer")) + ", () => isView(bytes), 1);"}
    const callback = lib.registerCallback({ arguments: ["i32"], return: "i32" }, increment);
    const callbackCall = functions.bench_callback;
    measure("callback", ${operation("callbackCall(callback, 41)")}, 42);
    measure(${JSON.stringify(shapeControl("callback"))}, ${operation("callbackShape(increment, 41)")}, 42);
    ${typed ? "" : "measure(" + JSON.stringify(builtinControl("callback")) + ", () => apply(increment, undefined, applied), 42);"}
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
function distribution(samples: readonly number[]) {
  const sorted = samples.slice().sort((left, right) => left - right);
  function percentile(p: number): number {
    const index = (sorted.length - 1) * p;
    const lower = sorted[Math.floor(index)],
      upper = sorted[Math.ceil(index)];
    if (lower === undefined || upper === undefined)
      throw Error("empty benchmark sample");
    return lower + (upper - lower) * (index - Math.floor(index));
  }
  return {
    median: percentile(0.5),
    q1: percentile(0.25),
    q3: percentile(0.75),
  };
}

interface PairedRound {
  readonly call: number;
  readonly control: number;
  readonly overhead: number;
  readonly shape: number;
  readonly own: number;
  /** Present for engines that ran the built-in twins. */
  readonly builtin?: number;
  readonly overBuiltin?: number;
}

function casePairs(
  samples: readonly Measurement[],
  name: string,
  iterations: number,
  rounds: number,
): PairedRound[] {
  const byRound = (label: string) =>
    new Map(
      samples
        .filter((sample) => sample.case === label)
        .map((sample) => [sample.round, sample.milliseconds]),
    );
  const cases = byRound(name),
    controls = byRound(controlCase),
    shapes = byRound(shapeControl(name)),
    builtins = byRound(builtinControl(name));
  if (
    cases.size !== rounds ||
    controls.size !== rounds ||
    shapes.size !== rounds ||
    (builtins.size !== 0 && builtins.size !== rounds)
  )
    throw Error("incomplete paired samples");
  const scale = 1e6 / iterations;
  return Array.from({ length: rounds }, (_, round) => {
    const call = cases.get(round),
      control = controls.get(round),
      shape = shapes.get(round);
    if (call === undefined || control === undefined || shape === undefined)
      throw Error("missing case or control for round " + round);
    const builtin = builtins.get(round);
    return builtin === undefined
      ? {
          call: call * scale,
          control: control * scale,
          overhead: (call - control) * scale,
          shape: shape * scale,
          own: (call - shape) * scale,
        }
      : {
          call: call * scale,
          control: control * scale,
          overhead: (call - control) * scale,
          shape: shape * scale,
          own: (call - shape) * scale,
          builtin: builtin * scale,
          overBuiltin: (call - builtin) * scale,
        };
  });
}

export function caseTiming(
  samples: readonly Measurement[],
  name: string,
  iterations: number,
  rounds: number,
) {
  const pairs = casePairs(samples, name, iterations, rounds);
  return {
    callNs: distribution(pairs.map(({ call }) => call)).median,
    controlNs: distribution(pairs.map(({ control }) => control)).median,
    overheadNs: distribution(pairs.map(({ overhead }) => overhead)),
    shapeNs: distribution(pairs.map(({ shape }) => shape)).median,
    ownNs: distribution(pairs.map(({ own }) => own)),
    ...builtinTiming(pairs),
  };
}

function builtinTiming(pairs: readonly PairedRound[]) {
  const builtin: number[] = [],
    over: number[] = [];
  for (const pair of pairs) {
    if (pair.builtin === undefined || pair.overBuiltin === undefined) return {};
    builtin.push(pair.builtin);
    over.push(pair.overBuiltin);
  }
  return {
    builtinNs: distribution(builtin).median,
    overBuiltinNs: distribution(over),
  };
}

export function pairedCaseComparison(
  candidate: readonly PairedRound[],
  reference: readonly PairedRound[],
) {
  if (candidate.length !== reference.length)
    throw Error("unmatched benchmark rounds");
  function change(metric: "call" | "overhead" | "own") {
    return distribution(
      candidate.map((value, round) => {
        const before = reference[round];
        if (before === undefined)
          throw Error("missing reference for round " + round);
        return value[metric] - before[metric];
      }),
    );
  }
  const overheadNs = change("overhead"),
    callNs = change("call"),
    ownNs = change("own");
  const overBuiltin: number[] = [];
  for (let round = 0; round < candidate.length; round++) {
    const after = candidate[round]?.overBuiltin,
      before = reference[round]?.overBuiltin;
    if (after === undefined || before === undefined) break;
    overBuiltin.push(after - before);
  }
  const overBuiltinNs =
    overBuiltin.length === candidate.length && overBuiltin.length !== 0
      ? distribution(overBuiltin)
      : undefined;
  return {
    overheadNs,
    callNs,
    ownNs,
    parity: overheadNs.median <= 0 && callNs.median <= 0,
    /** The FFI boundary costs no more than Node's over each engine's own
     * same-shape JavaScript call. */
    ownParity: ownNs.median <= 0,
    ...(overBuiltinNs === undefined
      ? {}
      : {
          overBuiltinNs,
          /** The same comparison over each engine's built-in twin. */
          builtinParity: overBuiltinNs.median <= 0,
        }),
  };
}

export function roundOrder<T>(workloads: readonly T[], round: number): T[] {
  const first = round % workloads.length;
  return [...workloads.slice(first), ...workloads.slice(0, first)];
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
    const milliseconds = Number(match[2]),
      checksum = Number(match[3]);
    if (
      !Number.isFinite(milliseconds) ||
      milliseconds <= 0 ||
      checksum !== iterations * expectedChecksum(name) ||
      (name !== controlCase &&
        !measuredCases.includes(name) &&
        !shapeControls.includes(name) &&
        !builtinControls.includes(name))
    )
      throw Error("invalid benchmark sample for " + name);
    values.push({ case: name, round, milliseconds, checksum });
  }
  const required = measuredCases.length + shapeControls.length + 1;
  if (
    (values.length !== required &&
      values.length !== required + builtinControls.length) ||
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
  readonly target: NativeArtifact["target"];
  readonly iterations: number;
  readonly warm: number;
  readonly artifacts: Readonly<Partial<Record<TintEngine, NativeArtifact>>>;
  readonly label?: string;
  readonly sourcePatchSha256?: string;
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
  return prepareImages(
    {
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
      artifacts: {},
    },
    tintEngines,
  );
}

function prepareImages(
  prepared: PreparedBenchmark,
  engines: readonly TintEngine[],
  label?: string,
): PreparedBenchmark {
  const { dso, iterations, warm, target } = prepared;
  process.env.TZ = "UTC";
  process.env.TINT_BUILD_ONLY = "defer-admission";
  delete process.env.TINT_GENERAL_FALLBACK;
  const clock = "packages/native-runtime/src/intrinsics/clock.ts";
  function build(engine: TintEngine): NativeArtifact {
    const literal = engine.endsWith("Literal");
    const typed = engine.startsWith("tintTyped");
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
    ...prepared,
    head: execute("git", ["rev-parse", "HEAD"]),
    sourcePatchSha256: createHash("sha256")
      .update(execute("git", ["diff", "--binary", "HEAD", "--", "packages"]))
      .digest("hex"),
    ...(label === undefined ? {} : { label }),
    artifacts: Object.fromEntries(
      engines.map((engine) => [engine, build(engine)]),
    ),
  };
}

function readPrepared(path: string): PreparedBenchmark {
  return JSON.parse(readFileSync(path, "utf8")) as PreparedBenchmark;
}

type Workload = {
  name: string;
  engine?: TintEngine;
  artifact?: NativeArtifact;
};

function runWorkload(
  prepared: PreparedBenchmark,
  workload: Workload,
  round: number,
) {
  const before = cpuTimes();
  const loadBefore = loadavg();
  let output: string;
  let native: NativeResult | undefined;
  if (workload.artifact === undefined) {
    output = execute(prepared.node, [prepared.benchmark]);
  } else {
    [native] = runNativeBatch([
      { artifact: workload.artifact, timeoutMs: 120000 },
    ]);
    if (native?.kind !== "exited" || native.status !== 42)
      throw Error(
        `${workload.name} did not exit 42: ${JSON.stringify(native)}`,
      );
    output = native.stdout;
  }
  return {
    telemetry: {
      workload: workload.name,
      idle: cpuIdlePercent(before, cpuTimes()),
      loadBefore,
      loadAfter: loadavg(),
    },
    samples: parse(output, round, prepared.iterations),
    native,
  };
}

function writeReport(file: string, report: unknown): void {
  writeFileSync(resolve(file), JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
}

function verifyPrepared(prepared: PreparedBenchmark): void {
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
}

function measure(
  prepared: PreparedBenchmark,
  file: string,
  candidates: PreparedBenchmark[] = [],
): void {
  verifyPrepared(prepared);
  const workloads: Workload[] = [{ name: "node" }];
  for (const engine of tintEngines) {
    const artifact = prepared.artifacts[engine];
    if (artifact === undefined)
      throw Error("missing baseline workload " + engine);
    workloads.push({ name: engine, engine, artifact });
  }
  const labels = new Set<string>();
  for (const candidate of candidates) {
    verifyPrepared(candidate);
    const label = candidate.label;
    if (
      label === undefined ||
      !/^[a-z][a-z0-9-]*$/.test(label) ||
      labels.has(label)
    )
      throw Error("candidate requires a unique label");
    if (
      candidate.target !== prepared.target ||
      candidate.nodeSha256 !== prepared.nodeSha256 ||
      candidate.sourceSha256 !== prepared.sourceSha256 ||
      candidate.dso !== prepared.dso ||
      candidate.dsoSha256 !== prepared.dsoSha256 ||
      candidate.iterations !== prepared.iterations ||
      candidate.warm !== prepared.warm
    )
      throw Error("candidate must share the baseline benchmark inputs");
    labels.add(label);
    for (const engine of tintEngines) {
      const artifact = candidate.artifacts[engine];
      if (artifact !== undefined)
        workloads.push({ name: label + "." + engine, engine, artifact });
    }
  }

  const timingLock =
    process.env.TINT_FFI_BENCH_TIMING_LOCK ??
    join(homedir(), ".t3", "tint-timing.lock");
  // Complete rotations give each workload the same number of starts in every position.
  const rounds = Math.ceil(15 / workloads.length) * workloads.length;
  const results = new Map(
    workloads.map(({ name }) => [name, [] as Measurement[]]),
  );
  const host: {
    round: number;
    launches: ReturnType<typeof runWorkload>["telemetry"][];
  }[] = [];
  const native: { round: number; workload: string; result: NativeResult }[] =
    [];
  withGateLock([timingLock], "node-ffi-benchmark", undefined, () => {
    for (let round = 0; round < rounds; round++) {
      const launches: ReturnType<typeof runWorkload>["telemetry"][] = [];
      for (const workload of roundOrder(workloads, round)) {
        const trial = runWorkload(prepared, workload, round);
        results.get(workload.name)?.push(...trial.samples);
        launches.push(trial.telemetry);
        if (trial.native !== undefined)
          native.push({ round, workload: workload.name, result: trial.native });
      }
      host.push({ round, launches });
      console.error(`Finished interleaved round ${round + 1}/${rounds}`);
    }
  });
  const cases = measuredCases.map((name) => {
    const timing = Object.fromEntries(
      workloads.map(({ name: workload }) => [
        workload,
        caseTiming(
          results.get(workload) ?? [],
          name,
          prepared.iterations,
          rounds,
        ),
      ]),
    );
    const pairs = (workload: string) =>
      casePairs(results.get(workload) ?? [], name, prepared.iterations, rounds);
    const node = pairs("node");
    const comparisons = Object.fromEntries(
      workloads.flatMap(({ name: workload, engine }) => {
        if (engine === undefined) return [];
        const paired = pairs(workload);
        const versusNode = pairedCaseComparison(paired, node);
        const versusBaseline =
          workload === engine
            ? undefined
            : pairedCaseComparison(paired, pairs(engine));
        return [
          [
            workload,
            {
              versusNodeNs: versusNode.overheadNs,
              totalVersusNodeNs: versusNode.callNs,
              ownVersusNodeNs: versusNode.ownNs,
              ...(versusNode.overBuiltinNs === undefined
                ? {}
                : {
                    overBuiltinVersusNodeNs: versusNode.overBuiltinNs,
                    builtinParity: versusNode.builtinParity,
                  }),
              parity: versusNode.parity,
              ownParity: versusNode.ownParity,
              ...(versusBaseline === undefined
                ? {}
                : {
                    versusBaselineNs: versusBaseline.overheadNs,
                    totalVersusBaselineNs: versusBaseline.callNs,
                    ownVersusBaselineNs: versusBaseline.ownNs,
                  }),
            },
          ],
        ];
      }),
    );
    const typedParity =
      comparisons.tintTypedLiteral?.parity === true &&
      comparisons.tintTypedRuntime?.parity === true;
    const ownParity = tintEngines.every(
      (engine) => comparisons[engine]?.ownParity === true,
    );
    return { case: name, timing, comparisons, typedParity, ownParity };
  });
  writeReport(file, {
    ...prepared,
    candidates,
    cpu: cpus()[0]?.model,
    rounds,
    timingLock,
    host,
    native,
    results: Object.fromEntries(results),
    cases,
  });
  if (
    process.env.TINT_FFI_BENCH_REQUIRE_PARITY === "1" &&
    cases.some((sample) => !sample.typedParity)
  )
    process.exitCode = 2;
}

if (import.meta.main) {
  const [command, destination, optional, ...more] = process.argv.slice(2);
  if (
    command === "--measure" &&
    destination !== undefined &&
    optional !== undefined
  ) {
    measure(readPrepared(destination), optional, more.map(readPrepared));
  } else if (
    command === "--prepare-candidate" &&
    destination !== undefined &&
    optional !== undefined
  ) {
    const [label, ...requested] = more;
    if (
      label === undefined ||
      !/^[a-z][a-z0-9-]*$/.test(label) ||
      requested.length === 0 ||
      new Set(requested).size !== requested.length ||
      !requested.every((engine): engine is TintEngine =>
        tintEngines.some((known) => known === engine),
      )
    )
      throw Error(
        "usage: --prepare-candidate BASE_JSON NEW_JSON LABEL TINT_ENGINE...",
      );
    const prepared = readPrepared(destination);
    verifyPrepared(prepared);
    writeReport(optional, prepareImages(prepared, requested, label));
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
