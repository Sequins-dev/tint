import { verifyHostedFixture } from "./hosted-fixture.ts";
import type { NativeHostBinding } from "@tint/compiler/native";

// This builder deliberately cannot launch a native process.
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("shared primitive fixture requires TINT_BUILD_ONLY=1");
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const module = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const hostBindings: readonly NativeHostBinding[] = [
  { module: memory, name: "mapMemory", operation: "memory-map" },
  { module: memory, name: "unmapMemory", operation: "memory-unmap" },
  { module, name: "readSharedUnsigned", operation: "shared-read-unsigned" },
  { module, name: "writeSharedUnsigned", operation: "shared-write-unsigned" },
  { module, name: "readSharedWord64", operation: "shared-read-word64" },
  { module, name: "writeSharedWord64", operation: "shared-write-word64" },
  {
    module,
    name: "compareExchangeSharedWord64",
    operation: "shared-compare-exchange-word64",
  },
];
verifyHostedFixture(
  `
import { mapMemory, unmapMemory } from 'memory';
import { readSharedUnsigned, writeSharedUnsigned, readSharedWord64, writeSharedWord64, compareExchangeSharedWord64 } from 'shared';
export function run(): number {
  const address = mapMemory(128);
  if (address <= 0) return 1;
  const scratch = new Uint32Array(2);
  const short = new Uint32Array(1);
  for (let order = 0; order < 2; order++) {
    if (writeSharedUnsigned(address, 128, 0, 1, 255, order) !== 0) return 2;
    if (readSharedUnsigned(address, 128, 0, 1, order) !== 255) return 3;
    if (writeSharedUnsigned(address, 128, 2, 2, 65535, order) !== 0) return 4;
    if (readSharedUnsigned(address, 128, 2, 2, order) !== 65535) return 5;
    if (writeSharedUnsigned(address, 128, 4, 4, 4294967295, order) !== 0) return 6;
    if (readSharedUnsigned(address, 128, 4, 4, order) !== 4294967295) return 7;
    if (writeSharedWord64(address, 128, 8, order, 4294967295, 4294967295) !== 0) return 8;
    if (readSharedWord64(address, 128, 8, order, scratch) !== 0) return 9;
    if (scratch[0] !== 4294967295 || scratch[1] !== 4294967295) return 10;
  }
  if (compareExchangeSharedWord64(address, 128, 8, 0, 0, 1, 2147483648, scratch) !== 0) return 11;
  if (scratch[0] !== 4294967295 || scratch[1] !== 4294967295) return 12;
  if (readSharedWord64(address, 128, 8, 1, scratch) !== 0 || scratch[0] !== 4294967295 || scratch[1] !== 4294967295) return 13;
  if (compareExchangeSharedWord64(address, 128, 8, 4294967295, 4294967295, 1, 2147483648, scratch) !== 0) return 14;
  if (scratch[0] !== 4294967295 || scratch[1] !== 4294967295) return 15;
  if (readSharedWord64(address, 128, 8, 1, scratch) !== 0 || scratch[0] !== 1 || scratch[1] !== 2147483648) return 16;
  if (compareExchangeSharedWord64(address, 128, 8, 1, 2147483648, 1, 2147483648, scratch) !== 0) return 17;
  if (readSharedWord64(address, 128, 8, 1, short) !== -1) return 18;
  if (writeSharedUnsigned(address, 128, 1, 4, 123, 0) !== -1) return 19;
  if (readSharedUnsigned(address, 128, 128, 1, 0) !== -1) return 20;
  if (writeSharedUnsigned(address, 128, 0, 3, 123, 0) !== -1) return 21;
  if (writeSharedWord64(address, 128, 0, 0, 4294967296, 0) !== -1) return 22;
  if (readSharedUnsigned(address, 128, 0, 1, 2) !== -1) return 23;
  if (readSharedUnsigned(address, 128, 0.5, 1, 0) !== -1) return 24;
  if (readSharedUnsigned(address, 128, -1, 1, 0) !== -1) return 25;
  if (readSharedUnsigned(address, 128, 0 / 0, 1, 0) !== -1) return 26;
  if (readSharedWord64(address, 128, 1, 0, scratch) !== -1) return 27;
  if (readSharedUnsigned(0, 128, 0, 1, 0) !== -1) return 28;
  if (readSharedWord64(address, 128, 8, 1, scratch) !== 0 || scratch[0] !== 1 || scratch[1] !== 2147483648) return 29;
  if (unmapMemory(address, 128) !== 0) return 30;
  return 42;
}
`,
  "shared-primitives-s1a-authorized-v1",
  [
    ["memory", "packages/native-runtime/src/intrinsics/memory.ts"],
    ["shared", module],
  ],
  [],
  [],
  [
    {
      module: memory,
      namespace: "native-memory",
      retainedExports: ["mapMemory", "unmapMemory"],
    },
    {
      module,
      namespace: "shared-primitives-fixture",
      retainedExports: hostBindings
        .filter((binding) => binding.module === module)
        .map((binding) => binding.name),
    },
  ],
  {
    managedBytes: 4194304,
    allocationCapacity: 65536,
    runtimeEntry: "initializeCopyingRuntime",
    hostBindings,
  },
);
