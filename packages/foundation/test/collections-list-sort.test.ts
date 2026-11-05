import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sortNumberList,
  sortList,
} from "@tint/foundation/collections/list-sort";
import {
  createNumberList,
  writeNumberList,
  readNumberList,
  hasNumberList,
  resizeNumberList,
} from "@tint/foundation/collections/number-list";
import {
  createList,
  writeList,
  readList,
  hasList,
  resizeList,
} from "@tint/foundation/collections/sparse-list";
test("numeric adapter returns original storage and preserves undefined and holes", () => {
  const list = createNumberList(5);
  writeNumberList(list, 0, 3);
  writeNumberList(list, 2, undefined);
  writeNumberList(list, 4, 1);
  resizeNumberList(list, 6);
  assert.equal(
    sortNumberList(list, (a, b) => a - b),
    list,
  );
  assert.deepEqual(
    Array.from({ length: 6 }, (_, i) => [
      hasNumberList(list, i),
      readNumberList(list, i),
    ]),
    [
      [true, 1],
      [true, 3],
      [true, undefined],
      [false, undefined],
      [false, undefined],
      [false, undefined],
    ],
  );
});
test("reference adapter retains identity and stability", () => {
  const list = createList<{ key: number; id: number } | undefined>(4),
    a = { key: 1, id: 0 },
    b = { key: 0, id: 1 },
    c = { key: 1, id: 2 };
  writeList(list, 0, a);
  writeList(list, 2, b);
  writeList(list, 3, c);
  writeList(list, 4, undefined);
  resizeList(list, 6);
  assert.equal(
    sortList(list, (a, b) => a.key - b.key),
    list,
  );
  assert.equal(readList(list, 0), b);
  assert.equal(readList(list, 1), a);
  assert.equal(readList(list, 2), c);
  assert.equal(readList(list, 3), undefined);
  assert.equal(hasList(list, 3), true);
  assert.equal(hasList(list, 4), false);
});
