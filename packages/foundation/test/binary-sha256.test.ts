import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256 } from "@tint/foundation/binary/sha256";
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
test("standard empty and abc SHA-256 vectors", () => {
  assert.equal(
    hex(sha256(new Uint8Array())),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(
    hex(sha256(new TextEncoder().encode("abc"))),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
test("padding boundaries, sliced views and multi-block inputs agree with Node crypto", () => {
  for (const size of [
    1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 4095, 4096, 4097, 65536,
  ]) {
    const storage = new Uint8Array(size + 9);
    for (let i = 0; i < storage.length; i++) storage[i] = (i * 17) % 256;
    const bytes = storage.subarray(5, 5 + size),
      before = bytes.slice();
    assert.equal(
      hex(sha256(bytes)),
      createHash("sha256").update(bytes).digest("hex"),
      `length ${size}`,
    );
    assert.deepEqual(bytes, before);
  }
});
test("million-a vector and independent calls", () => {
  const bytes = new Uint8Array(1000000).fill(97);
  const digest = sha256(bytes);
  assert.equal(
    hex(digest),
    "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
  );
  digest.fill(0);
  assert.equal(
    hex(sha256(new Uint8Array())),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("digests match node:crypto across block and padding boundaries", async () => {
  const { createHash } = await import("node:crypto");
  for (const length of [
    0, 1, 55, 56, 63, 64, 65, 119, 127, 128, 1000, 4096, 100003,
  ]) {
    const input = new Uint8Array(length).map((_, i) => (i * 31 + 7) & 255);
    assert.equal(
      Buffer.from(sha256(input)).toString("hex"),
      createHash("sha256").update(input).digest("hex"),
      String(length),
    );
  }
});
