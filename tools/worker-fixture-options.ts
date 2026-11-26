import type { NativeHostBinding } from "@tint/compiler/native";

const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const packet = "packages/native-runtime/src/intrinsics/packet-memory.ts";
const shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const strings = "packages/native-runtime/src/intrinsics/shared-strings.ts";
const bindings: readonly NativeHostBinding[] = [
  { module: memory, name: "mapMemory", operation: "memory-map" },
  { module: memory, name: "unmapMemory", operation: "memory-unmap" },
  { module: memory, name: "parkNativeWord", operation: "word-park" },
  { module: memory, name: "wakeNativeWord", operation: "word-wake" },
  { module: memory, name: "startNativeThread", operation: "thread-start" },
  // The identity page recording the isolate's shared block registry
  // (shared-buffers.ts).
  {
    module: memory,
    name: "currentContextDomain",
    operation: "context-domain",
  },
  // Message packets (packet-memory.ts).
  {
    module: packet,
    name: "readMemoryFloat64",
    operation: "memory-read-float64",
  },
  {
    module: packet,
    name: "writeMemoryFloat64",
    operation: "memory-write-float64",
  },
  {
    module: packet,
    name: "readMemoryString",
    operation: "memory-read-string",
  },
  {
    module: packet,
    name: "writeMemoryString",
    operation: "memory-write-string",
  },
  // Shared string bodies (shared-strings.ts).
  { module: strings, name: "stringAddress", operation: "string-address" },
  { module: strings, name: "stringAt", operation: "string-at" },
  { module: strings, name: "copyString", operation: "string-copy" },
  { module: memory, name: "isFlatString", operation: "string-flat" },
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

const sharedMemoryRuntime = {
  module: shared,
  namespace: "worker-threads-shared-memory",
  retainedExports: bindings
    .filter((binding) => binding.module === shared)
    .map((binding) => binding.name),
};
// Typed `new SharedArrayBuffer` (the isolate's shared block service).
const sharedBufferRuntime = {
  module: "packages/native-runtime/src/shared-buffers.ts",
  namespace: "native-shared-buffer",
};
// Message packets' raw-window accesses (packet-memory.ts).
const packetMemoryRuntime = {
  module: packet,
  namespace: "native-packet-memory",
  retainedExports: bindings
    .filter((binding) => binding.module === packet)
    .map((binding) => binding.name),
};
// Shared string bodies' address, view and copy operations.
const sharedStringRuntime = {
  module: strings,
  namespace: "native-shared-strings",
  retainedExports: bindings
    .filter((binding) => binding.module === strings)
    .map((binding) => binding.name),
};
const clockRuntime = {
  module: clock,
  namespace: "native-clock",
  retainedExports: ["monotonicMilliseconds"],
};
export const workerFixtureRuntimes = [
  sharedMemoryRuntime,
  sharedBufferRuntime,
  packetMemoryRuntime,
  sharedStringRuntime,
];

/** A program without Workers whose typed code creates SharedArrayBuffers:
 * the shared buffer runtime and the memory and atomic leaves its isolate's
 * shared block service binds. */
export const sharedBufferFixtureRuntimes = [
  sharedMemoryRuntime,
  sharedBufferRuntime,
  clockRuntime,
  {
    module: memory,
    namespace: "native-shared-buffer-memory",
    retainedExports: [
      "mapMemory",
      "unmapMemory",
      "parkNativeWord",
      "wakeNativeWord",
      "currentContextDomain",
    ],
  },
];
export const sharedBufferHostBindings: readonly NativeHostBinding[] = [
  ...bindings.filter(
    (binding) =>
      binding.module === shared ||
      binding.operation === "memory-map" ||
      binding.operation === "memory-unmap" ||
      binding.operation === "word-park" ||
      binding.operation === "word-wake" ||
      binding.operation === "context-domain",
  ),
  { module: clock, name: "monotonicMilliseconds", operation: "monotonic-time" },
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
