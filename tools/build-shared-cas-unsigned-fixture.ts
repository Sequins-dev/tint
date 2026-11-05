import { verifyHostedFixture } from "./hosted-fixture.ts";
import type { NativeHostBinding } from "@tint/compiler/native";

// This builder deliberately cannot launch a native process.
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("shared unsigned CAS fixture requires TINT_BUILD_ONLY=1");
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const module = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const hostBindings: readonly NativeHostBinding[] = [
  {
    module,
    name: "compareExchangeSharedUnsigned",
    operation: "shared-compare-exchange-unsigned",
  },
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
import { compareExchangeSharedUnsigned, readSharedUnsigned, writeSharedUnsigned, readSharedWord64, writeSharedWord64, compareExchangeSharedWord64 } from 'shared';
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
  // Original Word64 regression checks above run unchanged before the new matrix.
  for (let width = 1; width <= 4; width *= 2) {
    const maximum = width === 1 ? 255 : width === 2 ? 65535 : 4294967295;
    const offset = width; // nonzero, naturally aligned subwords
    for (let byte = 0; byte < 16; byte++) {
      if (writeSharedUnsigned(address, 128, byte, 1, 165, 1) !== 0) return 31;
    }
    if (writeSharedUnsigned(address, 128, offset, width, maximum, 1) !== 0) return 32;
    if (compareExchangeSharedUnsigned(address, 128, offset, width, maximum, 1) !== maximum) return 33;
    if (readSharedUnsigned(address, 128, offset, width, 1) !== 1) return 34;
    if (compareExchangeSharedUnsigned(address, 128, offset, width, maximum, 0) !== 1) return 35;
    if (readSharedUnsigned(address, 128, offset, width, 1) !== 1) return 36;
    if (compareExchangeSharedUnsigned(address, 128, offset, width, 1, 1) !== 1) return 37;
    if (compareExchangeSharedUnsigned(address, 128, offset, width, 1, maximum) !== 1) return 38;
    if (readSharedUnsigned(address, 128, offset, width, 1) !== maximum) return 39;
    if (readSharedUnsigned(address, 128, offset - 1, 1, 1) !== 165) return 40;
    if (readSharedUnsigned(address, 128, offset + width, 1, 1) !== 165) return 41;
    if (compareExchangeSharedUnsigned(address, 128, offset, width, maximum + 1, 0) !== -1) return 43;
    if (compareExchangeSharedUnsigned(address, 128, offset, width, 0, maximum + 1) !== -1) return 44;
    if (compareExchangeSharedUnsigned(address, 128, offset, width, -1, 0) !== -1) return 45;
    if (compareExchangeSharedUnsigned(address, 128, offset, width, 0, -1) !== -1) return 46;
    if (compareExchangeSharedUnsigned(address, 128, offset, width, 0.5, 0) !== -1) return 47;
    if (compareExchangeSharedUnsigned(address, 128, offset, width, 0, 0.5) !== -1) return 48;
    if (readSharedUnsigned(address, 128, offset, width, 1) !== maximum) return 49;
  }
  if (compareExchangeSharedUnsigned(0, 128, 0, 1, 0, 1) !== -1) return 50;
  if (compareExchangeSharedUnsigned(address, 128, 0, 3, 0, 1) !== -1) return 51;
  if (compareExchangeSharedUnsigned(address, 128, 0, 8, 0, 1) !== -1) return 52;
  if (compareExchangeSharedUnsigned(address, 128, 1, 2, 0, 1) !== -1) return 53;
  if (compareExchangeSharedUnsigned(address, 128, 128, 1, 0, 1) !== -1) return 54;
  if (compareExchangeSharedUnsigned(address, 1, 0, 2, 0, 1) !== -1) return 55;
  if (compareExchangeSharedUnsigned(address, 128, -1, 1, 0, 1) !== -1) return 56;
  if (compareExchangeSharedUnsigned(address, 128, 0.5, 1, 0, 1) !== -1) return 57;
  if (compareExchangeSharedUnsigned(address, 128, 0, 1, 0 / 0, 0) !== -1) return 58;
  if (compareExchangeSharedUnsigned(address, 128, 0, 1, 0, 1 / 0) !== -1) return 59;
  if (compareExchangeSharedUnsigned(9007199254740984, 16, 0, 4, 0, 1) !== -1) return 60;
  if (compareExchangeSharedUnsigned(address, 9007199254740992, 0, 1, 0, 1) !== -1) return 61;
  if (compareExchangeSharedUnsigned(address, 128, 0, -1, 0, 1) !== -1) return 62;
  if (unmapMemory(address, 128) !== 0) return 63;
  return 42;
}
`,
  "shared-cas-unsigned-v1",
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
