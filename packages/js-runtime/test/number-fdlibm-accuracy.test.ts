import assert from "node:assert/strict";
import { test } from "node:test";
import { numberExp } from "../src/objects/number-exp.ts";
import { numberLog1p } from "../src/objects/number-log.ts";
import { numberAsinh } from "../src/objects/number-hyperbolic.ts";
import { binaryExponent, powerOfTwo } from "../src/objects/number-scale.ts";

/** Units in the last place between two finite doubles of the same sign. */
function ulps(a: number, b: number): number {
  const view = new DataView(new ArrayBuffer(16));
  view.setFloat64(0, a);
  view.setFloat64(8, b);
  return Number(view.getBigInt64(0) - view.getBigInt64(8)) * (a < 0 ? -1 : 1);
}
function near(actual: number, expected: number, label: string): void {
  assert.ok(
    Math.abs(ulps(actual, expected)) <= 1,
    `${label}: ${actual} vs ${expected}`,
  );
}

test("exp is exact at the points engines pin (staging/sm/Math/exp-exact.js)", () => {
  assert.equal(numberExp(1), 2.718281828459045);
  assert.equal(numberExp(-1), 1 / 2.718281828459045);
  assert.ok(Object.is(numberExp(-0), 1));
  assert.ok(Object.is(numberExp(-Infinity), 0));
  assert.equal(numberExp(709.782712893384), 1.7976931348622732e308);
  assert.equal(numberExp(-745.1332191019411), 5e-324);
});
test("log1p stays within one ulp near zero (staging/sm/Math/log1p-approx.js)", () => {
  for (const [value, expected] of [
    [1e-300, 1e-300],
    [1e-15, 9.999999999999995e-16],
    [1e-6, 9.999995000003334e-7],
    [7.09962844069878e-15, 7.099628440698755e-15],
    [1.3671879628418538e-12, 1.3671879628409192e-12],
    [2.114990849122478e-10, 2.1149908488988187e-10],
    [1.6900931765206906e-8, 1.690093162238616e-8],
    [0.0000709962844069878, 0.00007099376429006658],
    [0.0016793412882520897, 0.00167793277137076],
    [0.011404608812881634, 0.011340066517988035],
  ] as const)
    near(numberLog1p(value), expected, `log1p(${value})`);
});
test("asinh of small arguments stays within one ulp (staging/sm/Math/asinh-approx.js)", () => {
  for (const [value, expected] of [
    [1.6504814008555524e-12, 1.6504814008555524e-12],
    [5.730159402528301e-11, 5.730159402528301e-11],
    [2.3050326092288742e-8, 2.305032609228874e-8],
    [0.00043952150736004114, 0.00043952149320897676],
    [1e-5, 0.000009999999999833334],
    [0.3, 0.29567304756342244],
    [1, 0.881373587019543],
  ] as const)
    near(numberAsinh(value), expected, `asinh(${value})`);
});
test("power-of-two scaling and exponent extraction are exact over the normal range", () => {
  for (let exponent = -1022; exponent <= 1023; exponent++) {
    const power = 2 ** exponent;
    assert.equal(powerOfTwo(exponent), power);
    assert.equal(binaryExponent(power), exponent);
    assert.equal(binaryExponent(power * (2 - Number.EPSILON)), exponent);
  }
});
