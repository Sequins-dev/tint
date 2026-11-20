import { readFileSync } from "node:fs";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import type { NativeHostBinding } from "@tint/compiler/native";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The Worker suite must run under LLDB on native Tint");
const target = nativeFixtureTarget();
const nodeHosted = process.env.TINT_NODE_HOSTED_WORKERS === "1";
const moduleId = "worker-threads-suite.mjs";
const suite = readFileSync(
  new URL("./worker-threads-suite.mjs", import.meta.url),
  "utf8",
);
const parsed = parseModule(createSourceTextView(suite));
if (!parsed.ok) throw Error(JSON.stringify(parsed.error));

const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const bindings: readonly NativeHostBinding[] = [
  { module: memory, name: "mapMemory", operation: "memory-map" },
  { module: memory, name: "unmapMemory", operation: "memory-unmap" },
  { module: memory, name: "parkNativeWord", operation: "word-park" },
  { module: memory, name: "wakeNativeWord", operation: "word-wake" },
  { module: memory, name: "startNativeThread", operation: "thread-start" },
  {
    module: memory,
    name: "hostedThreadEntry",
    operation: "hosted-thread-entry",
  },
  {
    module: shared,
    name: "readSharedUnsigned",
    operation: "shared-read-unsigned",
  },
  {
    module: shared,
    name: "writeSharedUnsigned",
    operation: "shared-write-unsigned",
  },
  { module: shared, name: "readSharedWord64", operation: "shared-read-word64" },
  {
    module: shared,
    name: "writeSharedWord64",
    operation: "shared-write-word64",
  },
  {
    module: shared,
    name: "compareExchangeSharedWord64",
    operation: "shared-compare-exchange-word64",
  },
  {
    module: shared,
    name: "compareExchangeSharedUnsigned",
    operation: "shared-compare-exchange-unsigned",
  },
];
verifyHostedFixture(
  `
import {run as suite} from 'suite';
export function run():unknown { return suite("${moduleId}"); }
`,
  "worker-threads-suite",
  [["suite", moduleId]],
  [
    {
      id: moduleId,
      module: parsed.value,
      dependencies: new Map([["node:worker_threads", "node:worker_threads"]]),
    },
  ],
  [],
  [
    {
      module: shared,
      namespace: "worker-threads-shared-memory",
      retainedExports: bindings
        .filter((binding) => binding.module === shared)
        .map((binding) => binding.name),
    },
  ],
  {
    managedBytes: 33554432,
    allocationCapacity: 524288,
    stackBytes: 16777216,
    threaded: true,
    threadExitPipe: true,
    workerModules: [moduleId],
    nodeWorkers: true,
    nodeWorkerLibrary: nodeHosted,
    runtimeEntry:
      target.arch === "x86_64"
        ? "initializeGenerationalRuntime"
        : "initializeCopyingRuntime",
    hostBindings: bindings,
  },
);
