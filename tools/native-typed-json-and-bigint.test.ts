// Typed JSON.stringify / JSON.parse, BigInt(string), and Map<bigint, V> /
// Set<bigint> (SameValueZero value equality).
// Each fixture is verified against Node for exact semantic parity and executed
// natively under LLDB on the typed path (TINT_GENERAL_FALLBACK=0).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

async function runInNode(source: string): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), "tint-json-bigint-node-"));
  try {
    const file = join(dir, "fixture.ts");
    writeFileSync(file, source, "utf8");
    const mod = (await import(pathToFileURL(file).href)) as {
      run: () => number;
    };
    return mod.run();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const typedJsonSource = `interface Config {
  name: string;
  sizes: number[];
}

interface Item {
  id: number;
  label: string;
  active: boolean;
}

function catchesSyntaxError(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof SyntaxError && e instanceof Error;
  }
}

function catchesTypeError(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof TypeError && e instanceof Error;
  }
}

export function run(): number {
  // Primitives and special numbers.
  if (JSON.stringify(42) !== "42") return 1;
  if (JSON.stringify(-0) !== "0") return 2;
  if (JSON.stringify(NaN) !== "null") return 3;
  if (JSON.stringify(Infinity) !== "null") return 4;
  if (JSON.stringify(-Infinity) !== "null") return 5;
  if (JSON.stringify(true) !== "true") return 6;
  if (JSON.stringify(false) !== "false") return 7;
  if (JSON.stringify(null) !== "null") return 8;
  if (JSON.stringify(undefined) !== undefined) return 9;
  if (JSON.stringify() !== undefined) return 10;

  // String escaping including control chars and surrogates.
  if (JSON.stringify('a"b\\\\c') !== '"a\\\\"b\\\\\\\\c"') return 11;
  if (JSON.stringify("\\b\\f\\n\\r\\t") !== '"\\\\b\\\\f\\\\n\\\\r\\\\t"') return 12;
  if (JSON.stringify("\\u0000\\u001f") !== '"\\\\u0000\\\\u001f"') return 13;
  if (JSON.stringify("\\uD83D\\uDE00") !== '"\\uD83D\\uDE00"') return 14;
  if (JSON.stringify("\\uD800") !== '"\\\\ud800"') return 15;
  if (JSON.stringify("\\uDC00") !== '"\\\\udc00"') return 16;

  // Ledger corpus construct + nested object & array enrollment.
  const text = JSON.stringify({ name: "x", sizes: [1, 2] });
  if (text !== '{"name":"x","sizes":[1,2]}') return 17;
  const parsed = JSON.parse(text) as Config;
  if (parsed.name !== "x" || parsed.sizes.length !== 2 || parsed.sizes[1] !== 2)
    return 18;

  const nums = JSON.parse("[10, 20, 30]") as number[];
  if (nums.length !== 3 || nums[0] !== 10 || nums[1] !== 20 || nums[2] !== 30)
    return 19;

  const dict = JSON.parse('{"a":1,"b":2}') as Record<string, number>;
  if (dict["a"] !== 1 || dict["b"] !== 2) return 20;

  // Primitive downcasts from JSON.parse.
  if ((JSON.parse("42") as number) !== 42) return 21;
  if ((JSON.parse("-3.5") as number) !== -3.5) return 22;
  if ((JSON.parse('"hi\\\\n\\\\u0041"') as string) !== "hi\\nA") return 23;
  if ((JSON.parse("true") as boolean) !== true) return 24;
  if ((JSON.parse("false") as boolean) !== false) return 25;
  if ((JSON.parse("null") as null) !== null) return 26;

  // Native number[] and primitive-field record variables passed to JSON.stringify.
  const list: number[] = [3, 4, 5];
  if (JSON.stringify(list) !== "[3,4,5]") return 29;
  const item: Item = { id: 7, label: "ok", active: true };
  if (JSON.stringify(item) !== '{"id":7,"label":"ok","active":true}') return 30;

  // Space formatting (numeric clamping, zero/negative, string truncation).
  if (JSON.stringify({ a: 1 }, null, 2) !== '{\\n  "a": 1\\n}') return 31;
  if (JSON.stringify({ a: 1 }, null, 20) !== '{\\n          "a": 1\\n}')
    return 32;
  if (JSON.stringify({ a: 1 }, null, 0) !== '{"a":1}') return 33;
  if (JSON.stringify({ a: 1 }, null, -3) !== '{"a":1}') return 34;
  if (JSON.stringify({ a: 1 }, null, "--") !== '{\\n--"a": 1\\n}') return 35;
  if (
    JSON.stringify({ a: 1 }, null, "0123456789ABCDEF") !==
    '{\\n0123456789"a": 1\\n}'
  )
    return 36;
  if (JSON.stringify([1, 2], undefined, 2) !== "[\\n  1,\\n  2\\n]") return 37;

  // Array allowlist replacer.
  if (JSON.stringify({ a: 1, b: 2, c: 3 }, ["c", "a"]) !== '{"c":3,"a":1}')
    return 38;

  // Undefined omission in objects and null substitution in arrays.
  if (JSON.stringify({ a: 1, b: undefined, c: 3 }) !== '{"a":1,"c":3}')
    return 39;
  const withUndefined: unknown[] = [1, undefined, 3];
  if (JSON.stringify(withUndefined) !== "[1,null,3]") return 40;

  // BigInt and cyclic object errors.
  if (
    !catchesTypeError(() => {
      JSON.stringify(1n);
    })
  )
    return 41;
  const cyc: Record<string, unknown> = {};
  cyc["self"] = cyc;
  if (
    !catchesTypeError(() => {
      JSON.stringify(cyc);
    })
  )
    return 43;

  // Malformed JSON throws SyntaxError.
  const badInputs: string[] = [
    "",
    "{a:1}",
    "[1,]",
    "undefined",
    "'hi'",
    "01",
    "1 2",
    '"\\\\u123g"',
    '"unterminated',
  ];
  for (let i = 0; i < badInputs.length; i++) {
    const input = badInputs[i];
    if (input === undefined) return 44;
    if (
      !catchesSyntaxError(() => {
        JSON.parse(input);
      })
    )
      return 50 + i;
  }

  return 42;
}
`;

export const typedBigIntExtrasSource = `interface Tag {
  label: string;
}

interface RefKey {
  id: number;
}

function catchesSyntaxError(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof SyntaxError && e instanceof Error;
  }
}

export function run(): number {
  // BigInt(string): decimal, signs, whitespace, empty, hex/octal/binary.
  if (BigInt("0") !== 0n) return 1;
  if (BigInt("-0") !== 0n) return 2;
  if (BigInt("+0") !== 0n) return 3;
  if (BigInt("42") !== 42n) return 4;
  if (BigInt("+42") !== 42n) return 5;
  if (BigInt("-42") !== -42n) return 6;
  if (BigInt("") !== 0n) return 7;
  if (BigInt("   \\n\\t\\r ") !== 0n) return 8;
  const bigStr = "  \\t\\n\\uFEFF 123456789012345678901234567890  ";
  if (BigInt(bigStr) !== 123456789012345678901234567890n) return 9;
  if (BigInt("-999999999999999999999999999999") !== -999999999999999999999999999999n)
    return 10;
  if (BigInt("0x10") !== 16n) return 11;
  if (BigInt("0XFF") !== 255n) return 12;
  if (BigInt("  0xdeadbeef  ") !== 3735928559n) return 13;
  if (BigInt("0o77") !== 63n) return 14;
  if (BigInt("0O10") !== 8n) return 15;
  if (BigInt("0b1010") !== 10n) return 16;
  if (BigInt("0B1111") !== 15n) return 17;

  // Invalid BigInt(string) syntax throws SyntaxError.
  const invalid: string[] = [
    "abc",
    "1.5",
    "1n",
    "1_000",
    "0x",
    "-0x1",
    "+0x1",
    "0x-1",
    "+0b1",
    "0o8",
    "0b2",
    "1e5",
  ];
  for (let i = 0; i < invalid.length; i++) {
    const text = invalid[i];
    if (text === undefined) return 18;
    if (
      !catchesSyntaxError(() => {
        BigInt(text);
      })
    )
      return 20 + i;
  }

  // Set<bigint>: SameValueZero value equality across distinct allocations.
  const set = new Set<bigint>();
  set.add(1n);
  set.add(2n);
  set.add(1n + 1n);
  set.add(3n);
  if (set.size !== 3) return 40;
  const cloned = new Set<bigint>(set);
  if (cloned.size !== 3 || !cloned.has(1n + 2n)) return 42 - 1;
  if (!set.has(1n + 2n)) return 41;
  set.add(-0n);
  if (!set.has(0n) || set.size !== 4) return 43;
  const hugeA = (1n << 200n) + 7n;
  const hugeB = (1n << 200n) + 7n;
  set.add(hugeA);
  if (!set.has(hugeB) || set.size !== 5) return 44;
  set.add(hugeB);
  if (set.size !== 5) return 45;
  const negA = -(1n << 180n) - 3n;
  const negB = -(1n << 180n) - 3n;
  set.add(negA);
  if (!set.delete(negB) || set.has(negA)) return 46;
  set.clear();
  if (set.size !== 0) return 47;

  // Set<bigint> rehash past linearLimit = 8 and preserve insertion order.
  const scale = 100000000000000000000n;
  for (let i = 0; i < 30; i++) set.add(BigInt(i) * scale + BigInt(i));
  if (set.size !== 30) return 48;
  for (let i = 0; i < 30; i++) {
    const probe = BigInt(i) * scale + BigInt(i);
    if (!set.has(probe)) return 49;
  }
  for (let i = 0; i < 30; i += 2) set.delete(BigInt(i) * scale + BigInt(i));
  if (set.size !== 15) return 50;
  let expectedOdd = 1;
  for (const item of set) {
    if (item !== BigInt(expectedOdd) * scale + BigInt(expectedOdd)) return 51;
    expectedOdd += 2;
  }
  if (expectedOdd !== 31) return 52;

  // Map<bigint, number>: overwrite, delete, rehash past 8, iteration order.
  const numMap = new Map<bigint, number>();
  for (let i = 0; i < 30; i++) {
    numMap.set(BigInt(i) * scale + BigInt(i), i * 10);
  }
  if (numMap.size !== 30) return 53;
  // Overwrite with freshly computed value-equal keys.
  for (let i = 0; i < 30; i++) {
    numMap.set(BigInt(i) * scale + BigInt(i), i * 10 + 1);
  }
  if (numMap.size !== 30) return 54;
  for (let i = 0; i < 30; i++) {
    if (numMap.get(BigInt(i) * scale + BigInt(i)) !== i * 10 + 1) return 55;
  }
  if (!numMap.delete(10n * scale + 10n) || numMap.has(10n * scale + 10n))
    return 56;
  let mapCount = 0;
  let valueSum = 0;
  for (const [k, v] of numMap) {
    if (k === 10n * scale + 10n) return 57;
    mapCount++;
    valueSum += v;
  }
  if (mapCount !== 29) return 58;
  // Sum of (i * 10 + 1) for i=0..29 minus (10 * 10 + 1 = 101) = 4380 - 101 = 4279
  if (valueSum !== 4279) return 59;

  // Map<bigint, string> and Map<bigint, bigint>.
  const strMap = new Map<bigint, string>();
  strMap.set(-(1n << 130n), "neg");
  strMap.set(1n << 130n, "pos");
  if (strMap.get(-(1n << 130n)) !== "neg") return 60;
  if (strMap.get(1n << 130n) !== "pos") return 61;

  const biMap = new Map<bigint, bigint>();
  biMap.set(10n + 20n, 1n << 100n);
  const biVal = biMap.get(30n);
  if (biVal === undefined || biVal !== 1n << 100n) return 62;

  // Map<bigint, Tag> alongside Map<RefKey, number>: record-key erasure must
  // NEVER alias Map<bigint, V> (value equality) with Map<Record, V> (ref identity).
  const tagMap = new Map<bigint, Tag>();
  tagMap.set(10n + 1n, { label: "eleven" });
  const gotTag = tagMap.get(11n);
  if (gotTag === undefined || gotTag.label !== "eleven") return 63;

  const refA: RefKey = { id: 1 };
  const refB: RefKey = { id: 1 };
  const refMap = new Map<RefKey, number>();
  refMap.set(refA, 99);
  if (refMap.get(refA) !== 99 || refMap.get(refB) !== undefined) return 64;

  // Constant-folded BigInt literal expressions and runtime RangeError preservation.
  const mask96 = (1n << 96n) - 1n;
  const bound160 = 1n << 160n;
  if (mask96 !== 79228162514264337593543950335n) return 65;
  if (bound160 !== 1461501637330902918203684832716283019655932542976n) return 66;
  if (~0n !== -1n || -(1n << 104n) !== -20282409603651670423947251286016n) return 67;
  let caughtDivZero = false;
  try {
    if (1n / 0n === 0n) return 68;
  } catch (e) {
    caughtDivZero = e instanceof RangeError;
  }
  if (!caughtDivZero) return 69;
  let caughtModZero = false;
  try {
    if (1n % 0n === 0n) return 70;
  } catch (e) {
    caughtModZero = e instanceof RangeError;
  }
  if (!caughtModZero) return 71;
  let caughtNegExp = false;
  try {
    if (2n ** -1n === 0n) return 72;
  } catch (e) {
    caughtNegExp = e instanceof RangeError;
  }
  if (!caughtNegExp) return 73;

  // Inline fast paths: negative masks across 26/52-bit boundaries, shifts, BigInt64Array/BigUint64Array.
  const negA64 = -(1n << 26n);
  const negB64 = -(1n << 52n);
  if ((negA64 & 0xffffffffn) !== 0xfc000000n) return 74;
  if ((negB64 & 0xffffffffn) !== 0n) return 75;
  if ((-1n & 0xffffffffn) !== 0xffffffffn) return 76;
  if (((-1n - (1n << 26n)) & 0xffffffffn) !== 0xfbffffffn) return 77;
  const s64 = new BigInt64Array(4);
  const u64 = new BigUint64Array(4);
  s64[0] = 0n;
  s64[1] = -1n;
  s64[2] = -(1n << 63n);
  s64[3] = (1n << 63n) - 1n;
  u64[0] = 0n;
  u64[1] = 1n;
  u64[2] = (1n << 64n) - 1n;
  u64[3] = 0x123456789abcdef0n;
  if ((s64[0] ?? 1n) !== 0n || (s64[1] ?? 0n) !== -1n) return 78;
  if ((s64[2] ?? 0n) !== -(1n << 63n) || (s64[3] ?? 0n) !== (1n << 63n) - 1n)
    return 79;
  if ((u64[0] ?? 1n) !== 0n || (u64[1] ?? 0n) !== 1n) return 80;
  if (
    (u64[2] ?? 0n) !== (1n << 64n) - 1n ||
    (u64[3] ?? 0n) !== 0x123456789abcdef0n
  )
    return 81;
  if (((u64[3] ?? 0n) >> 32n) !== 0x12345678n) return 82;
  if (((u64[1] ?? 0n) << 25n) !== 33554432n) return 83;

  return 42;
}
`;

export const typedJsonContractSource = `interface Config {
  name: string;
  sizes: number[];
}

function catchesTypeError(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof TypeError && e instanceof Error;
  }
}

export function run(): number {
  if (
    !catchesTypeError(() => {
      const bad = JSON.parse('{"name":123,"sizes":[1,2]}') as Config;
      if (bad.name === "never") throw new Error("unreachable");
    })
  )
    return 1;
  if (
    !catchesTypeError(() => {
      const badArr = JSON.parse('[1, "two"]') as number[];
      if (badArr.length === 999) throw new Error("unreachable");
    })
  )
    return 2;
  if (
    !catchesTypeError(() => {
      const badNum = JSON.parse('"not-a-number"') as number;
      if (badNum === 0) throw new Error("unreachable");
    })
  )
    return 3;
  // Valid enrolled Config rejects out-of-contract mutation.
  const ok = JSON.parse('{"name":"a","sizes":[1,2]}') as Config;
  if (ok.name !== "a" || ok.sizes[0] !== 1 || ok.sizes[1] !== 2) return 4;
  return 42;
}
`;

test("typed JSON.stringify and JSON.parse match Node and execute natively", async () => {
  assert.equal(await runInNode(typedJsonSource), 42);
  verifyHostedFixture(typedJsonSource, "typed-json", [], [], [], [], {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 16777216,
    allocationCapacity: 262144,
  });
});

test("typed JSON.parse as T enforces explicit contracts natively", () => {
  verifyHostedFixture(
    typedJsonContractSource,
    "typed-json-contract",
    [],
    [],
    [],
    [],
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 16777216,
      allocationCapacity: 262144,
    },
  );
});

test("typed BigInt(string) and Map/Set<bigint> match Node and execute natively", async () => {
  assert.equal(await runInNode(typedBigIntExtrasSource), 42);
  verifyHostedFixture(
    typedBigIntExtrasSource,
    "typed-bigint-extras",
    [],
    [],
    [],
    [],
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 16777216,
      allocationCapacity: 262144,
    },
  );
});

const unboxedWord64BigIntSource = `function catchesRangeError(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof RangeError;
  }
}

export function run(): number {
  const size = 16;
  const signed = new BigInt64Array(size);
  const unsigned = new BigUint64Array(size);
  for (let i = 0; i < size; i++) {
    signed[i] = BigInt(i * 17 - 100) << 12n;
    unsigned[i] = (BigInt(i) * 0x9e3779b9n) & 0xffffffffffffffffn;
  }

  // Modular 64-bit ring ops, unary -/~, and shifts.
  let acc = 0n;
  for (let round = 0; round < 5; round++) {
    const delta = BigInt(round);
    for (let i = 0; i < size; i++) {
      let s = (signed[i] ?? 0n) + delta;
      s = s - 3n;
      s = s ^ ~delta;
      signed[i] = s;
      let u = ((unsigned[i] ?? 0n) ^ (delta << 3n)) + 7n;
      u = u * 3n;
      u = u | 1n;
      unsigned[i] = u;
      acc = (acc + s + u - -delta) & 0xffffffffn;
    }
  }
  const maskedBoxed = acc & 0xffffffffn;
  if (maskedBoxed !== BigInt(Number(acc & 0xffffffffn))) return 1;

  // 64-bit signed vs unsigned wraparound boundaries.
  const maxI64 = 0x7fffffffffffffffn;
  const wrapBuf = new BigInt64Array(2);
  const wrapUBuf = new BigUint64Array(2);
  wrapBuf[0] = maxI64 + 1n;
  wrapUBuf[0] = maxI64 + 1n;
  if ((wrapBuf[0] ?? 0n) !== -9223372036854775808n) return 2;
  if ((wrapUBuf[0] ?? 0n) !== 9223372036854775808n) return 3;

  // Out-of-bounds reads/writes and non-integer indices.
  const oob1 = (signed[-1] ?? 123n) + (signed[size] ?? 456n) + (signed[1.5] ?? 789n);
  if (Number(oob1 & 0xffffffffn) !== 123 + 456 + 789) return 4;
  const before0 = signed[0] ?? 0n;
  signed[-1] = 999n;
  signed[size] = 999n;
  if ((signed[0] ?? 0n) !== before0) return 5;

  // BigInt(number) edge cases inside word64 sinks: -0, non-int RangeError, >2^53 slow path.
  const edge = new BigUint64Array(2);
  edge[0] = BigInt(-0);
  if ((edge[0] ?? 1n) !== 0n) return 6;
  edge[1] = BigInt(1e20);
  if ((edge[1] ?? 0n) !== (BigInt("100000000000000000000") & 0xffffffffffffffffn))
    return 7;
  if (!catchesRangeError(() => { edge[0] = BigInt(1.5); })) return 8;
  if (!catchesRangeError(() => { edge[0] = BigInt(NaN); })) return 9;
  if (!catchesRangeError(() => { edge[0] = BigInt(Infinity); })) return 10;

  // Arbitrary-precision soundness: assignment expression result must NOT truncate!
  const huge = (1n << 100n) + 5n;
  const arr = new BigInt64Array(1);
  const assignedResult = (arr[0] = huge);
  if (assignedResult !== (1n << 100n) + 5n) return 11;
  if ((arr[0] ?? 0n) !== 5n) return 12;

  // Unmasked >64-bit arithmetic and >=64 shifts must NOT wrap!
  let wide = 1n << 63n;
  wide = wide + 1n;
  if (wide <= 0n || wide !== 9223372036854775809n) return 13;
  const bigShift = (1n << 70n) + 1n;
  if (Number(bigShift & 0xffffffffn) !== 1) return 14;
  if (bigShift >> 70n !== 1n) return 15;

  // DataView 64-bit LE & BE store/load with unboxed word64 expressions.
  const ab = new ArrayBuffer(16);
  const dv = new DataView(ab);
  const k = BigInt(19) * 0x100000001n + 5n;
  dv.setBigInt64(0, k, true);
  dv.setBigUint64(8, k ^ 0x55aa55aa55aa55aan, false);
  if (Number(dv.getBigInt64(0, true) & 0xffffffffn) !== 24) return 16;
  if (
    Number((dv.getBigUint64(8, false) ^ 0x55aa55aa55aa55aan) & 0xffffffffn) !==
    24
  )
    return 17;

  // IEEE-754 unsigned word64-to-number round-to-nearest-even at high magnitudes.
  const maxU64 = 0xffffffffffffffffn;
  if (Number(maxU64 & 0xffffffffffffffffn) !== 18446744073709551616) return 18;
  const midU64 = 0x8000000000000000n;
  if (Number(midU64 & 0xffffffffffffffffn) !== 9223372036854775808) return 19;

  return 42;
}
`;

test("unboxed word64 BigInt loops, edge cases, and arbitrary-precision boundaries match Node natively", async () => {
  assert.equal(await runInNode(unboxedWord64BigIntSource), 42);
  verifyHostedFixture(
    unboxedWord64BigIntSource,
    "typed-bigint-word64",
    [],
    [],
    [],
    [],
    {
      requireTyped: true,
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 16777216,
      allocationCapacity: 262144,
    },
  );
});
