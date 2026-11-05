import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWordBuffer,
  appendWord,
  readWord,
  writeWord,
} from "../src/binary/word-buffer.ts";
test("word pages grow without replacing or copying previous pages", () => {
  const buffer = createWordBuffer(3, 10);
  assert.equal(buffer.pages.length, 0);
  for (let i = 0; i < 3; i++) appendWord(buffer, i + 10);
  const first = buffer.pages[0];
  for (let i = 3; i < 10; i++) appendWord(buffer, i + 10);
  assert.equal(buffer.length, 10);
  assert.equal(buffer.pages[0], first);
  assert.deepEqual(
    buffer.pages.map((p) => p.length),
    [3, 3, 3, 1],
  );
  assert.deepEqual(
    Array.from({ length: 10 }, (_, i) => readWord(buffer, i)),
    Array.from({ length: 10 }, (_, i) => i + 10),
  );
  writeWord(buffer, 2, 0xffffffff);
  writeWord(buffer, 3, 42);
  writeWord(buffer, 9, 99);
  assert.equal(readWord(buffer, 2), 0xffffffff);
  assert.equal(readWord(buffer, 3), 42);
  assert.equal(readWord(buffer, 9), 99);
  assert.throws(() => appendWord(buffer, 1));
  assert.equal(buffer.length, 10);
  assert.equal(buffer.pages.length, 4);
});
test("word values follow Uint32Array coercion and invalid patches do not mutate", () => {
  const buffer = createWordBuffer(2, 20),
    values = [-1, NaN, Infinity, -Infinity, 4294967297, 3.9, -0, 1e100];
  const expected = new Uint32Array(values);
  for (const value of values) appendWord(buffer, value);
  for (let i = 0; i < values.length; i++)
    assert.equal(readWord(buffer, i), expected[i]);
  for (const index of [-1, 0.5, NaN, Infinity, values.length, 4294967296]) {
    assert.equal(readWord(buffer, index), undefined);
    assert.throws(() => writeWord(buffer, index, 1));
  }
  assert.equal(buffer.length, values.length);
  for (let i = 0; i < values.length; i++)
    assert.equal(readWord(buffer, i), expected[i]);
});
test("word buffer validates policy and permits a zero-word limit", () => {
  for (const page of [0, -1, 0.5, NaN, Infinity, 1073741824])
    assert.throws(() => createWordBuffer(page));
  for (const max of [-1, 0.5, NaN, Infinity, 1073741824])
    assert.throws(() => createWordBuffer(4, max));
  const buffer = createWordBuffer(4, 0);
  assert.throws(() => appendWord(buffer, 0));
  assert.equal(buffer.pages.length, 0);
});

test("sequential append does not look up a page for every word", () => {
  const buffer = createWordBuffer(4, 4096);
  let reads = 0;
  const pages = new Proxy(buffer.pages, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  const observed = { ...buffer, pages };
  for (let i = 0; i < 4096; i++) appendWord(observed, i);
  assert.ok(reads <= 1024, `page lookups: ${reads}`);
  assert.equal(readWord(observed, 4095), 4095);
});
