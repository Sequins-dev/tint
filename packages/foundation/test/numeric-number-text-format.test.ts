import assert from "node:assert/strict";
import { test } from "node:test";
import * as numeric from "../src/numeric/number-text/index.ts";

test("safe integer formatting avoids arbitrary-precision workspaces", () => {
  const Original = globalThis.Uint32Array;
  let allocations = 0;
  globalThis.Uint32Array = new Proxy(Original, {
    construct(target, args) {
      allocations++;
      return Reflect.construct(target, args);
    },
  });
  try {
    const values = [0, -0, 1, -1, 9, 10, 99, 100, 4294967295];
    for (let exponent = 1; exponent <= 15; exponent++) {
      const power = 10 ** exponent;
      values.push(power - 1, power, power + 1);
    }
    for (let delta = 0; delta < 32; delta++)
      values.push(Number.MAX_SAFE_INTEGER - delta);
    for (const value of values) {
      assert.equal(numeric.numberToString(value), String(value));
      assert.equal(numeric.numberToString(-value), String(-value));
    }
    assert.equal(allocations, 0);
  } finally {
    globalThis.Uint32Array = Original;
  }
});

test("number formatting matches ECMAScript decimal boundaries and rounding", () => {
  assert.ok("numberToString" in numeric, "missing native number formatter");
  const format = numeric.numberToString;
  assert.equal(typeof format, "function");
  if (typeof format !== "function") throw new Error("missing formatter");
  for (const value of [
    NaN,
    Infinity,
    -Infinity,
    0,
    -0,
    1,
    -1,
    0.1,
    0.5,
    1e-6,
    1e-7,
    1e20,
    1e21,
    5e-324,
    2.2250738585072014e-308,
    Number.MAX_VALUE,
    9007199254740992,
    1000000000000000100,
    1.2345678901234567,
  ])
    assert.equal(format(value), String(value), String(value));
});

test("number formatting agrees with Node for deterministic binary64 values", () => {
  assert.ok("numberToString" in numeric, "missing native number formatter");
  const format = numeric.numberToString;
  if (typeof format !== "function") throw new Error("missing formatter");
  const data = new DataView(new ArrayBuffer(8));
  let seed = 777;
  for (let i = 0; i < 2000; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data.setUint32(0, seed);
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data.setUint32(4, seed);
    const value = data.getFloat64(0);
    assert.equal(format(value), String(value), String(value));
  }
});
