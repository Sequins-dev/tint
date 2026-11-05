import assert from "node:assert/strict";
import test from "node:test";
import {
  parseInteger,
  divideToNumber,
} from "@tint/foundation/numeric/big-integer";
function ratio(n: bigint, d: bigint): number | undefined {
  const a = parseInteger(String(n), 10),
    b = parseInteger(String(d), 10);
  assert.ok(a && b);
  return divideToNumber(a, b);
}
test("integer ratios round once instead of rounding their operands first", () => {
  assert.equal(ratio(9007199254740993n, 3n), 3002399751580331);
  const huge = 10n ** 400n;
  assert.equal(ratio(huge, huge + 1n), 1);
  assert.equal(ratio(huge, 3n * huge), 1 / 3);
  const scale = 2n ** 53n;
  assert.equal(ratio(scale + 1n, scale), 1);
  assert.equal(ratio(scale + 2n, scale), 1 + Number.EPSILON);
  assert.equal(ratio(scale + 3n, scale), 1 + 2 * Number.EPSILON);
  assert.equal(ratio(-(scale + 3n), scale), -(1 + 2 * Number.EPSILON));
  assert.equal(ratio(1n, 0n), undefined);
});
test("ratio conversion handles subnormal ties, signed underflow and overflow", () => {
  const tiny = 2n ** 1074n;
  assert.equal(ratio(1n, tiny), Number.MIN_VALUE);
  assert.equal(ratio(1n, 2n * tiny), 0);
  assert.equal(ratio(3n, 2n * tiny), 2 * Number.MIN_VALUE);
  assert.ok(Object.is(ratio(-1n, 4n * tiny), -0));
  assert.equal(ratio(2n ** 1024n - 2n ** 971n, 1n), Number.MAX_VALUE);
  assert.equal(ratio(2n ** 1024n - 2n ** 970n, 1n), Infinity);
  for (let n = -31; n <= 31; n++)
    for (let d = 1; d <= 31; d++)
      assert.equal(ratio(BigInt(n), BigInt(d)), n / d);
});

test("ratio conversion agrees with hardware division for exactly encoded operands", () => {
  let seed = 123456789;
  function random(): number {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  }
  for (let i = 0; i < 256; i++) {
    const n = BigInt(1 + (random() % 67108863)) * 2n ** BigInt(random() % 970);
    const d = BigInt(1 + (random() % 67108863)) * 2n ** BigInt(random() % 970);
    // A 26-bit coefficient times a power of two is exactly representable.
    assert.equal(ratio(n, d), Number(n) / Number(d));
    assert.equal(ratio(-n, d), -Number(n) / Number(d));
  }
});
