import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMap,
  createMapWithKeys,
  getMap,
  hasMap,
  setMap,
  deleteMap,
  clearMap,
  sizeMap,
  createMapCursor,
  advanceMapCursor,
  readMapCursorKey,
  readMapCursorValue,
} from "@tint/foundation/collections/linked-map";

test("map cursors match live JavaScript iteration across deletion, reinsertion and clear", () => {
  const map = createMap<string, number>(),
    expected = new Map<string, number>();
  function put(key: string, value: number) {
    setMap(map, key, value);
    expected.set(key, value);
  }
  put("a", 1);
  put("b", 2);
  put("c", 3);
  const cursor = createMapCursor(map),
    iterator = expected.entries();
  function next() {
    const value = iterator.next();
    const advanced = advanceMapCursor(cursor);
    assert.equal(advanced, !value.done);
    if (advanced)
      assert.deepEqual(
        [readMapCursorKey(cursor), readMapCursorValue(cursor)],
        value.value,
      );
  }
  next();
  deleteMap(map, "b");
  expected.delete("b");
  put("c", 30);
  put("b", 20);
  next();
  next();
  clearMap(map);
  expected.clear();
  put("a", 10);
  next();
  next();
  put("after exhaustion", 4);
  next();
  assert.equal(cursor.map, undefined);
  assert.equal(cursor.current, undefined);
  assert.throws(() => readMapCursorKey(cursor));
  assert.throws(() => readMapCursorValue(cursor));
});
test("map lookup distinguishes absent keys from stored undefined and replaces existing values", () => {
  const map = createMap<string, number | undefined>();
  assert.equal(getMap(map, "missing"), undefined);
  assert.equal(hasMap(map, "missing"), false);
  assert.equal(setMap(map, "a", undefined), true);
  assert.equal(hasMap(map, "a"), true);
  assert.equal(setMap(map, "a", 7), false);
  assert.equal(getMap(map, "a"), 7);
  assert.equal(sizeMap(map), 1);
  setMap(map, "b", 8);
  setMap(map, "c", 9);
  assert.ok(deleteMap(map, "c"));
  assert.ok(deleteMap(map, "a"));
  assert.equal(sizeMap(map), 1);
  assert.equal(getMap(map, "b"), 8);
  assert.equal(deleteMap(map, "missing"), false);
  clearMap(map);
  assert.equal(sizeMap(map), 0);
  assert.equal(hasMap(map, "b"), false);
  assert.ok(setMap(map, "final", 1));
  assert.equal(getMap(map, "final"), 1);
});
test("map keys use SameValueZero and object identity without coercion", () => {
  const map = createMap<unknown, number>(),
    a = { value: 1 },
    b = { value: 1 };
  for (const key of [NaN, 0, -0, a, b, "0", undefined, null])
    setMap(map, key, 1);
  assert.equal(sizeMap(map), 7);
  assert.ok(hasMap(map, NaN));
  assert.equal(setMap(map, -0, 2), false);
  assert.equal(getMap(map, 0), 2);
  assert.equal(getMap(map, "0"), 1);
  assert.ok(deleteMap(map, a));
  assert.ok(!hasMap(map, a));
  assert.ok(hasMap(map, b));
  assert.ok(!hasMap(map, { value: 1 }));
  assert.equal(getMap(createMap<unknown, number>(), b), undefined);
});
test("deterministic map mutations match JavaScript Map", () => {
  const actual = createMap<string, number | undefined>(),
    expected = new Map<string, number | undefined>();
  const keys = [
    "",
    "a\0",
    "\ud800",
    "😀",
    "__proto__",
    "constructor",
    "a",
    "b",
  ];
  let seed = 121;
  for (let i = 0; i < 600; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const key = keys[seed % keys.length]!;
    const operation = (seed >>> 8) % 4,
      value = i % 7 === 0 ? undefined : i;
    if (operation === 0) {
      const added = !expected.has(key);
      expected.set(key, value);
      assert.equal(setMap(actual, key, value), added);
    } else if (operation === 1)
      assert.equal(deleteMap(actual, key), expected.delete(key));
    else if (operation === 2)
      assert.equal(getMap(actual, key), expected.get(key));
    else if (i % 29 === 0) {
      clearMap(actual);
      expected.clear();
    }
    assert.equal(sizeMap(actual), expected.size);
    for (const k of keys) {
      assert.equal(hasMap(actual, k), expected.has(k));
      assert.equal(getMap(actual, k), expected.get(k));
    }
  }
});

test("unchanged map traversal performs linear entry work", () => {
  const count = 512,
    map = createMap<number, number>();
  for (let index = 0; index < count; index++) setMap(map, index, index * 2);
  let reads = 0,
    entry = map.head;
  while (entry !== undefined) {
    const order = entry.order;
    Object.defineProperty(entry, "order", {
      get() {
        reads++;
        return order;
      },
    });
    entry = entry.next;
  }
  const cursor = createMapCursor(map);
  for (let index = 0; index < count; index++) {
    assert.ok(advanceMapCursor(cursor));
    assert.equal(readMapCursorKey(cursor), index);
    assert.equal(readMapCursorValue(cursor), index * 2);
  }
  assert.equal(advanceMapCursor(cursor), false);
  assert.ok(reads <= count * 3, `traversal read ${reads} sequence numbers`);
});

test("mixed keys retain identity and live insertion order through growth and reinsertion", () => {
  const first = {},
    second = {},
    symbol = Symbol("key");
  const keys: unknown[] = [
    "Aa",
    "BB",
    "0",
    0,
    -0,
    NaN,
    null,
    undefined,
    first,
    second,
    symbol,
    true,
  ];
  const actual = createMap<unknown, number>(),
    expected = new Map<unknown, number>();
  for (let i = 0; i < keys.length; i++) {
    setMap(actual, keys[i], i);
    expected.set(keys[i], i);
  }
  for (let i = 0; i < 256; i++) {
    const key = String(i);
    setMap(actual, key, i);
    expected.set(key, i);
  }
  for (const key of ["Aa", first, "255", "0", symbol]) {
    assert.equal(deleteMap(actual, key), expected.delete(key));
    setMap(actual, key, 42);
    expected.set(key, 42);
  }
  for (const [key, value] of expected) assert.equal(getMap(actual, key), value);
  const cursor = createMapCursor(actual),
    entries: [unknown, number][] = [];
  while (advanceMapCursor(cursor))
    entries.push([readMapCursorKey(cursor), readMapCursorValue(cursor)]);
  assert.deepEqual(entries, [...expected]);
});

test("live cursors cross growth, clear and renewed growth without losing order", () => {
  const actual = createMap<string, number>(),
    expected = new Map<string, number>();
  function put(key: string, value: number) {
    setMap(actual, key, value);
    expected.set(key, value);
  }
  put("first", 1);
  put("second", 2);
  const cursor = createMapCursor(actual),
    iterator = expected.entries();
  function next() {
    const wanted = iterator.next();
    assert.equal(advanceMapCursor(cursor), !wanted.done);
    if (!wanted.done)
      assert.deepEqual(
        [readMapCursorKey(cursor), readMapCursorValue(cursor)],
        wanted.value,
      );
  }
  next();
  for (let i = 0; i < 128; i++) put(String(i), i);
  deleteMap(actual, "second");
  expected.delete("second");
  next();
  clearMap(actual);
  expected.clear();
  for (let i = 0; i < 128; i++) put("new" + i, i);
  for (let i = 0; i < 129; i++) next();
});

test("custom key equivalence survives promotion, replacement, clear and live cursors", () => {
  const map = createMapWithKeys<{ id: number }, number>({
    hash: (key) => key.id % 4,
    equals: (a, b) => a.id === b.id,
  });
  const first = { id: 0 };
  setMap(map, first, 1);
  assert.equal(setMap(map, { id: 0 }, 2), false);
  assert.equal(getMap(map, { id: 0 }), 2);
  for (let id = 1; id < 32; id++) setMap(map, { id }, id);
  assert.equal(setMap(map, { id: 0 }, 3), false);
  assert.equal(sizeMap(map), 32);
  const cursor = createMapCursor(map);
  assert.equal(advanceMapCursor(cursor), true);
  assert.equal(readMapCursorKey(cursor), first);
  assert.equal(readMapCursorValue(cursor), 3);
  assert.equal(deleteMap(map, { id: 1 }), true);
  assert.equal(advanceMapCursor(cursor), true);
  assert.equal(readMapCursorKey(cursor)?.id, 2);
  clearMap(map);
  setMap(map, { id: 7 }, 42);
  assert.equal(getMap(map, { id: 7 }), 42);
  assert.equal(advanceMapCursor(cursor), true);
  assert.equal(readMapCursorKey(cursor)?.id, 7);
  assert.equal(advanceMapCursor(cursor), false);
});
