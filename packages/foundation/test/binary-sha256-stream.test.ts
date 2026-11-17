import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256 } from "@tint/foundation/binary/sha256";
import {
  createSha256Stream,
  finishSha256Stream,
  updateSha256Stream,
} from "@tint/foundation/binary/sha256-stream";
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
function patterned(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 255;
  return bytes;
}
test("streamed digests equal the one-shot digest for every chunking", () => {
  for (const size of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
    const bytes = patterned(size);
    const expected = createHash("sha256").update(bytes).digest("hex");
    assert.equal(hex(sha256(bytes)), expected);
    for (const chunk of [1, 3, 63, 64, 65, 200]) {
      const stream = createSha256Stream();
      for (let offset = 0; offset < size; offset += chunk)
        updateSha256Stream(stream, bytes.subarray(offset, offset + chunk));
      assert.equal(
        hex(finishSha256Stream(stream)),
        expected,
        `size ${size} chunk ${chunk}`,
      );
    }
  }
});
test("empty updates, sliced views and inputs are left unchanged", () => {
  const storage = patterned(300);
  const before = storage.slice();
  const stream = createSha256Stream();
  updateSha256Stream(stream, new Uint8Array(0));
  updateSha256Stream(stream, storage.subarray(10, 75));
  updateSha256Stream(stream, new Uint8Array(0));
  updateSha256Stream(stream, storage.subarray(75, 290));
  assert.equal(
    hex(finishSha256Stream(stream)),
    createHash("sha256").update(storage.subarray(10, 290)).digest("hex"),
  );
  assert.deepEqual(storage, before);
});
test("a finished stream rejects further input and a second finish", () => {
  const stream = createSha256Stream();
  updateSha256Stream(stream, patterned(5));
  assert.equal(
    hex(finishSha256Stream(stream)),
    createHash("sha256").update(patterned(5)).digest("hex"),
  );
  assert.throws(() => updateSha256Stream(stream, patterned(1)));
  assert.throws(() => finishSha256Stream(stream));
});
test("the million-a vector streamed in uneven chunks", () => {
  const stream = createSha256Stream();
  const chunk = new Uint8Array(9973).fill(97);
  let remaining = 1000000;
  while (remaining > 0) {
    const take = Math.min(remaining, chunk.length);
    updateSha256Stream(stream, chunk.subarray(0, take));
    remaining -= take;
  }
  assert.equal(
    hex(finishSha256Stream(stream)),
    "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
  );
});
