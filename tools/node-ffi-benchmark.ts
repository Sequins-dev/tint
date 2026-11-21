/** Compare the public FFI API on one target with one workload and one DSO. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { withGateLock } from "./gate/lock.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";
import {
  nativeArtifact,
  runNativeBatch,
  type NativeResult,
} from "./native-target-runner.ts";

const [nodePath, reportPath, iterationText] = process.argv.slice(2);
const iterations = Number(iterationText ?? "100000");
if (
  nodePath === undefined ||
  reportPath === undefined ||
  !Number.isSafeInteger(iterations) ||
  iterations < 1
)
  throw Error(
    "usage: node tools/node-ffi-benchmark.ts NODE_V26_13_1 NEW_REPORT_JSON [iterations]",
  );
const node = resolve(nodePath);
const work = mkdtempSync(join(tmpdir(), "tint-node-ffi-bench-"));
const target = nativeFixtureTarget().name;
const darwin = target === "darwin-aarch64";
if (
  process.platform !== (darwin ? "darwin" : "linux") ||
  process.arch !== (target === "linux-x86_64" ? "x64" : "arm64")
)
  throw Error("build and measure both engines on the same target host");

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
if (execute(node, ["--version"]) !== "v26.13.1")
  throw Error("expected Node v26.13.1");

const arities = [0, 1, 2, 4, 8, 12, 24];
const measuredCases = [
  ...arities.map((arity) => "arity-" + arity),
  "buffer",
  "callback",
];
const controlCase = "js-only-control";
const scalar = arities
  .map((arity) => {
    const parameters = Array.from({ length: arity }, (_, i) => "a" + i);
    return (
      "int32_t bench_" +
      arity +
      "(" +
      (parameters.length === 0
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

const definitions = Object.fromEntries([
  ...arities.map((arity) => [
    "bench_" + arity,
    { arguments: Array.from({ length: arity }, () => "i32"), return: "i32" },
  ]),
  ["bench_callback", { arguments: ["function", "i32"], return: "i32" }],
  ["bench_buffer", { arguments: ["buffer"], return: "i32" }],
]);
const scalarCases = arities
  .map(
    (arity) =>
      "measure('arity-" +
      arity +
      "', () => f" +
      arity +
      "(" +
      Array.from({ length: arity }, () => "1").join(",") +
      "), " +
      (arity + 1) +
      ");",
  )
  .join("\n");
const setupScalars = arities
  .map((arity) => "const f" + arity + " = functions.bench_" + arity + ";")
  .join("\n");
const rounds = 9,
  warm = Math.min(20000, iterations);

function body(literal: boolean): string {
  const open =
    "dlopen(" +
    JSON.stringify(dso) +
    ", " +
    (literal ? JSON.stringify(definitions) : "definitions") +
    ")";
  return `
export function run() {
  ${literal ? "" : "const definitions = " + JSON.stringify(definitions) + ";"}
  const { lib, functions } = ${open};
  ${setupScalars}
  function measure(name, operation, expected) {
    let sum = 0;
    for (let i = 0; i < ${warm}; i++) sum += operation();
    if (sum !== ${warm} * expected) throw Error(name + " warmup checksum " + sum);
    sum = 0;
    const start = now();
    for (let i = 0; i < ${iterations}; i++) sum += operation();
    const elapsed = now() - start;
    if (sum !== ${iterations} * expected) throw Error(name + " checksum " + sum);
    console.log("TINT_FFI_BENCH " + name + " " + elapsed + " " + sum);
  }
  try {
    ${scalarCases}
    const bytes = Buffer.from([42]);
    const bufferCall = functions.bench_buffer;
    measure("buffer", () => bufferCall(bytes), 42);
    const callback = lib.registerCallback({ arguments: ["i32"], return: "i32" }, (value) => value + 1);
    const callbackCall = functions.bench_callback;
    measure("callback", () => callbackCall(callback, 41), 42);
    measure(${JSON.stringify(controlCase)}, () => 42, 42);
  } finally { lib.close(); }
  return 42;
}
`;
}

const benchmark = join(work, "benchmark.mjs");
writeFileSync(
  benchmark,
  `
import { dlopen } from "node:ffi";
import { Buffer } from "node:buffer";
const now = () => Number(process.hrtime.bigint()) / 1e6;
${body(true)}
if (run() !== 42) process.exitCode = 1;
`,
);

process.env.TZ = "UTC";
process.env.TINT_BUILD_ONLY = "1";
const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const artifacts = [true, false].map((literal) => {
  const image = verifyHostedFixture(
    `import { dlopen } from "node:ffi";
import { Buffer } from "node:buffer";
import { monotonicMilliseconds as now } from "clock";
${body(literal)}`,
    literal ? "node-ffi-benchmark-literal" : "node-ffi-benchmark-runtime",
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
});
const hashes = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

type Measurement = {
  case: string;
  round: number;
  milliseconds: number;
  checksum: number;
};
function parse(output: string, round: number): Measurement[] {
  const values: Measurement[] = [];
  for (const match of output.matchAll(
    /^TINT_FFI_BENCH ([\w-]+) ([0-9.eE+-]+) (\d+)$/gm,
  )) {
    const name = match[1];
    if (name === undefined) throw Error("benchmark record is missing its name");
    values.push({
      case: name,
      round,
      milliseconds: Number(match[2]),
      checksum: Number(match[3]),
    });
  }
  if (
    values.length !== measuredCases.length + 1 ||
    new Set(values.map((value) => value.case)).size !== values.length ||
    values.some(
      (entry) =>
        !(entry.milliseconds > 0) ||
        (entry.case !== controlCase && !measuredCases.includes(entry.case)),
    )
  )
    throw Error("incomplete benchmark output");
  return values;
}
const engines = ["node", "tintLiteral", "tintRuntime"] as const;
type Engine = (typeof engines)[number];
const results = { node: [], tintLiteral: [], tintRuntime: [] } as Record<
  Engine,
  Measurement[]
>;
const observations: { round: number; engine: Engine; started: string }[] = [];
const native: {
  round: number;
  engine: Engine;
  result: NativeResult | undefined;
}[] = [];
const failures: string[] = [];
const timingLock = process.env.TINT_FFI_BENCH_TIMING_LOCK;
let loadBefore: number[] = [],
  loadAfter: number[] = [];
function measure(): void {
  loadBefore = loadavg();
  for (let round = 0; round < rounds; round++) {
    // Rotate which engine samples first so no engine consistently benefits
    // from the machine state left behind by the preceding run.
    const order = [...engines.slice(round % 3), ...engines.slice(0, round % 3)];
    for (const engine of order) {
      observations.push({ round, engine, started: new Date().toISOString() });
      try {
        let output: string;
        if (engine === "node") output = execute(node, [benchmark]);
        else {
          const artifact = artifacts[engine === "tintLiteral" ? 0 : 1];
          if (artifact === undefined)
            throw Error("missing native benchmark image: " + engine);
          const [result] = runNativeBatch([{ artifact, timeoutMs: 120000 }]);
          native.push({ round, engine, result });
          if (result?.kind !== "exited" || result.status !== 42)
            throw Error("native benchmark did not exit 42: " + result?.kind);
          output = result.stdout;
        }
        results[engine].push(...parse(output, round));
      } catch (error) {
        failures.push(engine + " round " + round + ": " + String(error));
      }
    }
  }
  loadAfter = loadavg();
}
if (timingLock === undefined) measure();
else withGateLock([timingLock], "node-ffi-benchmark", undefined, measure);
function median(engine: Engine, name: string): number | undefined {
  const times = results[engine]
    .filter((sample) => sample.case === name)
    .map((sample) => (sample.milliseconds * 1e6) / iterations)
    .sort((left, right) => left - right);
  return times.length === rounds ? times[Math.floor(rounds / 2)] : undefined;
}
const medians = measuredCases.map((name) => {
  const node = median("node", name),
    tintLiteral = median("tintLiteral", name),
    tintRuntime = median("tintRuntime", name);
  return {
    case: name,
    node,
    tintLiteral,
    tintRuntime,
    parity:
      node !== undefined &&
      tintLiteral !== undefined &&
      tintRuntime !== undefined &&
      tintLiteral <= node &&
      tintRuntime <= node,
  };
});
writeFileSync(
  resolve(reportPath),
  JSON.stringify(
    {
      head: execute("git", ["rev-parse", "HEAD"]),
      iterations,
      warm,
      rounds,
      target,
      cpu: cpus()[0]?.model,
      node: "26.13.1",
      nodeSha256: hashes(node),
      dsoSha256: hashes(dso),
      sourceSha256: hashes(benchmark),
      timingLock,
      loadBefore,
      loadAfter,
      observations,
      native,
      failures,
      results,
      jsControl: {
        node: median("node", controlCase),
        tintLiteral: median("tintLiteral", controlCase),
        tintRuntime: median("tintRuntime", controlCase),
      },
      medians,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
if (failures.length !== 0) process.exitCode = 1;
else if (
  process.env.TINT_FFI_BENCH_REQUIRE_PARITY === "1" &&
  medians.some((sample) => !sample.parity)
)
  process.exitCode = 2;
