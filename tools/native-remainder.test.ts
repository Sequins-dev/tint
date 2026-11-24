// Native `%` against Node: the inline exact-int32 path and the helper must
// agree with ECMAScript on signs, -0, NaN, infinities and out-of-range
// operands (docs/native-performance-analysis.md).
import test from "node:test";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const special = [
  0,
  -0,
  1,
  -1,
  2,
  -2,
  3,
  -3,
  5.5,
  -5.5,
  7,
  -7,
  1000,
  2147483647,
  -2147483647,
  2147483648,
  -2147483648,
  -2147483649,
  4294967296,
  9007199254740992,
  -9007199254740993,
  9223372036854775807,
  -9223372036854775808,
  1e300,
  -1e300,
  Number.MIN_VALUE,
  Infinity,
  -Infinity,
  NaN,
];

/** Each result as text that keeps -0 and NaN apart (`String(-0)` is "0"). */
function show(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

test("native remainder matches ECMAScript for exact, signed and special operands", () => {
  const pairs: string[] = [];
  for (const left of special)
    for (const right of special)
      pairs.push(`[${show(left)},${show(right)},${show(left % right)}]`);
  let loops = 0;
  for (let i = -40; i < 40; i++)
    for (let j = -9; j < 9; j++)
      if (j !== 0) loops = (loops * 31 + (i % j)) % 1000003;
  const text = `const pairs: number[][] = [${pairs.join(",")}];
function same(a: number, b: number): boolean {
  if (a !== a) return b !== b;
  return a === b && (a !== 0 || 1 / a === 1 / b);
}
export function run(): number {
  for (let k = 0; k < pairs.length; k++) {
    const pair = pairs[k];
    if (pair === undefined) return 1;
    const left = pair[0], right = pair[1], expected = pair[2];
    if (left === undefined || right === undefined || expected === undefined) return 2;
    if (!same(left % right, expected)) return 3;
  }
  let loops = 0;
  for (let i = -40; i < 40; i++)
    for (let j = -9; j < 9; j++)
      if (j !== 0) loops = (loops * 31 + (i % j)) % 1000003;
  if (!same(loops, ${show(loops)})) return 4;
  return 42;
}
`;
  verifyHostedFixture(text, "remainder");
});

test("native remainder of exact integers: int64 results, -0 and constant divisors", () => {
  // The same loops under Node give the expected checksum.
  function kernel(): number {
    const units = [3, 1, 4, 1, 5, 9, 2, 6];
    let sum = 0;
    for (let i = -60; i < 60; i++) {
      // Integer results used as indices (constant divisors).
      sum = (sum * 31 + (units[((i % 8) + 8) % 8] ?? 0)) % 1000003;
      // A zero remainder keeps the dividend's sign where it is observed.
      const r = i % 5;
      if (r === 0) sum = (sum + (1 / r > 0 ? 1 : 2)) % 1000003;
      sum = (sum + (i % -3) + 7) % 1000003;
      if (i % 0 === i % 0) sum = -1;
      const big = 4503599627370496 + i * 1000;
      sum = (sum + (big % 9) + (big % 65536)) % 1000003;
    }
    return sum;
  }
  const expected = kernel();
  const text = `function kernel(): number {
  const units: number[] = [3, 1, 4, 1, 5, 9, 2, 6];
  let sum = 0;
  for (let i = -60; i < 60; i++) {
    sum = (sum * 31 + (units[((i % 8) + 8) % 8] ?? 0)) % 1000003;
    const r = i % 5;
    if (r === 0) sum = (sum + (1 / r > 0 ? 1 : 2)) % 1000003;
    sum = (sum + (i % -3) + 7) % 1000003;
    if (i % 0 === i % 0) sum = -1;
    const big = 4503599627370496 + i * 1000;
    sum = (sum + (big % 9) + (big % 65536)) % 1000003;
  }
  return sum;
}
export function run(): number {
  return kernel() === ${expected} ? 42 : 1;
}
`;
  verifyHostedFixture(text, "remainder-integers");
});

test("native remainders of loop counters: non-negative slots stay integers, signed ones keep -0", () => {
  // Counters that only count up from 0 are non-negative slots, so their
  // remainders by constants are int64s feeding sums and code units; a
  // counter that also counts down keeps -0 for a negative multiple.
  function kernel(): string {
    let text = "",
      signs = 0;
    for (let round = 0; round < 3; round++)
      for (let i = 0; i < 64; i++)
        text += String.fromCharCode(
          97 + ((round + i) % 26),
          98 + (i % 20),
          48 + (i % 10),
        );
    for (let j = 10; j >= -10; j--) {
      const r = j % 5;
      signs = signs * 3 + (r === 0 ? (1 / r > 0 ? 1 : 2) : 0);
      signs %= 1000003;
    }
    let k = 0;
    for (let n = 0; n < 20; n++) {
      k = n % 3 === 0 ? k - 4 : k + 1;
      signs =
        (signs * 7 + (k % 4 === 0 ? (1 / (k % 4) > 0 ? 1 : 2) : 3)) % 1000003;
    }
    return text + ":" + String(signs);
  }
  const expected = kernel();
  const text = `function kernel(): string {
  let text = "",
    signs = 0;
  for (let round = 0; round < 3; round++)
    for (let i = 0; i < 64; i++)
      text += String.fromCharCode(
        97 + ((round + i) % 26),
        98 + (i % 20),
        48 + (i % 10),
      );
  for (let j = 10; j >= -10; j--) {
    const r = j % 5;
    signs = signs * 3 + (r === 0 ? (1 / r > 0 ? 1 : 2) : 0);
    signs %= 1000003;
  }
  let k = 0;
  for (let n = 0; n < 20; n++) {
    k = n % 3 === 0 ? k - 4 : k + 1;
    signs = (signs * 7 + (k % 4 === 0 ? (1 / (k % 4) > 0 ? 1 : 2) : 3)) % 1000003;
  }
  return text + ":" + String(signs);
}
export function run(): number {
  return kernel() === ${JSON.stringify(expected)} ? 42 : 1;
}
`;
  verifyHostedFixture(text, "remainder-counters");
});
