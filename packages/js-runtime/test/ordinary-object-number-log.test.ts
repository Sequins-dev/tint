import assert from "node:assert/strict";
import { test } from "node:test";
import * as objects from "../src/objects/index.ts";

function logarithm(name: string): (value: number) => number {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const global = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(global, hooks);
  objects.installMathIntrinsics(global, realm, hooks, undefined);
  const math = objects.getOwnProperty(global, "Math")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  const descriptor = objects.getOwnProperty(math, name);
  assert.ok(descriptor, name);
  const method = descriptor.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  return (value) => method.internalCall!(undefined, [value]) as number;
}

for (const name of ["log", "log2", "log10", "log1p"] as const) {
  test(`${name} preserves exceptional values and stays accurate across exponents`, () => {
    const actual = logarithm(name);
    const values = [
      NaN,
      -Infinity,
      Infinity,
      -1,
      -2,
      -0,
      0,
      1,
      2,
      1 - Number.EPSILON,
      1 + Number.EPSILON,
    ];
    for (let exponent = -1074; exponent <= 1023; exponent++) {
      values.push(2 ** exponent, 1.5 * 2 ** exponent);
      if (exponent < 0) values.push(-(2 ** exponent));
    }
    for (const value of values) {
      const expected = Math[name](value),
        result = actual(value);
      if (!Number.isFinite(expected) || expected === 0)
        assert.ok(Object.is(result, expected), `${name}(${value})`);
      else
        assert.ok(
          Math.abs((result - expected) / expected) <= 4 * Number.EPSILON,
          `${name}(${value}): ${result} vs ${expected}`,
        );
    }
  });
}

test("log2 returns exact binary exponents including subnormals", () => {
  const log2 = logarithm("log2");
  for (let exponent = -1074; exponent <= 1023; exponent++)
    assert.equal(log2(2 ** exponent), exponent);
});
