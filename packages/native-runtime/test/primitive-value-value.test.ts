import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fromNull,
  isNullish,
  fromNumber,
  fromBoolean,
  fromString,
  fromUndefined,
  readNumber,
  readBoolean,
  readString,
  kindOf,
  strictEqual,
  sameValueZero,
  truthy,
  fromOptionalNumber,
  fromOptionalString,
  readOptionalNumber,
  readOptionalString,
  canonicalKey,
  fromOptionalBoolean,
  readOptionalBoolean,
  fromOptionalBox,
} from "../src/values/index.ts";

test("primitive boxes retain kind, payload, signed zero and UTF-16", () => {
  assert.equal(kindOf(fromUndefined()), "undefined");
  assert.equal(kindOf(fromNumber(1)), "number");
  assert.equal(kindOf(fromBoolean(false)), "boolean");
  assert.equal(kindOf(fromString("")), "string");
  for (const n of [0, -0, NaN, Infinity, -Infinity, 42])
    assert.ok(Object.is(readNumber(fromNumber(n)), n));
  for (const b of [false, true]) assert.equal(readBoolean(fromBoolean(b)), b);
  for (const s of ["", "a\u0000b", "\ud800", "😀"])
    assert.equal(readString(fromString(s)), s);
});

test("boxed comparisons follow primitive identity, not allocation identity", () => {
  const values = [
    undefined,
    0,
    -0,
    NaN,
    Infinity,
    -Infinity,
    1,
    false,
    true,
    "",
    "0",
    "a",
    "\ud800",
  ];
  function box(value: (typeof values)[number]) {
    if (typeof value === "number") return fromNumber(value);
    if (typeof value === "boolean") return fromBoolean(value);
    if (typeof value === "string") return fromString(value);
    return fromUndefined();
  }
  for (const left of values)
    for (const right of values) {
      assert.equal(strictEqual(box(left), box(right)), left === right);
      assert.equal(
        sameValueZero(box(left), box(right)),
        new Set([left]).has(right),
      );
    }
  for (const value of values) assert.equal(truthy(box(value)), Boolean(value));
});

test("optional scalar bridges preserve absence without conflating falsy payloads", () => {
  for (const value of [undefined, false, true])
    assert.equal(readOptionalBoolean(fromOptionalBoolean(value)), value);
  const box = fromNumber(1);
  assert.equal(fromOptionalBox(box), box);
  assert.equal(kindOf(fromOptionalBox(undefined)), "undefined");
  for (const value of [undefined, 0, -0, NaN, 2])
    assert.ok(Object.is(readOptionalNumber(fromOptionalNumber(value)), value));
  for (const value of [undefined, "", "a"])
    assert.equal(readOptionalString(fromOptionalString(value)), value);
  assert.throws(() => readOptionalNumber(fromString("1")));
  assert.throws(() => readOptionalString(fromNumber(1)));
});
test("collection key normalization canonicalizes negative zero and retains other boxes", () => {
  assert.ok(Object.is(readNumber(canonicalKey(fromNumber(-0))), 0));
  for (const box of [
    fromNumber(0),
    fromNumber(NaN),
    fromNumber(1),
    fromString("0"),
    fromBoolean(false),
    fromUndefined(),
  ])
    assert.equal(canonicalKey(box), box);
});

test("extraction checks the tag before exposing a payload", () => {
  for (const value of [
    fromNumber(1),
    fromBoolean(true),
    fromString("x"),
    fromUndefined(),
  ]) {
    if (kindOf(value) !== "number") assert.throws(() => readNumber(value));
    if (kindOf(value) !== "boolean") assert.throws(() => readBoolean(value));
    if (kindOf(value) !== "string") assert.throws(() => readString(value));
  }
});

test("null boxes preserve JavaScript equality, typeof and nullish behavior", () => {
  const value = fromNull();
  assert.equal(kindOf(value), "object");
  assert.equal(truthy(value), false);
  assert.equal(strictEqual(value, fromNull()), true);
  assert.equal(strictEqual(value, fromUndefined()), false);
  assert.equal(isNullish(value), true);
  assert.equal(isNullish(fromUndefined()), true);
  assert.equal(isNullish(fromNumber(0)), false);
  assert.equal(isNullish(fromBoolean(false)), false);
  assert.equal(isNullish(fromString("")), false);
});
