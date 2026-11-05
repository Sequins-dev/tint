import assert from "node:assert/strict";
import test from "node:test";
import { compressSha256 } from "../src/binary/sha256-compression.ts";
test("compression consumes a padded block with caller-owned scratch storage", () => {
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const schedule = new Uint32Array(64);
  schedule[0] = 0x80000000;
  compressSha256(state, schedule);
  assert.equal(
    [...state].map((word) => word.toString(16).padStart(8, "0")).join(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});
test("compression rejects undersized workspaces before modifying them", () => {
  for (const [state, schedule] of [
    [new Uint32Array(7), new Uint32Array(64)],
    [new Uint32Array(8), new Uint32Array(63)],
  ]) {
    const before = state!.slice();
    assert.throws(() => compressSha256(state!, schedule!));
    assert.deepEqual(state, before);
  }
});
