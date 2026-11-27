import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mathAtan,
  mathAtan2,
  mathCbrt,
  mathExpm1,
  mathHypot3,
  mathLog,
  mathLog10,
  mathLog2,
  mathPow,
} from "../src/numeric/math.ts";

const scratchF64 = new Float64Array(1);
const scratchU64 = new BigUint64Array(scratchF64.buffer);

function ulpDistance(a: number, b: number): number {
  if (Object.is(a, b)) return 0;
  if (Number.isNaN(a) && Number.isNaN(b)) return 0;
  scratchF64[0] = a;
  const bitsA = scratchU64[0] ?? 0n;
  scratchF64[0] = b;
  const bitsB = scratchU64[0] ?? 0n;
  return Number(bitsA > bitsB ? bitsA - bitsB : bitsB - bitsA);
}

test("mathLog, mathLog2, mathLog10, mathExpm1, mathAtan, and mathCbrt match host within tight ULP bounds", () => {
  for (const edge of [NaN, -Infinity, -1, -0, 0, 1, 2, 10, 1000, Infinity]) {
    assert.ok(ulpDistance(mathLog(edge), Math.log(edge)) <= 2, `log(${edge})`);
    assert.ok(
      ulpDistance(mathLog2(edge), Math.log2(edge)) <= 2,
      `log2(${edge})`,
    );
    assert.ok(
      ulpDistance(mathLog10(edge), Math.log10(edge)) <= 2,
      `log10(${edge})`,
    );
    assert.ok(
      ulpDistance(mathExpm1(edge), Math.expm1(edge)) <= 2,
      `expm1(${edge})`,
    );
    assert.ok(
      ulpDistance(mathAtan(edge), Math.atan(edge)) <= 2,
      `atan(${edge})`,
    );
    assert.ok(
      ulpDistance(mathCbrt(edge), Math.cbrt(edge)) <= 3,
      `cbrt(${edge})`,
    );
  }

  for (const sub of [5e-324, 1e-320, 2.225073858507201e-308, 1e308]) {
    assert.ok(ulpDistance(mathLog(sub), Math.log(sub)) <= 2, `log(${sub})`);
    assert.ok(ulpDistance(mathCbrt(sub), Math.cbrt(sub)) <= 3, `cbrt(${sub})`);
    assert.ok(
      ulpDistance(mathCbrt(-sub), Math.cbrt(-sub)) <= 3,
      `cbrt(${-sub})`,
    );
  }

  for (let i = 1; i <= 2000; i++) {
    const x = Math.pow(10, (i / 2000) * 600 - 300) * (1 + (i % 31) * 0.03);
    assert.ok(ulpDistance(mathLog(x), Math.log(x)) <= 2);
    assert.ok(ulpDistance(mathLog2(x), Math.log2(x)) <= 2);
    assert.ok(ulpDistance(mathLog10(x), Math.log10(x)) <= 2);
    assert.ok(ulpDistance(mathCbrt(x), Math.cbrt(x)) <= 3);

    const a = (i / 2000 - 0.5) * 20;
    assert.ok(ulpDistance(mathAtan(a), Math.atan(a)) <= 2);

    const e = i / 2000 - 0.5;
    assert.ok(ulpDistance(mathExpm1(e), Math.expm1(e)) <= 2);
  }

  assert.ok(ulpDistance(mathAtan2(1.5, -2.5), Math.atan2(1.5, -2.5)) <= 2);
  assert.ok(ulpDistance(mathPow(2.5, 3.7), Math.pow(2.5, 3.7)) <= 4);
});

test("mathHypot3 handles zero, scaling, Infinity before NaN, and exact 3D norms", () => {
  assert.ok(Object.is(mathHypot3(0, -0, 0), 0));
  assert.equal(mathHypot3(Infinity, NaN, 1), Infinity);
  assert.equal(mathHypot3(NaN, -Infinity, 0), Infinity);
  assert.equal(mathHypot3(1, 2, -Infinity), Infinity);
  assert.ok(Number.isNaN(mathHypot3(1, NaN, 2)));
  assert.equal(mathHypot3(2, 3, 6), 7);
  assert.ok(
    ulpDistance(
      mathHypot3(3e200, 4e200, 12e200),
      Math.hypot(3e200, 4e200, 12e200),
    ) <= 2,
  );
  assert.ok(
    ulpDistance(
      mathHypot3(3e-200, 4e-200, 12e-200),
      Math.hypot(3e-200, 4e-200, 12e-200),
    ) <= 2,
  );
});
