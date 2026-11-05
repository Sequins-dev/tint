import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSet,
  hasSet,
  addSet,
  deleteSet,
  clearSet,
  sizeSet,
} from "@tint/foundation/collections/linked-set";
test("string membership uses content equality and isolates distinct sets", () => {
  const a = createSet<string>(),
    b = createSet<string>();
  for (const value of [
    "",
    "a\0b",
    "😀",
    "\ud800",
    "__proto__",
    "constructor",
  ]) {
    assert.equal(addSet(a, value), true);
    assert.equal(addSet(a, value.slice(0)), false);
    assert.equal(hasSet(a, value), true);
    assert.equal(hasSet(b, value), false);
  }
  assert.equal(sizeSet(a), 6);
  assert.equal(deleteSet(a, "missing"), false);
  assert.equal(deleteSet(a, ""), true);
  assert.equal(deleteSet(a, "😀"), true);
  assert.equal(deleteSet(a, "constructor"), true);
  assert.equal(sizeSet(a), 3);
  assert.equal(addSet(a, ""), true);
  clearSet(a);
  assert.equal(sizeSet(a), 0);
  assert.equal(hasSet(a, ""), false);
  assert.equal(addSet(a, ""), true);
  assert.equal(sizeSet(a), 1);
});
test("deterministic mutations agree with JavaScript Set", () => {
  const actual = createSet<string>(),
    expected = new Set<string>(),
    keys = ["", "a", "b", "a\0", "\ud800", "😀", "constructor", "__proto__"];
  let seed = 121;
  for (let i = 0; i < 500; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const key = keys[seed % keys.length]!;
    const operation = (seed >>> 8) % 4;
    if (operation === 0) {
      const added = !expected.has(key);
      expected.add(key);
      assert.equal(addSet(actual, key), added);
    } else if (operation === 1)
      assert.equal(deleteSet(actual, key), expected.delete(key));
    else if (operation === 2)
      assert.equal(hasSet(actual, key), expected.has(key));
    else if (i % 29 === 0) {
      clearSet(actual);
      expected.clear();
    }
    assert.equal(sizeSet(actual), expected.size);
    for (const key of keys)
      assert.equal(hasSet(actual, key), expected.has(key));
  }
});

test("generic storage uses SameValueZero for numbers and identity for objects", () => {
  const numbers = createSet<number>();
  for (const value of [NaN, 0, -0, Infinity, -Infinity, 3, NaN])
    addSet(numbers, value);
  assert.equal(sizeSet(numbers), 5);
  assert.ok(hasSet(numbers, NaN));
  assert.ok(deleteSet(numbers, -0));
  assert.ok(!hasSet(numbers, 0));
  assert.ok(deleteSet(numbers, NaN));
  const objects = createSet<{ value: number }>(),
    a = { value: 1 },
    b = { value: 1 };
  assert.ok(addSet(objects, a));
  assert.ok(addSet(objects, b));
  assert.ok(!addSet(objects, a));
  assert.ok(!hasSet(objects, { value: 1 }));
  assert.ok(deleteSet(objects, b));
  assert.ok(hasSet(objects, a));
  const mixed = createSet<number | string | undefined>();
  addSet(mixed, 1);
  addSet(mixed, "1");
  addSet(mixed, undefined);
  assert.equal(sizeSet(mixed), 3);
  assert.ok(hasSet(mixed, undefined));
});
