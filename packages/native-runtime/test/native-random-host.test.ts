import assert from "node:assert/strict";
import test from "node:test";
import { randomUint32, randomNumber } from "../src/intrinsics/random.ts";
test("entropy requires an explicit native host capability", () => {
  assert.throws(randomUint32);
  assert.throws(randomNumber);
});
