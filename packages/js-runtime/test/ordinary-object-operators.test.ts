import type { ScriptPropertyKey } from "@tint/js-runtime/objects";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";
test("primitive arithmetic applies JavaScript number and string conversion rules", () => {
  assert.equal(typeof objects.binaryValueOperation, "function");
  const cases: readonly [string, unknown, unknown, unknown][] = [
    ["+", 40, 2, 42],
    ["+", "4", 2, "42"],
    ["+", null, true, 1],
    ["+", undefined, "!", "undefined!"],
    ["/", "84", "2", 42],
    ["/", 1, -0, -Infinity],
    ["*", undefined, 1, NaN],
    ["-", "", true, -1],
    ["%", -5, 2, -1],
    ["/", "0x54", 2, 42],
    ["+", false, null, 0],
  ];
  for (const [op, left, right, expected] of cases) {
    const result = objects.binaryValueOperation(op, left, right);
    assert.equal(result.error, "none");
    assert.ok(Object.is(result.value, expected));
  }
  assert.equal(objects.binaryValueOperation("+", {}, 1).error, "unsupported");
});
test("primitive global constants have immutable non-enumerable descriptors", () => {
  assert.equal(typeof objects.installGlobalProperties, "function");
  const object = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  objects.installGlobalProperties(object, object, hooks);
  for (const key of ["undefined", "NaN", "Infinity"]) {
    const descriptor = objects.getOwnProperty(object, key)!;
    assert.equal(descriptor.writable, false);
    assert.equal(descriptor.enumerable, false);
    assert.equal(descriptor.configurable, false);
  }
  assert.ok(Number.isNaN(objects.getProperty(object, "NaN", object, hooks)));
});

test("primitive relational operators preserve string ordering and unordered numbers", () => {
  const values = [
    undefined,
    null,
    false,
    true,
    -Infinity,
    -1,
    -0,
    0,
    1,
    Infinity,
    NaN,
    "",
    "2",
    "10",
    "abc",
    "a",
    "aa",
    "\ud800",
    "\udfff",
  ];
  for (const left of values)
    for (const right of values) {
      for (const op of ["<", ">", "<=", ">="]) {
        const expected = Function("a", "b", `return a ${op} b`)(left, right);
        assert.deepEqual(objects.binaryValueOperation(op, left, right), {
          error: "none",
          value: expected,
        });
      }
    }
  assert.equal(objects.binaryValueOperation("<", {}, 1).error, "unsupported");
});

test("property key conversion rejects nullish bases before coercion", () => {
  assert.equal(typeof objects.primitivePropertyKey, "function");
  for (const [key, expected] of [
    [-0, "0"],
    [42, "42"],
    [true, "true"],
    [null, "null"],
    [undefined, "undefined"],
    ["x", "x"],
  ]) {
    assert.deepEqual(objects.primitivePropertyKey({}, key), {
      error: "none",
      value: expected,
    });
  }
  assert.deepEqual(objects.primitivePropertyKey(null, {}), {
    error: "type",
    value: "",
  });
  assert.deepEqual(objects.primitivePropertyKey(undefined, {}), {
    error: "type",
    value: "",
  });
  assert.equal(objects.primitivePropertyKey({}, {}).error, "unsupported");
});

test("runtime SameValue matches Object.is for primitive and reference identities", () => {
  assert.equal(typeof objects.sameValue, "function");
  const object = {},
    fn = () => {};
  const values = [
    undefined,
    null,
    false,
    true,
    -0,
    0,
    NaN,
    Infinity,
    "",
    "x",
    object,
    {},
    fn,
    () => {},
  ];
  for (const left of values)
    for (const right of values)
      assert.equal(objects.sameValue(left, right), Object.is(left, right));
});
test("primitive deletion only rejects string wrapper own properties", () => {
  const witness = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  for (const [base, key, accepted] of [
    [42, "anything", true],
    [true, "anything", true],
    ["abc", "length", false],
    ["abc", "0", false],
    ["abc", "2", false],
    ["abc", "3", true],
    ["abc", "-0", true],
    ["abc", "01", true],
    ["abc", "1.0", true],
    ["abc", "1e0", true],
    ["abc", "", true],
    ["abc", "slice", true],
    ["", "0", true],
    ["", "length", false],
  ] as const) {
    assert.deepEqual(
      objects.deleteObjectValueProperty(base, key, false, witness),
      { error: "none", value: accepted },
    );
    assert.deepEqual(
      objects.deleteObjectValueProperty(base, key, true, witness),
      { error: accepted ? "none" : "type", value: accepted },
    );
  }
  for (const base of [null, undefined])
    assert.deepEqual(
      objects.deleteObjectValueProperty(base, "x", false, witness),
      { error: "type", value: false },
    );
});
