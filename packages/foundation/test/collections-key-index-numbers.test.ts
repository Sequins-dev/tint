import { test } from "node:test";
import assert from "node:assert/strict";
import * as api from "../src/collections/key-index.ts";

test("numeric interning assigns stable dense IDs across collisions, growth, and reset", () => {
  assert.ok("createNumberIndex" in api, "numeric scratch index is available");
  const create = api.createNumberIndex as () => {
    intern: (key: number) => number;
    clear: () => void;
  };
  const index = create();
  const keys = Array.from({ length: 2000 }, (_, i) => i * 4294967297);
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < keys.length; i++)
      assert.equal(index.intern(keys[i]!), i);
    for (let i = keys.length - 1; i >= 0; i--)
      assert.equal(index.intern(keys[i]!), i);
    index.clear();
    assert.equal(index.intern(Number.MAX_SAFE_INTEGER), 0);
    assert.equal(index.intern(0), 1);
    assert.equal(index.intern(-0), 1);
    index.clear();
  }
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => index.intern(value), /INVALID_NUMBER_KEY/);
});

test("numeric interning handles strides that cancel the low word fold", () => {
  const index = api.createNumberIndex();
  const count = 32768;
  // With the old xor-fold these keys all started in bucket zero, even
  // after growth. Budget CPU time so load from other tests cannot hide it.
  const started = process.threadCpuUsage();
  for (let id = 0; id < count; id++) assert.equal(index.intern(id * 65537), id);
  for (let id = count - 1; id >= 0; id--)
    assert.equal(index.intern(id * 65537), id);
  const { user, system } = process.threadCpuUsage(started);
  const milliseconds = (user + system) / 1000;
  assert.ok(
    milliseconds < 250,
    `strided interning used ${milliseconds} ms of CPU`,
  );
});
