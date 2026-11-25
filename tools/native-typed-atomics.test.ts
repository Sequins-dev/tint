// Typed code runs Atomics inline on native Uint8, Uint16 and Uint32 arrays:
// element conversion, wrap-around, the previous-value results, Atomics.store's
// ToIntegerOrInfinity result and ValidateAtomicAccess's RangeErrors, as in
// Node.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const source = `
function rangeError(make: () => number): number {
  try {
    make();
  } catch (error) {
    return error instanceof RangeError ? 1 : 0;
  }
  return 0;
}
function bump(words: Uint32Array, index: number): number {
  return Atomics.add(words, index, 1);
}
function bytes(): number {
  const a = new Uint8Array(4);
  if (Atomics.store(a, 0, 250) !== 250 || Atomics.load(a, 0) !== 250) return 1;
  // Read-modify-writes wrap in the element's width and return the old value.
  if (Atomics.add(a, 0, 10) !== 250 || a[0] !== 4) return 2;
  if (Atomics.sub(a, 0, 5) !== 4 || a[0] !== 255) return 3;
  if (Atomics.add(a, 1, -1) !== 0 || a[1] !== 255) return 4;
  if (Atomics.and(a, 1, 0x0f) !== 255 || a[1] !== 15) return 5;
  if (Atomics.or(a, 1, 0x30) !== 15 || a[1] !== 63) return 6;
  if (Atomics.xor(a, 1, 0xff) !== 63 || a[1] !== 192) return 7;
  if (Atomics.exchange(a, 2, 513) !== 0 || a[2] !== 1) return 8;
  // The expected value converts like the element: 261 is 5 in a byte.
  a[3] = 5;
  if (Atomics.compareExchange(a, 3, 261, 9) !== 5 || a[3] !== 9) return 9;
  if (Atomics.compareExchange(a, 3, 5, 7) !== 9 || a[3] !== 9) return 10;
  // Atomics.store returns ToIntegerOrInfinity(value), not the element.
  if (Atomics.store(a, 0, 300) !== 300 || a[0] !== 44) return 11;
  const zero = Atomics.store(a, 0, -0.5);
  if (zero !== 0 || 1 / zero !== Infinity || a[0] !== 0) return 12;
  if (Atomics.store(a, 0, NaN) !== 0 || a[0] !== 0) return 13;
  if (Atomics.store(a, 0, Infinity) !== Infinity || a[0] !== 0) return 14;
  if (Atomics.store(a, 0, 7.9) !== 7 || a[0] !== 7) return 15;
  return 0;
}
function halves(): number {
  const a = new Uint16Array(2);
  if (Atomics.add(a, 0, 65535) !== 0 || Atomics.add(a, 0, 2) !== 65535)
    return 20;
  if (a[0] !== 1) return 21;
  if (Atomics.exchange(a, 1, 70000) !== 0 || a[1] !== 4464) return 22;
  if (Atomics.compareExchange(a, 1, 4464 + 65536, 3) !== 4464) return 23;
  if (Atomics.load(a, 1) !== 3) return 24;
  if (Atomics.xor(a, 1, 65535) !== 3 || a[1] !== 65532) return 25;
  return 0;
}
function words(): number {
  const a = new Uint32Array(4);
  if (Atomics.sub(a, 0, 1) !== 0 || a[0] !== 4294967295) return 30;
  if (Atomics.load(a, 0) !== 4294967295) return 31;
  if (Atomics.add(a, 0, 2) !== 4294967295 || a[0] !== 1) return 32;
  if (Atomics.store(a, 1, 4294967303) !== 4294967303 || a[1] !== 7) return 33;
  if (Atomics.or(a, 1, 0x80000000) !== 7 || a[1] !== 2147483655) return 34;
  if (Atomics.and(a, 1, -1) !== 2147483655) return 35;
  if (Atomics.compareExchange(a, 1, 7, 0) !== 2147483655) return 36;
  if (Atomics.compareExchange(a, 1, 2147483655, 4294967296 + 12) !== 2147483655)
    return 37;
  if (a[1] !== 12) return 38;
  // A replacement above 2^32 keeps only its low word.
  if (Atomics.compareExchange(a, 2, 0, 1e12) !== 0) return 39;
  if (a[2] !== 3567587328) return 40;
  let total = 0;
  for (let i = 0; i < 1000; i++) total += bump(a, i % 4);
  if (a[3] !== 250 || a[2] !== 3567587578) return 41;
  // Each element's 250 previous values: 250 times its start, plus 0..249.
  if (total !== 250 * (1 + 12 + 3567587328) + 4 * 31125) return 43;
  return 0;
}
function indices(): number {
  const a = new Uint32Array(3);
  // ToIndex truncates the index; NaN and -0.5 are index 0.
  Atomics.store(a, 1.9, 5);
  if (a[1] !== 5 || Atomics.load(a, NaN) !== 0) return 50;
  Atomics.store(a, -0.5, 6);
  if (a[0] !== 6) return 51;
  let errors = 0;
  errors += rangeError((): number => Atomics.load(a, -1));
  errors += rangeError((): number => Atomics.add(a, 3, 1));
  errors += rangeError((): number => Atomics.store(a, 9007199254740992, 1));
  errors += rangeError((): number => Atomics.compareExchange(a, Infinity, 0, 1));
  if (errors !== 4) return 52;
  return 0;
}
function views(): number {
  // Atomics on a view reach the buffer's bytes at the view's offset.
  const buffer = new ArrayBuffer(16);
  const all = new Uint8Array(buffer);
  const tail = new Uint32Array(buffer, 8, 2);
  if (Atomics.add(tail, 1, 0x01020304) !== 0) return 60;
  if (all[12] !== 4 || all[15] !== 1) return 61;
  const inner = new Uint16Array(buffer, 12, 2);
  if (Atomics.exchange(inner, 1, 0xffff) !== 0x0102) return 62;
  if (tail[1] !== 0xffff0304) return 63;
  return 0;
}
export function run(): number {
  const failure = bytes() || halves() || words() || indices() || views();
  return failure === 0 ? 42 : failure;
}
`;

test("typed Atomics on native integer arrays match Node", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-typed-atomics-"));
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(file, source);
    const module = (await import(pathToFileURL(file).href)) as {
      run(): number;
    };
    assert.equal(module.run(), 42);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("typed code runs Atomics on native integer arrays natively", () => {
  verifyHostedFixture(source, "typed-atomics", [], [], [], [], {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 2097152,
    allocationCapacity: 65536,
  });
});
