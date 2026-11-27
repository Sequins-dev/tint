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

test("flat BigIntValue runtime ops match ECMAScript BigInt across 1 to 6 limbs and negative XOR", async () => {
  const bi = await import("../src/values/bigint.ts");
  const { bigIntFromString } = await import("@tint/js-runtime/objects");
  const samples = [
    0n,
    1n,
    -1n,
    7n,
    -7n,
    (1n << 26n) - 1n,
    1n << 26n,
    -(1n << 26n),
    (1n << 52n) - 1n,
    -(1n << 52n) + 1n,
    (1n << 64n) - 1n,
    -(1n << 63n),
    (1n << 78n) - 1n,
    (1n << 96n) - 1n,
    (1n << 104n) - 1n,
    -((1n << 104n) - 1n),
    (1n << 130n) + 123456789n,
    -((1n << 130n) + 123456789n),
    (1n << 155n) - 1n,
    -((1n << 155n) - 1n),
  ];
  const parsed = samples.map((n) => bi.literal(String(n)));
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i]!;
    const av = parsed[i]!;
    assert.equal(bi.bigIntToString(av), String(a));
    for (let j = 0; j < samples.length; j++) {
      const b = samples[j]!;
      const bv = parsed[j]!;
      assert.equal(
        bi.bigIntToString(bi.addBigInt(av, bv)),
        String(a + b),
        `${a} + ${b}`,
      );
      assert.equal(
        bi.bigIntToString(bi.subtractBigInt(av, bv)),
        String(a - b),
        `${a} - ${b}`,
      );
      assert.equal(
        bi.bigIntToString(bi.multiplyBigInt(av, bv)),
        String(a * b),
        `${a} * ${b}`,
      );
      assert.equal(
        bi.bigIntToString(bi.andBigInt(av, bv)),
        String(a & b),
        `${a} & ${b}`,
      );
      assert.equal(
        bi.bigIntToString(bi.orBigInt(av, bv)),
        String(a | b),
        `${a} | ${b}`,
      );
      assert.equal(
        bi.bigIntToString(bi.xorBigInt(av, bv)),
        String(a ^ b),
        `${a} ^ ${b}`,
      );
      if (b !== 0n) {
        assert.equal(
          bi.bigIntToString(bi.divideBigInt(av, bv)),
          String(a / b),
          `${a} / ${b}`,
        );
        assert.equal(
          bi.bigIntToString(bi.remainderBigInt(av, bv)),
          String(a % b),
          `${a} % ${b}`,
        );
      }
    }
    for (const s of [0n, 1n, 3n, 25n, 26n, 27n, 32n, 52n, 64n, 78n, 104n]) {
      const sv = bi.literal(String(s));
      assert.equal(
        bi.bigIntToString(bi.leftShiftBigInt(av, sv)),
        String(a << s),
        `${a} << ${s}`,
      );
      assert.equal(
        bi.bigIntToString(bi.rightShiftBigInt(av, sv)),
        String(a >> s),
        `${a} >> ${s}`,
      );
    }
  }
  for (const raw of [
    "  +123456789012345678901234567890  ",
    "\t-987654321098765432109876543210\n",
    " 0xdeadbeefcafebabe1234567890abcdef ",
    " 0o765432107654321076543210 ",
    " 0b1010101010101010101010101010101010101010101010101010101010101010 ",
  ]) {
    const parsedRaw = bigIntFromString(raw);
    assert.ok(parsedRaw, raw);
    assert.equal(bi.bigIntToString(parsedRaw), String(BigInt(raw)));
  }
});
