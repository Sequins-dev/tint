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
