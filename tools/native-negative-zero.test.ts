// Integer representations must not lose -0. Interval facts (bounds.ts) admit
// number slots as int64 "integer slots" and codegen holds integer-used
// products and sums as int64, but -0 is an integer-valued number whose sign
// `1 / x`, Object.is, Math.sign and Math.min/max observe. Each case produces -0 through
// multiplication, negation, remainder, rounding or Math.min, in loops (where
// slot facts widen) and straight-line code, with the slot also used as an
// integer (comparisons, array indexes) so that it would qualify as an integer
// slot. Index uses (where -0 and +0 are the same element) must still work.
// Integer-used products and sums wrapped as optionals or stored as
// Float64Array elements observe the sign too, so they keep doubles.
// The same source runs in Node for the expected results and natively under
// LLDB on the typed path.
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

const source = `/** 1 for -0, 2 for +0, 3 for anything else (Object.is(x, -0) where the
 * typed path has no Object global). */
function sign(x: number): number {
  if (x !== 0) return 3;
  return 1 / x === -Infinity ? 1 : 2;
}
function isNegativeZero(x: number): boolean {
  return x === 0 && 1 / x < 0;
}
const table: number[] = [10, 11, 12, 13, 14, 15, 16, 17];
const bytes = new Uint8Array(8);
function multiplyLoop(n: number): number {
  let x = 7,
    hits = 0;
  for (let i = 0; i < 8; i++) {
    if (i >= n) break;
    x = i * -1;
    if (x < -5) hits++;
    if (x > -3) hits++;
    if (x === 0) hits += 2;
  }
  return sign(x) * 100 + hits;
}
function negateLoop(n: number): number {
  let x = 7,
    hits = 0;
  for (let i = 0; i < 8; i++) {
    if (i >= n) break;
    x = -i;
    if (x < -5) hits++;
    if (x > -3) hits++;
  }
  return sign(x) * 100 + hits;
}
function remainderLoop(n: number): number {
  let x = 7,
    hits = 0;
  for (let i = 0; i < 8; i++) {
    if (i >= n) break;
    x = (i * -1) % 3;
    if (x < -1) hits++;
    if (x > -2) hits++;
  }
  return sign(x) * 100 + hits;
}
function negativeRemainder(n: number): number {
  let x = 7,
    hits = 0;
  for (let i = 0; i < 8; i++) {
    if (i >= n) break;
    x = -(i % 3);
    if (x < -1) hits++;
  }
  return sign(x) * 100 + hits;
}
function minLoop(n: number): number {
  let x = 7,
    hits = 0;
  for (let i = 0; i < 8; i++) {
    if (i >= n) break;
    x = Math.min(i, -i);
    if (x < -5) hits++;
    if (x > -3) hits++;
  }
  return sign(x) * 100 + hits;
}
function maxLoop(n: number): number {
  let x = 7,
    hits = 0;
  for (let i = 0; i < 8; i++) {
    if (i >= n) break;
    x = Math.max(-i, i * -1);
    if (x < -5) hits++;
  }
  return sign(x) * 100 + hits;
}
function sumLoop(n: number): number {
  // -0 + -0 and -0 - 0 stay -0.
  let x = 7,
    y = 7,
    hits = 0;
  for (let i = 0; i < 8; i++) {
    if (i >= n) break;
    const p = i * -1;
    x = p + p;
    y = p - 0;
    if (x < -5) hits++;
    if (y > -3) hits++;
  }
  return sign(x) * 1000 + sign(y) * 100 + hits;
}
function plusZeroLoop(n: number): number {
  // -0 + 0 is +0.
  let x = 7,
    hits = 0;
  for (let i = 0; i < 8; i++) {
    if (i >= n) break;
    x = i * -1 + 0;
    if (x < -5) hits++;
  }
  return sign(x) * 100 + hits;
}
function roundingLoop(n: number): number {
  let r = 7,
    c = 7,
    t = 7,
    f = 7,
    hits = 0;
  for (let i = 0; i < 8; i++) {
    if (i >= n) break;
    const v = -0.4 - i;
    r = Math.round(v);
    c = Math.ceil(v);
    t = Math.trunc(v);
    f = Math.floor(-i * 0.5);
    if (r < -5) hits++;
    if (c < -5) hits++;
    if (t < -5) hits++;
    if (f < -5) hits++;
  }
  return sign(r) * 1000 + sign(c) * 100 + sign(t) * 10 + sign(f) + hits * 10000;
}
function truncInteger(n: number): number {
  // Math.trunc of an integer -0 stays -0.
  let x = 7,
    hits = 0;
  for (let i = 0; i < 8; i++) {
    if (i >= n) break;
    x = Math.trunc(i * -1);
    if (x < -5) hits++;
  }
  return sign(x) * 100 + hits;
}
function indexed(n: number): number {
  // -0 indexes element 0 like +0, and the slot keeps its sign.
  let x = 7,
    total = 0;
  for (let i = 0; i < 8; i++) {
    if (i >= n) break;
    x = i * -1;
    total += table[-x] ?? 0;
    total += table[x + 7] ?? 0;
    bytes[-x] = i + 1;
    total += bytes[-x] ?? 0;
  }
  return sign(x) * 10000 + total;
}
function indexedZero(): number {
  let x = 3;
  x = 0 * -1;
  const element = table[x] ?? 0;
  bytes[x] = 99;
  return sign(x) * 1000 + element + (bytes[0] ?? 0);
}
function straightMultiply(k: number): number {
  let x = 5;
  const zero = k - k;
  x = zero * -1;
  let hits = 0;
  if (x < 1) hits++;
  if (x === 0) hits++;
  return sign(x) * 100 + hits;
}
function straightConstant(): number {
  let x = 5;
  x = 0 * -1;
  let hits = 0;
  if (x < 1) hits++;
  if (x > -1) hits++;
  return sign(x) * 100 + hits;
}
function straightNegate(): number {
  let x = 5;
  const zero = 0;
  x = -zero;
  let hits = 0;
  if (x < 1) hits++;
  return sign(x) * 100 + hits;
}
function straightMin(): number {
  let x = 5;
  x = Math.min(0, -0);
  let hits = 0;
  if (x < 1) hits++;
  const y = Math.max(-0, 0);
  return sign(x) * 1000 + sign(y) * 100 + hits;
}
function literal(): number {
  let x = 5;
  x = -0;
  let hits = 0;
  if (x < 1) hits++;
  return sign(x) * 100 + hits;
}
function observers(n: number): number {
  let x = 7,
    hits = 0;
  for (let i = 0; i < 8; i++) {
    if (i >= n) break;
    x = i * -1;
    if (x < -5) hits++;
  }
  let code = hits;
  if (Math.round(x) === 0 && 1 / Math.round(x) < 0) code += 10;
  if (Math.sign(x) === 0 && 1 / Math.sign(x) < 0) code += 100;
  if (isNegativeZero(Math.min(x, 0))) code += 1000;
  if (isNegativeZero(Math.max(x, -0))) code += 10000;
  const guarded = x === 0 ? 1 / x : x;
  if (guarded === -Infinity) code += 100000;
  return code;
}
function cellCapture(n: number): number {
  // A captured variable written with -0 and read through a closure.
  let x = 7;
  const read = (): number => x;
  for (let i = 0; i < 8; i++) {
    if (i >= n) break;
    x = i * -1;
  }
  return sign(read());
}
function returned(n: number): number {
  let x = 7;
  for (let i = 0; i < 8; i++) {
    if (i >= n) break;
    x = -i;
    if (x < -6) break;
  }
  return x;
}
function optionalProduct(n: number): number {
  // An integer-used product wrapped as an optional payload.
  let out: number | undefined = undefined;
  for (let i = 0; i < 8; i++) {
    if (i >= n) break;
    const y: number | undefined = i * -1;
    out = y;
  }
  return out === undefined ? 5 : sign(out);
}
function optionalSums(n: number): number {
  // Integer-used sums of -0 operands wrapped as optional payloads; i + 1
  // (never -0) is wrapped too.
  let sum: number | undefined = undefined,
    difference: number | undefined = undefined,
    next: number | undefined = undefined;
  for (let i = 0; i < 8; i++) {
    if (i >= n) break;
    const p = i * -1;
    const s: number | undefined = p + p;
    const d: number | undefined = p - 0;
    const k: number | undefined = i + 1;
    sum = s;
    difference = d;
    next = k;
  }
  return (
    (sum === undefined ? 5 : sign(sum)) * 100 +
    (difference === undefined ? 5 : sign(difference)) * 10 +
    (next === undefined ? 5 : next)
  );
}
function floatElement(n: number): number {
  // An integer-used product stored as a Float64Array element.
  const f = new Float64Array(2);
  for (let i = 0; i < 8; i++) {
    if (i >= n) break;
    f[0] = i * -1;
    f[1] = -i;
  }
  return sign(f[0] ?? 7) * 10 + sign(f[1] ?? 7);
}
function selected(): number {
  // A typed-array access the optimizer selects as unchecked: the module
  // keeps interval facts (integer slots) only when some access is selected.
  const local = new Uint8Array(8);
  let total = 0;
  for (let i = 0; i < 8; i++) {
    local[i] = i * 3;
    total += local[i] ?? 0;
  }
  return total;
}
export function results(): number[] {
  const out: number[] = [selected()];
  for (let n = 1; n <= 3; n += 2) {
    out.push(multiplyLoop(n));
    out.push(negateLoop(n));
    out.push(remainderLoop(n));
    out.push(negativeRemainder(n));
    out.push(minLoop(n));
    out.push(maxLoop(n));
    out.push(sumLoop(n));
    out.push(plusZeroLoop(n));
    out.push(roundingLoop(n));
    out.push(truncInteger(n));
    out.push(indexed(n));
    out.push(observers(n));
    out.push(cellCapture(n));
    out.push(sign(returned(n)));
    out.push(optionalProduct(n));
    out.push(floatElement(n));
    out.push(optionalSums(n));
  }
  out.push(indexedZero());
  out.push(straightMultiply(4));
  out.push(straightConstant());
  out.push(straightNegate());
  out.push(straightMin());
  out.push(literal());
  return out;
}
`;

async function expectedResults(text: string): Promise<number[]> {
  const directory = mkdtempSync(join(tmpdir(), "tint-negative-zero-"));
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(file, text);
    const module = (await import(pathToFileURL(file).href)) as {
      results(): number[];
    };
    return module.results();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("integer representations keep -0 from products, negation, remainders, rounding and Math.min", async () => {
  const expected = await expectedResults(source);
  assert.ok(expected.length > 0);
  // Exit 42 when every result matches, otherwise 100 + the first mismatch.
  verifyHostedFixture(
    source +
      `const expected: number[] = [${expected.join(", ")}];
export function run(): number {
  const actual = results();
  if (actual.length !== expected.length) return 99;
  for (let i = 0; i < expected.length; i++)
    if (actual[i] !== expected[i]) return 100 + i;
  return 42;
}
`,
    "negative-zero",
    [],
    [],
    [],
    [],
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 16777216,
      allocationCapacity: 262144,
      rootCapacity: 65536,
    },
  );
});
