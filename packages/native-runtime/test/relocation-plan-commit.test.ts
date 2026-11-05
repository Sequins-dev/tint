import assert from "node:assert/strict";
import { test } from "node:test";
import * as api from "../src/relocation/index.ts";
function fixture() {
  const memory = new Uint8Array(128),
    view = new DataView(memory.buffer),
    events: string[] = [];
  view.setBigUint64(48, 96n, true);
  view.setBigUint64(112, 32n, true);
  const request = {
    byteLength: 128,
    alignment: 16,
    maxExtents: 8,
    count: 2,
    offsets: new Uint32Array([32, 96]),
    sizes: new Uint32Array([32, 32]),
    destinations: new Uint32Array([0, 32]),
    fixupCount: 2,
    slots: new Float64Array([48, 112]),
    values: new Float64Array([32, 0]),
    publishedOffsets: new Uint32Array(2),
    publishedSizes: new Uint32Array(2),
    canWrite: (slot: number) => slot >= 0 && slot <= 120,
    write: (slot: number, value: number) => {
      events.push("write");
      view.setBigUint64(slot, BigInt(value), true);
      return true;
    },
    move: (destination: number, source: number, size: number) => {
      events.push("move");
      memory.copyWithin(destination, source, source + size);
      return true;
    },
    publish: (offsets: Uint32Array, sizes: Uint32Array, count: number) => {
      events.push("publish");
      assert.deepEqual([...offsets.slice(0, count)], [0, 32]);
      return true;
    },
  };
  return { request, memory, view, events };
}
test("commit updates references before ordered moves and publishes last", () => {
  assert.equal(typeof api.commitRelocation, "function");
  const { request, view, events } = fixture();
  assert.equal(api.commitRelocation(request), true);
  assert.equal(view.getBigUint64(16, true), 32n);
  assert.equal(view.getBigUint64(48, true), 0n);
  assert.deepEqual(events, ["write", "write", "move", "move", "publish"]);
});
test("invalid ranges, capacity and fixups leave memory and allocator untouched", () => {
  for (const change of [
    { maxExtents: 1 },
    { destinations: new Uint32Array([16, 32]) },
    { fixupCount: 3 },
    { canWrite: () => false },
  ]) {
    const { request, memory, events } = fixture(),
      before = memory.slice();
    assert.equal(api.commitRelocation({ ...request, ...change }), false);
    assert.deepEqual(memory, before);
    assert.deepEqual(events, []);
  }
});
test("unexpected mutation failures are fatal rather than recoverable partial commits", () => {
  const { request, events } = fixture();
  assert.throws(
    () => api.commitRelocation({ ...request, move: () => false }),
    (e) => e === "RELOCATION_COMMIT_FAILED",
  );
  assert.deepEqual(events, ["write", "write"]);
});
