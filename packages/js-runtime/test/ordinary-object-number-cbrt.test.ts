import assert from "node:assert/strict";
import { test } from "node:test";
import * as objects from "../src/objects/index.ts";

function cubeRoot(): (value: number) => number {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<objects.ScriptPropertyKey, unknown>(
    undefined,
  );
  const realm = objects.createErrorRealm(root, hooks);
  objects.installMathIntrinsics(root, realm, hooks, undefined);
  const math = objects.getOwnProperty(root, "Math")!
    .value as objects.OrdinaryObject<objects.ScriptPropertyKey, unknown>;
  const descriptor = objects.getOwnProperty(math, "cbrt");
  assert.ok(descriptor, "Math.cbrt is installed");
  const method = descriptor.value as objects.OrdinaryObject<
    objects.ScriptPropertyKey,
    unknown
  >;
  return (value) =>
    method.internalRareSlots!.internalCall!(undefined, [value]) as number;
}

test("cube roots preserve exceptional values and exact integer cubes", () => {
  const cbrt = cubeRoot();
  for (const value of [NaN, Infinity, -Infinity, -0, 0])
    assert.ok(Object.is(cbrt(value), value));
  for (let root = -100; root <= 100; root++)
    assert.equal(cbrt(root * root * root), root);
});

test("cube roots remain accurate across normal and subnormal exponents", () => {
  const cbrt = cubeRoot();
  for (let exponent = -1074; exponent <= 1023; exponent++) {
    for (const mantissa of [1, 1.125, 1.75]) {
      const value = mantissa * 2 ** exponent;
      const expected = Math.cbrt(value);
      const actual = cbrt(value);
      assert.ok(
        Math.abs(actual / expected - 1) <= 3 * Number.EPSILON,
        String(value),
      );
      assert.equal(cbrt(-value), -actual);
    }
  }
});
