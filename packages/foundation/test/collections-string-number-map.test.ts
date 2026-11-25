import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceMapCursor,
  clearMap,
  createMap,
  createMapCursor,
  deleteMap,
  getMap,
  hasMap,
  readMapCursorKey,
  readMapCursorValue,
  setMap,
  sizeMap,
} from "../src/collections/string-number-map.ts";

function entries(map: ReturnType<typeof createMap>): [string, number][] {
  const result: [string, number][] = [];
  const cursor = createMapCursor(map);
  while (advanceMapCursor(cursor))
    result.push([readMapCursorKey(cursor), readMapCursorValue(cursor)]);
  return result;
}

test("string-number-map handles insertion, update, growth, deletion, and clear", () => {
  const map = createMap();
  assert.equal(sizeMap(map), 0);
  assert.equal(getMap(map, "a"), undefined);
  assert.equal(hasMap(map, "a"), false);
  assert.equal(setMap(map, "", 1), true);
  assert.equal(setMap(map, "a", 2), true);
  assert.equal(setMap(map, "a", 3), false);
  assert.equal(getMap(map, ""), 1);
  assert.equal(getMap(map, "a"), 3);
  for (let i = 0; i < 600; i++) assert.equal(setMap(map, `k${i}`, i), true);
  assert.equal(sizeMap(map), 602);
  for (let i = 0; i < 600; i++) {
    assert.equal(setMap(map, `k${i}`, i + 1000), false);
    assert.equal(getMap(map, `k${i}`), i + 1000);
  }
  for (let i = 0; i < 560; i++) assert.equal(deleteMap(map, `k${i}`), true);
  assert.equal(deleteMap(map, "missing"), false);
  assert.equal(sizeMap(map), 42);
  assert.equal(getMap(map, "k560"), 1560);
  assert.equal(getMap(map, "k0"), undefined);
  assert.equal(entries(map).length, 42);
  clearMap(map);
  assert.equal(sizeMap(map), 0);
  assert.equal(getMap(map, "k560"), undefined);
});

test("string-number-map cursor survives live deletion, compaction, and reinsertion", () => {
  const map = createMap();
  for (let i = 0; i < 40; i++) setMap(map, `k${i}`, i);
  const cursor = createMapCursor(map);
  const seen: [string, number][] = [];
  assert.equal(advanceMapCursor(cursor), true);
  seen.push([readMapCursorKey(cursor), readMapCursorValue(cursor)]);
  for (let i = 2; i < 36; i++) deleteMap(map, `k${i}`);
  setMap(map, "new", 99);
  setMap(map, "k2", 22);
  while (advanceMapCursor(cursor))
    seen.push([readMapCursorKey(cursor), readMapCursorValue(cursor)]);
  assert.deepEqual(seen, [
    ["k0", 0],
    ["k1", 1],
    ["k36", 36],
    ["k37", 37],
    ["k38", 38],
    ["k39", 39],
    ["new", 99],
    ["k2", 22],
  ]);
  setMap(map, "after", 1);
  assert.equal(advanceMapCursor(cursor), false);
});
