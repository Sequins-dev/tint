// The generational heap's large-object space (docs/memory-and-lifetimes.md,
// "Large objects"): strings and owned numeric typed arrays of at least the
// data threshold live in chunks that collections mark but never copy or
// move. Executed natively under LLDB, each case checked by its exit status:
// - large objects that die young, many more than the space holds, so dead
//   chunks are reused (a fresh typed array must still read as zeros);
// - large objects that survive minor collections (promoted) and majors;
// - large objects referred to from old objects (the barrier and the
//   remembered set) and from young ones;
// - weak keys on large objects: a live one keeps its value, a dead young
//   one clears, and a cleared key never aliases a later object that reuses
//   its chunk.
// A small heap keeps every collection serial; a large one takes the
// parallel evacuator and parallel marking. The copying runtime has no
// large-object space and must run the same program.
import test from "node:test";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const weak = "packages/native-runtime/src/intrinsics/weak.ts",
  memory = "packages/native-runtime/src/intrinsics/memory.ts";
const source = `import {createWeakSlot,weakSlotKey,weakSlotValue} from "weak";
import {collectGarbage} from "memory";
/** Bytes of every large typed array: above the 256 KiB data threshold. */
const LARGE = 300000;
/** Units of every large string (two bytes each). */
const UNITS = 150000;
interface Holder { bytes: Uint8Array; text: string; seed: number; }
let sink: number[][] = [];
/** Small allocations that fill the nursery: minor collections. */
function churn(rounds: number): void {
  for (let round = 0; round < rounds; round++) {
    const values: number[] = [];
    for (let i = 0; i < 512; i++) values.push(round * i);
    sink.push(values);
    if (sink.length > 8) sink = [];
  }
}
/** A large typed array that must read as zeros (even in a reused chunk),
 * with three seeded bytes. */
function bytes(seed: number): Uint8Array {
  const array = new Uint8Array(LARGE);
  for (let i = 0; i < LARGE; i += 4093)
    if (array[i] !== 0) throw new TypeError("a fresh large array is not zeroed");
  array[0] = seed % 256;
  array[LARGE - 1] = (seed * 7) % 256;
  array[LARGE / 2] = (seed * 13) % 256;
  return array;
}
function intactBytes(array: Uint8Array, seed: number): boolean {
  return array.length === LARGE && array[0] === seed % 256 &&
    array[LARGE - 1] === (seed * 7) % 256 && array[LARGE / 2] === (seed * 13) % 256;
}
/** A large string: a seeded letter, doubled past UNITS, cut, then tagged. */
function text(seed: number): string {
  let value = String.fromCharCode(65 + (seed % 26));
  while (value.length < UNITS) value = value + value;
  return value.slice(0, UNITS) + String(seed);
}
function intactText(value: string, seed: number): boolean {
  const tag = String(seed);
  return value.length === UNITS + tag.length &&
    value.charCodeAt(0) === 65 + (seed % 26) &&
    value.charCodeAt(UNITS - 1) === 65 + (seed % 26) &&
    value.slice(UNITS) === tag;
}
/** Large objects that die young: dead chunks return to the space. */
function churnLarge(count: number, base: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) {
    const array = bytes(base + i);
    total += array[0] ?? 0;
    if (i % 4 === 0) total += text(base + i).length;
  }
  return total;
}
function holder(seed: number): Holder {
  return { bytes: bytes(seed), text: text(seed), seed };
}
function intact(entry: Holder | undefined, seed: number): boolean {
  return entry !== undefined && entry.seed === seed &&
    intactBytes(entry.bytes, seed) && intactText(entry.text, seed);
}
export function run(): number {
  // Many more large objects than the space holds, all dead at once.
  if (churnLarge(SCALE * 60, 0) <= 0) return 1;
  // Holders and their large objects survive minors, then a major: old.
  const old: Holder[] = [];
  for (let i = 0; i < 8; i++) old.push(holder(1000 + i));
  churn(SCALE * 256);
  churnLarge(SCALE * 20, 2000);
  collectGarbage();
  for (let i = 0; i < 8; i++) if (!intact(old[i], 1000 + i)) return 2;
  // Old holders now refer to young large objects (barrier, remembered
  // set); young holders too. Then many minors and dead large objects.
  for (let i = 0; i < 8; i++) {
    const entry = old[i];
    if (entry === undefined) return 3;
    entry.bytes = bytes(3000 + i);
    entry.text = text(3000 + i);
    entry.seed = 3000 + i;
  }
  const young: Holder[] = [];
  for (let i = 0; i < 4; i++) young.push(holder(4000 + i));
  churnLarge(SCALE * 40, 5000);
  churn(SCALE * 256);
  for (let i = 0; i < 8; i++) if (!intact(old[i], 3000 + i)) return 4;
  for (let i = 0; i < 4; i++) if (!intact(young[i], 4000 + i)) return 5;
  collectGarbage();
  for (let i = 0; i < 8; i++) if (!intact(old[i], 3000 + i)) return 6;
  // Weak keys on large objects.
  let key: Uint8Array | undefined = bytes(6000);
  const live = createWeakSlot(key, text(6000), true);
  const dead = createWeakSlot(bytes(6001), text(6001), true);
  const deadOld = createWeakSlot(bytes(6002), undefined, false);
  churnLarge(SCALE * 20, 7000);
  churn(SCALE * 256);
  if (weakSlotKey(dead) !== undefined || weakSlotValue(dead) !== undefined)
    return 7;
  if (weakSlotKey(live) !== key) return 8;
  const value = weakSlotValue(live);
  if (typeof value !== "string" || !intactText(value, 6000)) return 9;
  // A reachable key survives a major; once dropped, the next major clears
  // it, and arrays that reuse its chunk are not it.
  collectGarbage();
  if (weakSlotKey(live) !== key) return 10;
  key = undefined;
  collectGarbage();
  if (weakSlotKey(live) !== undefined || weakSlotValue(live) !== undefined)
    return 11;
  if (weakSlotKey(deadOld) !== undefined) return 12;
  const reused: Uint8Array[] = [];
  for (let i = 0; i < 8; i++) reused.push(bytes(8000 + i));
  for (const array of reused)
    if (weakSlotKey(live) === array || weakSlotKey(deadOld) === array) return 13;
  for (let i = 0; i < 8; i++) if (!intact(old[i], 3000 + i)) return 14;
  return 42;
}
`;
const fixtureModules: [string, string][] = [
    ["weak", weak],
    ["memory", memory],
  ],
  fixtureNamespaces = [
    { module: weak, namespace: "weak-storage" },
    { module: memory, namespace: "native-memory" },
  ];
function verify(
  name: string,
  runtimeEntry: "initializeGenerationalRuntime" | "initializeCopyingRuntime",
  managedBytes: number,
  scale: number,
): void {
  verifyHostedFixture(
    source.replaceAll("SCALE", String(scale)),
    name,
    fixtureModules,
    [],
    [],
    fixtureNamespaces,
    {
      managedBytes,
      allocationCapacity: managedBytes / 16,
      rootCapacity: 16384,
      stackBytes: 2097152,
      hostBindings: [
        {
          module: memory,
          name: "collectGarbage",
          operation: "collect-garbage" as const,
        },
      ],
      runtimeEntry,
      weakBindings: [
        { module: weak, name: "createWeakSlot", operation: "new" as const },
        { module: weak, name: "weakSlotKey", operation: "key" as const },
        { module: weak, name: "weakSlotValue", operation: "value" as const },
      ],
    },
  );
}

test("large objects in a small generational heap (serial collections)", () => {
  verify("gc-large-small", "initializeGenerationalRuntime", 16777216, 1);
});
test("large objects in a large generational heap (parallel collections)", () => {
  verify("gc-large-parallel", "initializeGenerationalRuntime", 536870912, 4);
});
test("large objects in a heap whose size is not a power of two", () => {
  // Its old capacity is not a multiple of the page size, so the space must
  // align its own start (chunk pages are released with fixed mappings).
  verify("gc-large-unaligned", "initializeGenerationalRuntime", 33553408, 1);
});
test("the copying runtime runs the same program without the space", () => {
  // Semispaces of 8 MiB: the churn between checks collects several times.
  verify("gc-large-copying", "initializeCopyingRuntime", 16777216, 2);
});
