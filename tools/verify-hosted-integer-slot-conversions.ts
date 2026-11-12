// Integer slots (packages/codegen/src/aarch64/scalar/index.ts) hold proven
// 32-bit integers as int64 when their integer-use loads outweigh the others
// (loop-depth weighted); the remaining loads convert to doubles. Each
// function mixes integer and double uses of one slot: unsigned values up to
// 2^32 - 1, negative values down to -2^31, conversions inside and after
// loops, and slots whose only double use is the return.
import { verifyHostedFixture } from "./hosted-fixture.ts";

export const source = `function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}
function mixed(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += i / 4 + (i & 3);
  return total;
}
function unsignedTop(n: number): number {
  let x = 4294967295;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += x * 0.5;
    x = (x - 1) >>> 0;
  }
  return sum + x;
}
function signedLow(n: number): number {
  let y = -2147483648;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    y = (y + 7) | 0;
    sum += y / 2;
  }
  return sum - y;
}
function countdown(n: number): number {
  let i = n;
  let product = 1;
  while (i > 0) {
    product = (product * 3 + i) % 1000003;
    i--;
  }
  return product + i * 0.25;
}
export function run(): number {
  return (
    hash("integer slots convert at their double loads") +
    hash("") * 3 +
    mixed(37) +
    unsignedTop(11) +
    signedLow(13) +
    countdown(17) +
    countdown(-3)
  );
}`;

verifyHostedFixture(
  source.replace(
    "export function run(): number {",
    "function compute(): number {",
  ) +
    `
export function run(): number { return compute() === ${(() => {
      const fn = new Function(
        source.replace(/: (number|string)/g, "").replace(/export /, "") +
          "\nreturn run();",
      );
      return fn() as number;
    })()} ? 42 : 1; }`,
  "integer-slot-conversions",
  [],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 4194304,
    allocationCapacity: 65536,
    rootCapacity: 4096,
    stackBytes: 1048576,
  },
);
