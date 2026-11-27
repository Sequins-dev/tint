import { test } from "node:test";
import assert from "node:assert/strict";
import * as integer from "../src/numeric/big-integer.ts";
function parse(value: bigint | string) {
  const result = integer.parseInteger(String(value), 10);
  assert.ok(result);
  return result;
}
function text(value: integer.Integer) {
  return integer.formatInteger(value, 10);
}
test("integer parsing preserves sign and arbitrary precision in radices 2 through 36", () => {
  assert.equal(typeof integer.parseInteger, "function");
  for (const value of [
    0n,
    1n,
    -1n,
    67108863n,
    67108864n,
    9007199254740993n,
    -(2n ** 200n) + 1n,
  ])
    for (let radix = 2; radix <= 36; radix++) {
      const parsed = integer.parseInteger(value.toString(radix), radix);
      assert.ok(parsed);
      assert.equal(integer.formatInteger(parsed, radix), value.toString(radix));
    }
  assert.equal(text(parse("-0000")), "0");
  assert.equal(parse("-0").negative, false);
  for (const input of ["", "-", "+", " 1", "1 ", "1_0", "1.0", "0x1", "NaN"])
    assert.equal(integer.parseInteger(input, 10), undefined, input);
  assert.equal(integer.parseInteger("2", 2), undefined);
  assert.equal(integer.parseInteger("1", 1), undefined);
  assert.equal(integer.parseInteger("1", 37), undefined);
});
test("signed arithmetic crosses carry boundaries and does not mutate operands", () => {
  const values = [
    0n,
    1n,
    -1n,
    67108863n,
    67108864n,
    67108865n,
    2n ** 130n - 1n,
    -(2n ** 130n),
  ];
  for (const a of values)
    for (const b of values) {
      const x = parse(a),
        y = parse(b),
        beforeX = structuredClone(x),
        beforeY = structuredClone(y);
      assert.equal(text(integer.add(x, y)), String(a + b));
      assert.equal(text(integer.subtract(x, y)), String(a - b));
      assert.equal(text(integer.multiply(x, y)), String(a * b));
      assert.equal(integer.compare(x, y), a < b ? -1 : a > b ? 1 : 0);
      assert.deepEqual(x, beforeX);
      assert.deepEqual(y, beforeY);
    }
});
test("division truncates toward zero, retains dividend remainder sign and rejects zero", () => {
  const values = [
    0n,
    1n,
    -1n,
    67108863n,
    67108864n,
    2n ** 101n + 98765n,
    -(2n ** 130n) + 1n,
  ];
  for (const a of values)
    for (const b of values) {
      const result = integer.divide(parse(a), parse(b));
      if (b === 0n) {
        assert.equal(result, undefined);
        continue;
      }
      assert.ok(result);
      assert.equal(text(result.quotient), String(a / b));
      assert.equal(text(result.remainder), String(a % b));
    }
});
test("deterministic differential arithmetic agrees with native BigInt", () => {
  let seed = 123456789;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return BigInt(seed);
  }
  for (let i = 0; i < 150; i++) {
    let a =
      (random() << 96n) | (random() << 64n) | (random() << 32n) | random();
    let b = (random() << 32n) | random();
    if (i % 2) a = -a;
    if (i % 3) b = -b;
    const x = parse(a),
      y = parse(b);
    assert.equal(text(integer.add(x, y)), String(a + b));
    assert.equal(text(integer.subtract(x, y)), String(a - b));
    assert.equal(text(integer.multiply(x, y)), String(a * b));
    const result = integer.divide(x, y);
    assert.ok(result);
    assert.equal(text(result.quotient), String(a / b));
    assert.equal(text(result.remainder), String(a % b));
  }
});
test("bitwise operations use infinite sign extension rather than magnitude bits", () => {
  const values = [
    0n,
    1n,
    -1n,
    67108863n,
    67108864n,
    2n ** 150n - 1n,
    -(2n ** 150n),
  ];
  for (const a of values) {
    assert.equal(text(integer.bitwiseNot(parse(a))), String(~a));
    for (const b of values) {
      assert.equal(
        text(integer.bitwise(parse(a), parse(b), "&")),
        String(a & b),
      );
      assert.equal(
        text(integer.bitwise(parse(a), parse(b), "|")),
        String(a | b),
      );
      assert.equal(
        text(integer.bitwise(parse(a), parse(b), "^")),
        String(a ^ b),
      );
    }
  }
});
test("signed shifts handle limb boundaries, negative counts and discarded negative bits", () => {
  const values = [
    0n,
    1n,
    -1n,
    3n,
    -3n,
    67108863n,
    67108864n,
    2n ** 140n + 123n,
    -(2n ** 140n) - 123n,
  ];
  for (const value of values)
    for (const count of [
      -200n,
      -53n,
      -52n,
      -27n,
      -26n,
      -25n,
      -1n,
      0n,
      1n,
      25n,
      26n,
      27n,
      52n,
      53n,
      200n,
    ]) {
      const shifted = integer.shift(parse(value), parse(count), 32);
      assert.ok(shifted);
      assert.equal(
        text(shifted),
        String(value << count),
        `${value} << ${count}`,
      );
    }
  const huge = 2n ** 100n;
  assert.equal(integer.shift(parse(1n), parse(huge), 32), undefined);
  assert.equal(text(integer.shift(parse(0n), parse(huge), 0)!), "0");
  assert.equal(text(integer.shift(parse(-3n), parse(-huge), 1)!), "-1");
  assert.equal(text(integer.shift(parse(3n), parse(-huge), 0)!), "0");
  assert.equal(integer.shift(parse(1n), parse(26n), 1), undefined);
  assert.equal(text(integer.shift(parse(1n), parse(25n), 1)!), "33554432");
  assert.equal(integer.shift(parse(1n), parse(0n), -1), undefined);
});
test("bounded powers handle signs, zero and huge exponents on constant results", () => {
  for (const a of [-123456789n, -2n, -1n, 0n, 1n, 2n, 123456789n])
    for (let e = 0n; e < 13n; e++) {
      const result = integer.power(parse(a), parse(e), 64);
      assert.ok(result);
      assert.equal(text(result), String(a ** e));
    }
  const huge = 2n ** 100n;
  assert.equal(text(integer.power(parse(-1n), parse(huge), 1)!), "1");
  assert.equal(text(integer.power(parse(-1n), parse(huge + 1n), 1)!), "-1");
  assert.equal(text(integer.power(parse(0n), parse(huge), 0)!), "0");
  assert.equal(integer.power(parse(0n), parse(0n), 0), undefined);
  assert.equal(integer.power(parse(2n), parse(-1n), 64), undefined);
  assert.equal(integer.power(parse(2n), parse(huge), 64), undefined);
  assert.equal(integer.power(parse(2n), parse(26n), 1), undefined);
  assert.equal(text(integer.power(parse(2n), parse(25n), 1)!), "33554432");
});
test("number conversion preserves exact integral inputs and rounds integer outputs once", () => {
  for (const value of [
    0,
    -0,
    1,
    -1,
    2 ** 53,
    2 ** 100,
    Number.MAX_VALUE,
    -Number.MAX_VALUE,
  ]) {
    const result = integer.fromNumber(value);
    assert.ok(result);
    assert.equal(text(result), String(BigInt(value)));
    assert.equal(integer.toNumber(result), value === 0 ? 0 : value);
  }
  for (const invalid of [NaN, Infinity, -Infinity, 0.5, -0.5])
    assert.equal(integer.fromNumber(invalid), undefined);
  const values = [
    2n ** 53n - 1n,
    2n ** 53n + 1n,
    2n ** 53n + 3n,
    2n ** 100n + 2n ** 47n - 1n,
    2n ** 100n + 2n ** 47n,
    2n ** 100n + 2n ** 47n + 1n,
    2n ** 1024n - 2n ** 970n - 1n,
    2n ** 1024n - 2n ** 970n,
    2n ** 1100n,
  ];
  for (const value of values) {
    assert.equal(integer.toNumber(parse(value)), Number(value), String(value));
    assert.equal(integer.toNumber(parse(-value)), Number(-value));
  }
});
test("mixed number comparisons retain precision and fractional ordering", () => {
  for (const a of [-9007199254740993n, -1n, 0n, 1n, 9007199254740993n])
    for (const b of [
      -Infinity,
      -2.5,
      -1,
      -0.5,
      0,
      0.5,
      1,
      2.5,
      9007199254740992,
      Infinity,
      NaN,
    ]) {
      assert.equal(
        integer.compareNumber(parse(a), b),
        Number.isNaN(b) ? undefined : a < b ? -1 : a > b ? 1 : 0,
        `${a} versus ${b}`,
      );
    }
});
test("fixed-width truncation matches signed and unsigned BigInt at limb boundaries", () => {
  for (const bits of [
    0, 1, 2, 25, 26, 27, 51, 52, 53, 63, 64, 65, 127, 128, 129,
  ]) {
    for (const v of [
      0n,
      1n,
      -1n,
      2n,
      -2n,
      255n,
      -255n,
      (1n << 128n) - 1n,
      -(1n << 128n),
      (1n << 65n) + 123n,
    ]) {
      for (const signed of [false, true]) {
        const result = integer.truncateInteger(parse(v), bits, signed, 64);
        assert.ok(result);
        assert.equal(
          text(result),
          String(signed ? BigInt.asIntN(bits, v) : BigInt.asUintN(bits, v)),
          `${bits}, ${v}, ${signed}`,
        );
      }
    }
  }
  for (const signed of [false, true]) {
    assert.equal(
      text(
        integer.truncateInteger(
          parse(42n),
          Number.MAX_SAFE_INTEGER,
          signed,
          1,
        )!,
      ),
      "42",
    );
    assert.equal(
      text(
        integer.truncateInteger(parse(0n), Number.MAX_SAFE_INTEGER, signed, 0)!,
      ),
      "0",
    );
  }
  assert.equal(
    text(
      integer.truncateInteger(parse(-42n), Number.MAX_SAFE_INTEGER, true, 1)!,
    ),
    "-42",
  );
  assert.equal(
    integer.truncateInteger(parse(-1n), Number.MAX_SAFE_INTEGER, false, 64),
    undefined,
  );
  for (const bits of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(integer.truncateInteger(parse(1n), bits, true, 64), undefined);
});
test("inline 4-limb representation transitions cleanly across 104-bit boundaries, negative masks, shifts and 1-limb division", () => {
  const limit4 = (1n << 104n) - 1n;
  const parsed4 = parse(limit4);
  assert.equal(parsed4.len, 4);
  assert.equal(parsed4.digits, undefined);
  const overflow = integer.add(parsed4, integer.integerOne());
  assert.equal(overflow.len, 5);
  assert.ok(overflow.digits !== undefined);
  assert.equal(text(overflow), String(1n << 104n));
  const backInline = integer.subtract(overflow, integer.integerOne());
  assert.equal(backInline.len, 4);
  assert.equal(backInline.digits, undefined);
  assert.equal(text(backInline), String(limit4));

  // Hex parsing up to 26 digits (104 bits) stays inline; 27 digits promotes.
  const hex26 = integer.parseInteger("f".repeat(26), 16)!;
  assert.equal(hex26.len, 4);
  assert.equal(hex26.digits, undefined);
  assert.equal(text(hex26), String(limit4));
  const hex27 = integer.parseInteger("1" + "0".repeat(26), 16)!;
  assert.equal(hex27.len, 5);
  assert.ok(hex27.digits !== undefined);
  assert.equal(text(hex27), String(1n << 104n));

  // Negative two's-complement bitwise across 26/52/78/104-bit limb boundaries.
  const samples = [
    0n,
    1n,
    -1n,
    -(1n << 26n),
    -(1n << 26n) - 1n,
    -(1n << 52n),
    -(1n << 52n) + 1n,
    -(1n << 63n),
    (1n << 63n) - 1n,
    (1n << 64n) - 1n,
    -(1n << 78n),
    limit4,
    -limit4,
    -(1n << 104n),
    (1n << 120n) + 0x12345n,
    -(1n << 120n) - 0x12345n,
  ];
  const masks = [
    0n,
    1n,
    -1n,
    0x7fffffffn,
    0xffffffffn,
    (1n << 52n) - 1n,
    (1n << 96n) - 1n,
    -(1n << 26n),
    -(1n << 52n),
  ];
  for (const a of samples) {
    for (const b of masks) {
      for (const op of ["&", "|", "^"] as const) {
        const expected = op === "&" ? a & b : op === "|" ? a | b : a ^ b;
        assert.equal(
          text(integer.bitwise(parse(a), parse(b), op)),
          String(expected),
          `${a} ${op} ${b}`,
        );
      }
    }
  }

  // shiftSigned across limb boundaries without allocating negated counts.
  for (const v of samples) {
    for (const shift of [
      0n,
      1n,
      3n,
      17n,
      25n,
      26n,
      27n,
      32n,
      51n,
      52n,
      53n,
      64n,
      78n,
      104n,
      -3n,
      -26n,
      -52n,
    ]) {
      const left = integer.shiftSigned(parse(v), parse(shift), false, 64)!;
      assert.equal(text(left), String(v << shift), `${v} << ${shift}`);
      const right = integer.shiftSigned(parse(v), parse(shift), true, 64)!;
      assert.equal(text(right), String(v >> shift), `${v} >> ${shift}`);
    }
  }

  // divideQuotient and divideRemainder match divide and BigInt on 1-limb and multi-limb divisors.
  for (const a of samples) {
    for (const b of [
      1n,
      -1n,
      17n,
      -97n,
      67108863n,
      67108864n,
      -67108865n,
      (1n << 64n) + 7n,
    ]) {
      const q = integer.divideQuotient(parse(a), parse(b))!;
      const r = integer.divideRemainder(parse(a), parse(b))!;
      assert.equal(text(q), String(a / b), `${a} / ${b}`);
      assert.equal(text(r), String(a % b), `${a} % ${b}`);
    }
    assert.equal(
      integer.divideQuotient(parse(a), integer.integerZero()),
      undefined,
    );
    assert.equal(
      integer.divideRemainder(parse(a), integer.integerZero()),
      undefined,
    );
  }

  // integerHash matches for equivalent inline and multi-limb constructions.
  for (const v of samples) {
    const a = parse(v);
    const b = integer.add(a, integer.integerZero());
    assert.equal(integer.integerHash(a), integer.integerHash(b), `hash ${v}`);
  }
});
