import type { ScriptPropertyKey } from "@tint/js-runtime/objects";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as objects from "../src/objects/index.ts";

test("Math.pow exposes standard descriptors and integer-power special values", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  objects.installMathIntrinsics(root, realm, hooks, undefined);
  const math = objects.getOwnProperty(root, "Math")!
    .value as objects.OrdinaryObject<ScriptPropertyKey, unknown>;
  const descriptor = objects.getOwnProperty(math, "pow")!;
  for (const name of [
    "E",
    "LN10",
    "LN2",
    "LOG10E",
    "LOG2E",
    "PI",
    "SQRT1_2",
    "SQRT2",
  ] as const) {
    const constant = objects.getOwnProperty(math, name)!;
    assert.equal(constant?.value, Math[name]);
    assert.equal(constant.writable, false);
    assert.equal(constant.enumerable, false);
    assert.equal(constant.configurable, false);
  }
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.configurable, true);
  const pow = descriptor.value as objects.OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  assert.equal(objects.getOwnProperty(pow, "length")!.value, 2);
  assert.equal(objects.getOwnProperty(pow, "name")!.value, "pow");
  for (const base of [NaN, Infinity, -Infinity, -0, 0, -2, -1, 0.5, 1, 2]) {
    for (const exponent of [
      NaN,
      Infinity,
      -Infinity,
      -1074,
      -1024,
      -3,
      -2,
      -0,
      0,
      1,
      2,
      3,
      32,
      1024,
    ]) {
      assert.ok(
        Object.is(
          pow.internalRareSlots!.internalCall!(undefined, [base, exponent]),
          Math.pow(base, exponent),
        ),
        `${base} ** ${exponent}`,
      );
    }
  }
  assert.equal(
    pow.internalRareSlots!.internalCall!(undefined, ["2", "32"]),
    4294967296,
  );
});

test("Math has its configurable nonwritable toStringTag", () => {
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
  const tag = objects.getOwnProperty(
    math,
    objects.wellKnownSymbol(realm.symbolRegistry, "toStringTag"),
  );
  assert.ok(tag);
  assert.equal(tag.value, "Math");
  assert.equal(tag.writable, false);
  assert.equal(tag.enumerable, false);
  assert.equal(tag.configurable, true);
});

test("Math unary intrinsics preserve numeric special values and descriptors", () => {
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
  for (const name of [
    "abs",
    "ceil",
    "floor",
    "trunc",
    "round",
    "sign",
    "sqrt",
    "clz32",
  ] as const) {
    const descriptor = objects.getOwnProperty(math, name);
    assert.ok(descriptor, name);
    assert.equal(descriptor.enumerable, false);
    const method = descriptor.value as objects.OrdinaryObject<
      objects.ScriptPropertyKey,
      unknown
    >;
    assert.equal(objects.getOwnProperty(method, "length")?.value, 1);
    assert.ok(method.internalRareSlots?.internalCall);
    for (const value of [
      NaN,
      Infinity,
      -Infinity,
      -0,
      0,
      0.1,
      -0.1,
      0.5,
      -0.5,
      1.5,
      -1.5,
      4294967297,
      Number.MAX_SAFE_INTEGER,
    ])
      assert.ok(
        Object.is(
          method.internalRareSlots?.internalCall(undefined, [value]),
          Math[name](value),
        ),
        `${name}(${value})`,
      );
  }
});

test("Math.random consumes its embedding capability per call without coercing arguments", () => {
  const hooks: objects.ObjectHooks<unknown> = {
    undefinedValue: undefined,
    sameValue: Object.is,
    call: () => undefined,
  };
  const root = objects.createObject<ScriptPropertyKey, unknown>(undefined);
  const realm = objects.createErrorRealm(root, hooks);
  let calls = 0;
  objects.installMathIntrinsics(root, realm, hooks, () => ++calls / 4);
  const math = objects.getOwnProperty(root, "Math")!
    .value as objects.OrdinaryObject<ScriptPropertyKey, unknown>;
  const descriptor = objects.getOwnProperty(math, "random");
  assert.ok(descriptor);
  const fn = descriptor.value as objects.OrdinaryObject<
    ScriptPropertyKey,
    unknown
  >;
  assert.equal(
    fn.internalRareSlots!.internalCall!(undefined, [
      {
        valueOf() {
          throw new Error("unused");
        },
      },
    ]),
    0.25,
  );
  assert.equal(fn.internalRareSlots!.internalCall!(undefined, []), 0.5);
  assert.equal(calls, 2);
  assert.equal(objects.getOwnProperty(fn, "length")!.value, 0);
  assert.equal(objects.getOwnProperty(fn, "name")!.value, "random");
  assert.equal(fn.internalRareSlots?.internalConstruct, undefined);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.configurable, true);
});
