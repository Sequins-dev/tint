import type { NativeHostBinding } from "@tint/compiler/native";

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

export const workerFixtureRuntimes = [
  {
    module: shared,
    namespace: "worker-threads-shared-memory",
    retainedExports: bindings
      .filter((binding) => binding.module === shared)
      .map((binding) => binding.name),
  },
];

export function workerFixtureOptions(
  workerModules: readonly string[],
  nodeWorkerLibrary = false,
) {
  return {
    managedBytes: 33554432,
    allocationCapacity: 524288,
    stackBytes: 16777216,
    threaded: true,
    threadExitPipe: true,
    workerModules,
    nodeWorkers: true,
    nodeWorkerLibrary,
    // Each isolate initializes its own generational heap
    // (docs/design-worker-runtime.md).
    runtimeEntry: "initializeGenerationalRuntime" as const,
    hostBindings: bindings,
  };
}
