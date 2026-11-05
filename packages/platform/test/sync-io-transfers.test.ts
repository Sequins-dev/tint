import { test } from "node:test";
import assert from "node:assert/strict";
import { readAll, writeAll, type IOResult } from "@tint/platform/io/sync";
const interrupted: IOResult<number> = {
  ok: false,
  error: { kind: "host", code: "EINTR", interrupted: true },
};
test("readAll handles interruptions, short reads and EOF with owned output", () => {
  const source = new Uint8Array([0, 1, 2, 255, 4]);
  let offset = 0,
    calls = 0;
  const r = readAll((buffer) => {
    if (calls++ === 0) return interrupted;
    const n = Math.min(buffer.length, 2, source.length - offset);
    buffer.set(source.subarray(offset, offset + n));
    offset += n;
    return { ok: true, value: n };
  }, 5);
  assert.deepEqual(r, { ok: true, value: source });
  if (r.ok) r.value.fill(0);
  assert.equal(source[3], 255);
  assert.equal(calls, 5);
});
test("read budget distinguishes exact EOF from one extra byte and validates before I/O", () => {
  for (const length of [0, 1, 65536, 65537]) {
    let offset = 0;
    const source = new Uint8Array(length);
    assert.equal(
      readAll((b) => {
        const n = Math.min(b.length, length - offset);
        b.set(source.subarray(offset, offset + n));
        offset += n;
        return { ok: true, value: n };
      }, length).ok,
      true,
    );
  }
  let consumed = 0;
  assert.deepEqual(
    readAll((b) => {
      consumed += b.length;
      return { ok: true, value: b.length };
    }, 2),
    { ok: false, error: { kind: "limit" } },
  );
  assert.equal(consumed, 3);
  for (const limit of [-1, NaN, 0.5, 0x100000000])
    assert.deepEqual(
      readAll(() => {
        throw Error("must not read");
      }, limit),
      { ok: false, error: { kind: "invalid-limit" } },
    );
});
test("writeAll advances through short writes and retries interruptions at the same position", () => {
  const input = new Uint8Array([1, 2, 3, 4, 5]),
    seen: number[][] = [];
  let calls = 0;
  assert.deepEqual(
    writeAll((b) => {
      seen.push([...b]);
      if (calls++ === 1) return interrupted;
      return { ok: true, value: Math.min(2, b.length) };
    }, input),
    { ok: true, value: 5 },
  );
  assert.deepEqual(seen, [[1, 2, 3, 4, 5], [3, 4, 5], [3, 4, 5], [5]]);
  assert.deepEqual([...input], [1, 2, 3, 4, 5]);
  assert.deepEqual(
    writeAll(() => {
      throw Error("must not write");
    }, new Uint8Array()),
    { ok: true, value: 0 },
  );
});
test("invalid counts, stalled writes and permanent errors terminate", () => {
  for (const value of [-1, 0.5, NaN, 2]) {
    assert.deepEqual(
      readAll(() => ({ ok: true, value }), 0),
      { ok: false, error: { kind: "invalid-count" } },
    );
    assert.deepEqual(
      writeAll(() => ({ ok: true, value }), new Uint8Array(1)),
      { ok: false, error: { kind: "invalid-count" } },
    );
  }
  assert.deepEqual(
    writeAll(() => ({ ok: true, value: 0 }), new Uint8Array(1)),
    { ok: false, error: { kind: "no-progress" } },
  );
  const error: IOResult<number> = {
    ok: false,
    error: { kind: "host", code: "EIO", interrupted: false },
  };
  assert.deepEqual(
    readAll(() => error, 10),
    error,
  );
  assert.deepEqual(
    writeAll(() => error, new Uint8Array(1)),
    error,
  );
});
