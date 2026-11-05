import assert from "node:assert/strict";
import { test } from "node:test";
import * as runtime from "@tint/foundation/collections/linked-set";

test("cloning visits each live member once and owns independent links", () => {
  assert.ok("cloneSet" in runtime, "missing linear set clone");
  assert.equal(typeof runtime.cloneSet, "function");
  if (typeof runtime.cloneSet !== "function") return;
  const source = runtime.createSet<number>();
  for (let i = 0; i < 128; i++) runtime.addSet(source, i);
  runtime.deleteSet(source, 40);
  runtime.addSet(source, 40);
  let reads = 0;
  for (let entry = source.head; entry !== undefined; entry = entry.next) {
    const value = entry.value;
    Object.defineProperty(entry, "value", {
      get: () => {
        reads++;
        return value;
      },
    });
  }
  const copy = runtime.cloneSet(source);
  assert.equal(reads, source.size);
  const expected = [...Array(128).keys()].filter((n) => n !== 40).concat(40);
  const values: number[] = [];
  const cursor = runtime.createSetCursor(copy);
  while (runtime.advanceSetCursor(cursor))
    values.push(runtime.readSetCursor(cursor));
  assert.deepEqual(values, expected);
  runtime.deleteSet(copy, 0);
  runtime.addSet(copy, 128);
  assert.ok(runtime.hasSet(source, 0));
  assert.ok(!runtime.hasSet(source, 128));
  runtime.clearSet(source);
  assert.equal(runtime.sizeSet(copy), 128);
});

test("cloning preserves empty sets, SameValueZero members and object identity", () => {
  assert.ok("cloneSet" in runtime);
  if (typeof runtime.cloneSet !== "function") return;
  assert.equal(
    runtime.sizeSet(runtime.cloneSet(runtime.createSet<number>())),
    0,
  );
  const object = { value: 1 },
    source = runtime.createSet<number | typeof object | undefined>();
  for (const value of [NaN, 0, -0, Infinity, object, undefined])
    runtime.addSet(source, value);
  const copy = runtime.cloneSet(source);
  assert.equal(runtime.sizeSet(copy), 5);
  for (const value of [NaN, 0, -0, Infinity, object, undefined])
    assert.ok(runtime.hasSet(copy, value));
  assert.ok(!runtime.hasSet(copy, { value: 1 }));
});
