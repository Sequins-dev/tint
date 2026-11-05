import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { signCode, signatureSize } from "@tint/image/darwin/signature";
const options = {
  identifier: "tint.fixture",
  executableOffset: 0,
  executableLength: 4096,
  mainExecutable: true,
};
test("serializes big-endian SuperBlob and CodeDirectory with exact page hashes", () => {
  const prefix = new Uint8Array(4097);
  for (let i = 0; i < prefix.length; i++) prefix[i] = i % 251;
  const before = prefix.slice(),
    result = signCode(prefix, options);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const data = result.value,
    view = new DataView(data.buffer, data.byteOffset, data.byteLength),
    cd = 20;
  assert.deepEqual(signatureSize(prefix.length, options.identifier), {
    ok: true,
    value: data.length,
  });
  assert.equal(view.getUint32(0), 0xfade0cc0);
  assert.equal(view.getUint32(4), data.length);
  assert.equal(view.getUint32(8), 1);
  assert.equal(view.getUint32(12), 0);
  assert.equal(view.getUint32(16), cd);
  assert.equal(view.getUint32(cd), 0xfade0c02);
  assert.equal(view.getUint32(cd + 4), data.length - cd);
  assert.equal(view.getUint32(cd + 8), 0x20400);
  assert.equal(view.getUint32(cd + 12), 2);
  assert.equal(view.getUint32(cd + 20), 88);
  assert.equal(view.getUint32(cd + 24), 0);
  assert.equal(view.getUint32(cd + 28), 2);
  assert.equal(view.getUint32(cd + 32), prefix.length);
  assert.deepEqual([...data.subarray(cd + 36, cd + 40)], [32, 2, 0, 12]);
  assert.equal(view.getBigUint64(cd + 56), 0n);
  assert.equal(view.getBigUint64(cd + 64), 0n);
  assert.equal(view.getBigUint64(cd + 72), 4096n);
  assert.equal(view.getBigUint64(cd + 80), 1n);
  assert.equal(
    new TextDecoder().decode(
      data.subarray(cd + 88, cd + 88 + options.identifier.length),
    ),
    options.identifier,
  );
  assert.equal(data[cd + 88 + options.identifier.length], 0);
  const hashes = cd + view.getUint32(cd + 16);
  assert.deepEqual(
    data.subarray(hashes, hashes + 32),
    new Uint8Array(
      createHash("sha256").update(prefix.subarray(0, 4096)).digest(),
    ),
  );
  assert.deepEqual(
    data.subarray(hashes + 32),
    new Uint8Array(createHash("sha256").update(prefix.subarray(4096)).digest()),
  );
  assert.deepEqual(prefix, before);
});
test("reserves exactly the required slots at page boundaries and is deterministic", () => {
  for (const length of [0, 1, 4095, 4096, 4097, 8192]) {
    const bytes = new Uint8Array(length),
      opts = { ...options, executableLength: length, mainExecutable: false };
    const a = signCode(bytes, opts),
      b = signCode(bytes, opts);
    assert.deepEqual(a, b);
    assert.equal(a.ok, true);
    if (a.ok) {
      assert.equal(
        a.value.length,
        20 + 88 + options.identifier.length + 1 + Math.ceil(length / 4096) * 32,
      );
      const view = new DataView(a.value.buffer);
      assert.equal(view.getBigUint64(20 + 80), 0n);
    }
  }
});
test("rejects invalid metadata before publication", () => {
  for (const length of [-1, 1.5, NaN, 2 ** 32])
    assert.equal(signatureSize(length, "id").ok, false);
  for (const identifier of ["", "bad\0id", "é", "x".repeat(256)])
    assert.equal(signatureSize(1, identifier).ok, false);
  const bytes = new Uint8Array(8);
  for (const range of [
    { executableOffset: -1, executableLength: 1 },
    { executableOffset: 4, executableLength: 5 },
    { executableOffset: 0, executableLength: NaN },
  ])
    assert.equal(signCode(bytes, { ...options, ...range }).ok, false);
  assert.equal(
    signCode(bytes, {
      ...options,
      executableLength: 8,
      mainExecutable: 1,
    } as never).ok,
    false,
  );
});

function embeddedBlob(magic: number, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(8 + payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, magic);
  view.setUint32(4, bytes.length);
  bytes.set(payload, 8);
  return bytes;
}
test("opaque embedded blobs are bound through SHA-256 special slots", () => {
  const code = new Uint8Array(4097);
  const specialBlobs = [
    { slot: 5, bytes: embeddedBlob(0xfade7171, new Uint8Array([1, 2, 3])) },
    { slot: 7, bytes: embeddedBlob(0xfade7172, new Uint8Array([255, 0])) },
  ];
  const result = signCode(code, { ...options, specialBlobs });
  assert.ok(result.ok);
  const bytes = result.value;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(8), 3);
  const blobs = new Map<number, number>();
  for (let index = 0; index < view.getUint32(8); index++)
    blobs.set(view.getUint32(12 + index * 8), view.getUint32(16 + index * 8));
  assert.deepEqual([...blobs.keys()], [0, 5, 7]);
  const cd = blobs.get(0)!;
  assert.equal(view.getUint32(cd + 24), 7);
  const hashes = cd + view.getUint32(cd + 16);
  for (const slot of [5, 7]) {
    const begin = blobs.get(slot)!;
    const blob = bytes.subarray(begin, begin + view.getUint32(begin + 4));
    assert.equal(view.getUint32(begin), slot === 5 ? 0xfade7171 : 0xfade7172);
    assert.deepEqual(
      bytes.subarray(hashes - slot * 32, hashes - (slot - 1) * 32),
      new Uint8Array(createHash("sha256").update(blob).digest()),
    );
  }
  for (const slot of [1, 2, 3, 4, 6])
    assert.deepEqual(
      bytes.subarray(hashes - slot * 32, hashes - (slot - 1) * 32),
      new Uint8Array(32),
    );
  assert.deepEqual(
    signatureSize(code.length, options.identifier, specialBlobs),
    {
      ok: true,
      value: bytes.length,
    },
  );
  assert.equal(view.getUint32(cd + 4), view.getUint32(cd + 16) + 2 * 32);
  assert.deepEqual(
    signCode(code, { ...options, specialBlobs: [] }),
    signCode(code, options),
  );
});

test("rejects duplicate, reserved and malformed embedded blobs before allocation", () => {
  const bytes = embeddedBlob(0xfade7171, new Uint8Array(0));
  const malformed = bytes.slice();
  malformed[7] = 9;
  for (const specialBlobs of [
    [{ slot: 0, bytes }],
    [{ slot: 0x1000, bytes }],
    [{ slot: -1, bytes }],
    [{ slot: 1.5, bytes }],
    [
      { slot: 5, bytes },
      { slot: 5, bytes },
    ],
    [{ slot: 5, bytes: malformed }],
    [{ slot: 5, bytes: new Uint8Array(7) }],
  ])
    assert.deepEqual(signatureSize(0, options.identifier, specialBlobs), {
      ok: false,
      error: "INVALID_BLOB",
    });
});
