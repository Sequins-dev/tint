import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fromParts,
  fromSafeInteger,
  toSafeInteger,
  add,
  subtract,
} from "@tint/foundation/binary/word64";

test("constructs exact halves and refuses truncation", () => {
  assert.deepEqual(fromParts(0x89abcdef, 0xfedcba98), {
    ok: true,
    value: { lo: 0x89abcdef, hi: 0xfedcba98 },
  });
  for (const n of [-1, 0x100000000, 0.5, NaN, Infinity]) {
    assert.deepEqual(fromParts(n, 0), { ok: false, error: "INVALID_WORD" });
    assert.deepEqual(fromParts(0, n), { ok: false, error: "INVALID_WORD" });
  }
});
test("Number conversions reject inexact values", () => {
  assert.deepEqual(fromSafeInteger(Number.MAX_SAFE_INTEGER), {
    ok: true,
    value: { lo: 0xffffffff, hi: 0x1fffff },
  });
  assert.deepEqual(toSafeInteger({ lo: 0xffffffff, hi: 0x1fffff }), {
    ok: true,
    value: Number.MAX_SAFE_INTEGER,
  });
  for (const n of [-1, 1.5, NaN, Infinity, 2 ** 53])
    assert.equal(fromSafeInteger(n).ok, false);
  assert.deepEqual(toSafeInteger({ lo: 1, hi: 0x200000 }), {
    ok: false,
    error: "INVALID_NUMBER",
  });
});
test("carries, borrows, and overflow are explicit", () => {
  assert.deepEqual(add({ lo: 0xffffffff, hi: 4 }, { lo: 1, hi: 2 }), {
    ok: true,
    value: { lo: 0, hi: 7 },
  });
  assert.deepEqual(subtract({ lo: 0, hi: 7 }, { lo: 1, hi: 2 }), {
    ok: true,
    value: { lo: 0xffffffff, hi: 4 },
  });
  assert.deepEqual(add({ lo: 0xffffffff, hi: 0xffffffff }, { lo: 1, hi: 0 }), {
    ok: false,
    error: "OVERFLOW",
  });
  assert.deepEqual(subtract({ lo: 0, hi: 0 }, { lo: 1, hi: 0 }), {
    ok: false,
    error: "UNDERFLOW",
  });
  assert.equal(add({ lo: NaN, hi: 0 }, { lo: 0, hi: 0 }).ok, false);
  assert.equal(subtract({ lo: 0, hi: 0 }, { lo: 0, hi: -1 }).ok, false);
});
test("agrees with independent BigInt arithmetic on a deterministic sample", () => {
  let seed = 123456;
  function next() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  }
  for (let i = 0; i < 300; i++) {
    const a = { lo: next(), hi: next() },
      b = { lo: next(), hi: next() };
    const av = (BigInt(a.hi) << 32n) + BigInt(a.lo),
      bv = (BigInt(b.hi) << 32n) + BigInt(b.lo);
    for (const [result, expected] of [
      [add(a, b), av + bv],
      [subtract(a, b), av - bv],
    ] as const) {
      if (expected < 0n || expected > 0xffffffffffffffffn)
        assert.equal(result.ok, false);
      else {
        assert.equal(result.ok, true);
        if (result.ok)
          assert.equal(
            (BigInt(result.value.hi) << 32n) + BigInt(result.value.lo),
            expected,
          );
      }
    }
  }
});
