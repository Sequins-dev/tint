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
