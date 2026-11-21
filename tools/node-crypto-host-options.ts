import type { NativeHostBinding, RuntimeSource } from "@tint/compiler/native";

const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const bindings = [
  [clock, "monotonicMilliseconds", "monotonic-time"],
  [memory, "mapMemory", "memory-map"],
  [memory, "unmapMemory", "memory-unmap"],
  [memory, "startNativeThread", "thread-start"],
  [memory, "joinNativeThread", "thread-join"],
  [memory, "hostedThreadEntry", "hosted-thread-entry"],
  [memory, "parkNativeWord", "word-park"],
  [memory, "wakeNativeWord", "word-wake"],
  [shared, "readSharedUnsigned", "shared-read-unsigned"],
  [shared, "writeSharedUnsigned", "shared-write-unsigned"],
  [shared, "readSharedWord64", "shared-read-word64"],
  [shared, "writeSharedWord64", "shared-write-word64"],
  [shared, "compareExchangeSharedWord64", "shared-compare-exchange-word64"],
] as const;

export const cryptoHostBindings: readonly NativeHostBinding[] = bindings
  .filter(([module]) => module !== clock)
  .map(([module, name, operation]) => ({ module, name, operation }));
export const cryptoHostRuntimes: readonly RuntimeSource[] = [
  {
    module: shared,
    namespace: "crypto-blocking-pool",
    retainedExports: bindings
      .filter(([module]) => module === shared)
      .map(([, name]) => name),
  },
];
