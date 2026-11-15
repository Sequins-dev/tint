import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createNumberList,
  readNumberList,
  writeNumberList,
  pushNumberList,
  popNumberList,
  resizeNumberList,
  hasNumberList,
  deleteNumberList,
} from "@tint/foundation/collections/number-list";
test("numeric lists preserve holes and Number values across growth, shrink and reuse", () => {
  const list = createNumberList(0),
    model: (number | undefined)[] = [];
  let seed = 123;
  const values = [
    -0,
    0,
    NaN,
    Infinity,
    -Infinity,
    5e-324,
    0.1,
    -7.5,
    undefined,
  ];
  for (let step = 0; step < 500; step++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const index = (seed >>> 8) % 32,
      value = values[(seed >>> 16) % values.length];
    switch (seed % 5) {
      case 0:
        writeNumberList(list, index, value);
        model[index] = value;
        break;
      case 1:
        assert.equal(pushNumberList(list, value), model.push(value));
        break;
      case 2:
        assert.ok(Object.is(popNumberList(list), model.pop()));
        break;
      default:
        resizeNumberList(list, index);
        model.length = index;
        break;
    }
    assert.equal(list.length, model.length);
    for (let i = 0; i <= model.length; i++)
      assert.ok(
        Object.is(readNumberList(list, i), model[i]),
        `step ${step}, index ${i}`,
      );
  }
});
test("sparse length changes do not allocate backing and invalid indices cannot corrupt state", () => {
  const list = createNumberList(0);
  resizeNumberList(list, 0xffffffff);
  assert.equal(list.values.length, 0);
  assert.equal(readNumberList(list, 100), undefined);
  assert.throws(() => pushNumberList(list, 1), /INVALID_INDEX/);
  resizeNumberList(list, 0);
  writeNumberList(list, -0, -0);
  assert.ok(Object.is(readNumberList(list, 0), -0));
  for (const index of [-1, 0.5, NaN, Infinity, 0xffffffff])
    assert.throws(() => writeNumberList(list, index, 2), /INVALID_INDEX/);
  for (const size of [-1, 0.5, NaN, Infinity, 0x100000000])
    assert.throws(() => resizeNumberList(list, size), /INVALID_LENGTH/);
  assert.equal(list.length, 1);
  assert.ok(Object.is(readNumberList(list, 0), -0));
  for (const capacity of [-1, 0.5, NaN, Infinity, 536870907])
    assert.throws(() => createNumberList(capacity), /INVALID_CAPACITY/);
});

test("logical length normalizes negative zero like JavaScript arrays", () => {
  const list = createNumberList(0);
  resizeNumberList(list, -0);
  assert.ok(Object.is(list.length, 0));
});

test("stored undefined remains present across growth, shrink and reuse", () => {
  const list = createNumberList(1);
  writeNumberList(list, 0, undefined);
  assert.equal(readNumberList(list, 0), undefined);
  assert.equal(hasNumberList(list, 0), true);
  writeNumberList(list, 8, 7);
  assert.equal(readNumberList(list, 0), undefined);
  assert.equal(hasNumberList(list, 0), true);
  assert.equal(hasNumberList(list, 1), false);
  resizeNumberList(list, 0);
  resizeNumberList(list, 2);
  assert.equal(hasNumberList(list, 0), false);
  assert.equal(pushNumberList(list, undefined), 3);
  assert.equal(hasNumberList(list, 2), true);
  assert.equal(popNumberList(list), undefined);
  assert.equal(hasNumberList(list, 2), false);
});

test("dense lists switch to explicit presence only for holes and undefined", () => {
  const list = createNumberList(0);
  for (let i = 0; i < 9; i++) pushNumberList(list, i * 0.5);
  assert.equal(list.present, undefined);
  writeNumberList(list, 9, -0);
  assert.equal(popNumberList(list), -0);
  resizeNumberList(list, 4);
  assert.equal(list.present, undefined);
  assert.equal(readNumberList(list, 4), undefined, "shrunk cells are absent");
  assert.equal(hasNumberList(list, 4), false);
  assert.equal(pushNumberList(list, 7), 5);
  assert.equal(readNumberList(list, 4), 7);
  assert.equal(readNumberList(list, 3), 1.5);
  resizeNumberList(list, 7);
  assert.notEqual(list.present, undefined, "growth exposes holes");
  assert.equal(readNumberList(list, 3), 1.5);
  assert.equal(hasNumberList(list, 5), false);
  resizeNumberList(list, 0);
  assert.equal(list.present, undefined);
  pushNumberList(list, 1);
  assert.equal(deleteNumberList(list, 0), true);
  assert.notEqual(list.present, undefined);
  assert.equal(hasNumberList(list, 0), false);
  assert.equal(list.length, 1);
  const withUndefined = createNumberList(0);
  pushNumberList(withUndefined, 1);
  pushNumberList(withUndefined, undefined);
  assert.notEqual(withUndefined.present, undefined);
  assert.equal(readNumberList(withUndefined, 0), 1);
  assert.equal(hasNumberList(withUndefined, 1), true);
});

test("numeric list presence distinguishes undefined from holes and deletion preserves length", () => {
  const list = createNumberList(0);
  writeNumberList(list, 2, undefined);
  writeNumberList(list, 3, -0);
  assert.equal(hasNumberList(list, 1), false);
  assert.equal(hasNumberList(list, 2), true);
  assert.equal(hasNumberList(list, 3), true);
  assert.equal(deleteNumberList(list, 2), true);
  assert.equal(deleteNumberList(list, 2), false);
  assert.equal(list.length, 4);
  assert.equal(Object.is(readNumberList(list, 3), -0), true);
  for (const index of [-1, 0.5, NaN, Infinity, 0xffffffff]) {
    assert.equal(hasNumberList(list, index), false);
    assert.equal(deleteNumberList(list, index), false);
  }
  resizeNumberList(list, 1000);
  assert.equal(hasNumberList(list, 999), false);
});

test("reads outside the live, integral index range are absent", () => {
  const list = createNumberList(0);
  for (const value of [10, 11, 12, 13]) pushNumberList(list, value);
  for (const index of [-1, 0.5, 4, 2 ** 32, NaN, Infinity])
    assert.equal(readNumberList(list, index), undefined, String(index));
  resizeNumberList(list, 2);
  assert.equal(readNumberList(list, 2), undefined, "shrunk cells are absent");
  assert.equal(readNumberList(list, 1), 11);
  writeNumberList(list, 3, 7);
  assert.equal(readNumberList(list, 2), undefined, "a hole stays absent");
  assert.equal(readNumberList(list, 3), 7);
});
