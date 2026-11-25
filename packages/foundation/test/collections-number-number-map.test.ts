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
} from "../src/collections/number-number-map.ts";

function entries(map: ReturnType<typeof createMap>): [number, number][] {
  const result: [number, number][] = [];
  const cursor = createMapCursor(map);
  while (advanceMapCursor(cursor))
    result.push([readMapCursorKey(cursor), readMapCursorValue(cursor)]);
  return result;
}

test("number-number-map handles SameValueZero keys, updates, growth, and deletion", () => {
  const map = createMap();
  assert.equal(sizeMap(map), 0);
  assert.equal(getMap(map, 1), undefined);
  assert.equal(hasMap(map, 1), false);
  assert.equal(setMap(map, -0, 10), true);
  assert.equal(hasMap(map, 0), true);
  assert.equal(getMap(map, 0), 10);
  assert.equal(Object.is(entries(map)[0]?.[0], 0), true);
  assert.equal(setMap(map, 0, 20), false);
  assert.equal(getMap(map, -0), 20);
  assert.equal(setMap(map, Number.NaN, 30), true);
  assert.equal(hasMap(map, Number.NaN), true);
  assert.equal(getMap(map, Number.NaN), 30);
  assert.equal(setMap(map, Number.NaN, 35), false);
  assert.equal(getMap(map, Number.NaN), 35);
  assert.equal(setMap(map, 1.5, 40), true);
  assert.equal(setMap(map, -42, 50), true);
  assert.equal(sizeMap(map), 4);
  for (let i = 10; i < 600; i++) assert.equal(setMap(map, i * 3, i), true);
  assert.equal(sizeMap(map), 594);
  for (let i = 10; i < 600; i++) assert.equal(getMap(map, i * 3), i);
  for (let i = 10; i < 550; i++) assert.equal(deleteMap(map, i * 3), true);
  assert.equal(deleteMap(map, 999999), false);
  assert.equal(sizeMap(map), 54);
  assert.equal(getMap(map, 550 * 3), 550);
  assert.equal(getMap(map, Number.NaN), 35);
  clearMap(map);
  assert.equal(sizeMap(map), 0);
  assert.equal(getMap(map, 550 * 3), undefined);
});

test("number-number-map cursor survives live deletion, compaction, and reinsertion", () => {
  const map = createMap();
  for (let i = 0; i < 40; i++) setMap(map, i, i * 10);
  const cursor = createMapCursor(map);
  const seen: [number, number][] = [];
  assert.equal(advanceMapCursor(cursor), true);
  seen.push([readMapCursorKey(cursor), readMapCursorValue(cursor)]);
  // Trigger compaction mid-iteration by deleting > 75% of entries.
  for (let i = 2; i < 36; i++) deleteMap(map, i);
  setMap(map, 100, 1000);
  setMap(map, 2, 200);
  while (advanceMapCursor(cursor))
    seen.push([readMapCursorKey(cursor), readMapCursorValue(cursor)]);
  assert.deepEqual(seen, [
    [0, 0],
    [1, 10],
    [36, 360],
    [37, 370],
    [38, 380],
    [39, 390],
    [100, 1000],
    [2, 200],
  ]);
  // Exhausted cursor does not resurrect on later insertions.
  setMap(map, 999, 9990);
  assert.equal(advanceMapCursor(cursor), false);
});
