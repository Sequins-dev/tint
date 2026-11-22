// Builds one Worker-performance image (docs/results/worker-runtime-baseline-v1.md):
//   TINT_BUILD_ONLY=1 node tools/worker-bench/build-native.ts <variant>
// Variants:
//   plain      kernels in a program without Workers (the project collector)
//   copying    the same program with the copying collector (attribution)
//   raw        kernels plus a node:zlib kernel (C calls, external storage)
//   main       kernels on the main thread of a program that starts a Worker
//   worker     kernels inside a Worker of that program
//   typed-transport  typed round trips, batches, strings and wakes
//   transport  message passing, shared memory and startup workloads
//              (an optional second argument selects one operation prefix)
// Prints the image path (from the hosted fixture builder). Run images under
// LLDB through tools/worker-bench/measure.ts.
import { readFileSync } from "node:fs";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import type { SourceModule } from "@tint/typescript/modules/model";
import { verifyHostedFixture } from "../hosted-fixture.ts";
import {
  workerFixtureOptions,
  workerFixtureRuntimes,
} from "../worker-fixture-options.ts";
import { kernelNames, kernelScale, runKernel } from "./kernels.ts";
import { rawKernelNames, rawKernelScale, runRawKernel } from "./raw-kernels.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("Worker benchmarks are measured outside the builder");
const variant = process.argv[2] ?? "";
if (
  ![
    "plain",
    "copying",
    "raw",
    "main",
    "worker",
    "transport",
    "typed-transport",
  ].includes(variant)
)
  throw Error("unknown Worker benchmark variant " + variant);
// Measurements of typed variants must be of typed code.
if (variant !== "transport") process.env.TINT_GENERAL_FALLBACK = "0";

const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const threads = "node:worker_threads";
const prefix = "worker-bench/";
function local(
  file: string,
  dependencies: readonly (readonly [string, string])[],
): SourceModule {
  const text = readFileSync(new URL("./" + file, import.meta.url), "utf8");
  const parsed = parseModule(createSourceTextView(text));
  if (!parsed.ok) throw Error(file + ": " + JSON.stringify(parsed.error));
  return {
    id: prefix + file,
    module: parsed.value,
    dependencies: new Map(dependencies),
  };
}
const kernels = local("kernels.ts", []);
const inline = local("inline.ts", [["./kernels.ts", kernels.id]]);
const clockBinding = {
  module: clock,
  name: "monotonicMilliseconds",
  operation: "monotonic-time" as const,
};
const clockRuntime = {
  module: clock,
  namespace: "worker-bench-clock",
  retainedExports: ["monotonicMilliseconds"],
};
// Heap, descriptor and stack sizes are equal in every variant (and for each
// Worker, whose heap takes the image's managed size).
const sizes = {
  managedBytes: 268435456,
  allocationCapacity: 8388608,
  rootCapacity: 65536,
  stackBytes: 8388608,
};
// Checksums from the build host; every native and Node run must match them.
function checksums(
  names: readonly string[],
  scaleOf: (name: string) => number,
  run: (name: string, scale: number) => number,
): string {
  return (
    "[" + names.map((name) => String(run(name, scaleOf(name)))).join(",") + "]"
  );
}
const expected = checksums(kernelNames, kernelScale, runKernel);

if (variant === "plain" || variant === "copying") {
  verifyHostedFixture(
    `import { monotonicMilliseconds } from "clock";
import { runKernelsInline } from "./inline.ts";
const expected: readonly number[] = ${expected};
export function run(): number {
  return runKernelsInline("${variant}", (): number => monotonicMilliseconds(), expected);
}`,
    "worker-bench-" + variant,
    [
      ["clock", clock],
      ["./inline.ts", inline.id],
    ],
    [kernels, inline],
    [],
    [clockRuntime],
    {
      ...sizes,
      requireTyped: true,
      hostBindings: [clockBinding],
      ...(variant === "copying"
        ? { runtimeEntry: "initializeCopyingRuntime" as const }
        : {}),
    },
  );
} else if (variant === "raw") {
  const zlib = "packages/native-runtime/src/node/zlib.ts";
  const rawKernels = local("raw-kernels.ts", [
    ["node:zlib", zlib],
    ["./kernels.ts", kernels.id],
  ]);
  verifyHostedFixture(
    `import { monotonicMilliseconds } from "clock";
import { runKernelList } from "./inline.ts";
import { rawKernelNames, rawKernelScale, runRawKernel } from "./raw-kernels.ts";
const expected: readonly number[] = ${checksums(rawKernelNames(), rawKernelScale, runRawKernel)};
export function run(): number {
  return runKernelList("raw", (): number => monotonicMilliseconds(), expected,
    rawKernelNames(), (name: string): number => rawKernelScale(name),
    (name: string, scale: number): number => runRawKernel(name, scale));
}`,
    "worker-bench-raw",
    [
      ["clock", clock],
      ["./inline.ts", inline.id],
      ["./raw-kernels.ts", rawKernels.id],
      // Listed here too so the workspace loader includes zlib's module graph.
      ["node:zlib", zlib],
    ],
    [kernels, inline, rawKernels],
    [],
    [clockRuntime],
    { ...sizes, requireTyped: true, hostBindings: [clockBinding] },
  );
} else if (variant === "main" || variant === "worker") {
  const peer = local("peer.ts", [
    [threads, threads],
    ["./kernels.ts", kernels.id],
  ]);
  const placements = local("placements.ts", [
    [threads, threads],
    ["./kernels.ts", kernels.id],
    ["./inline.ts", inline.id],
  ]);
  const start =
    variant === "main" ? "runKernelsBesideWorker" : "runKernelsInWorker";
  verifyHostedFixture(
    `import { monotonicMilliseconds } from "clock";
import { ${start} } from "./placements.ts";
const expected: readonly number[] = ${expected};
export function run(): number {
  ${start}("${peer.id}", (): number => monotonicMilliseconds(), expected, (status: number): void => {
    if (status !== 42) throw "kernel placement failed with " + String(status);
  });
  return 42;
}`,
    "worker-bench-" + variant,
    [
      ["clock", clock],
      ["./placements.ts", placements.id],
    ],
    [kernels, inline, placements, peer],
    [],
    workerFixtureRuntimes,
    {
      ...workerFixtureOptions([peer.id]),
      ...sizes,
      requireTyped: true,
    },
  );
} else if (variant === "typed-transport") {
  const peer = local("typed-transport-peer.ts", [[threads, threads]]);
  const typed = local("typed-transport.ts", [[threads, threads]]);
  verifyHostedFixture(
    `import { monotonicMilliseconds } from "clock";
import { runTypedTransport } from "./typed-transport.ts";
export function run(): number {
  runTypedTransport("${peer.id}", (): number => monotonicMilliseconds(), (status: number): void => {
    if (status !== 42) throw "typed transport failed with " + String(status);
  });
  return 42;
}`,
    "worker-bench-typed-transport",
    [
      ["clock", clock],
      ["./typed-transport.ts", typed.id],
    ],
    [typed, peer],
    [],
    workerFixtureRuntimes,
    {
      ...workerFixtureOptions([peer.id]),
      ...sizes,
      requireTyped: true,
      // The Worker entry must be typed too.
      onGeneralFallback: (modules: readonly string[], reason: string): void => {
        throw Error(
          "general fallback for " + modules.join(", ") + ": " + reason,
        );
      },
    },
  );
} else {
  // An optional operation prefix restricts the workload (for profiles).
  const only = process.argv[3];
  const transport = local("transport.mjs", [[threads, threads]]);
  verifyHostedFixture(
    `import { run as benchmark } from "./transport.mjs";
import { monotonicMilliseconds } from "clock";
export function run(): unknown { return benchmark("${transport.id}", monotonicMilliseconds${only === undefined ? "" : ", " + JSON.stringify(only)}); }`,
    "worker-bench-transport",
    [
      ["./transport.mjs", transport.id],
      ["clock", clock],
    ],
    [transport],
    [],
    workerFixtureRuntimes,
    {
      ...workerFixtureOptions([transport.id]),
      ...sizes,
    },
  );
}
