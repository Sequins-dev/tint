import { test } from "node:test";
import assert from "node:assert/strict";
import { emitCellAccess } from "@tint/codegen/aarch64/cell";
const cell = { stateOffset: 0, valueOffset: 8, byteLength: 16, mutable: true };
test("guarded access helpers are deterministic and independently callable", () => {
  for (const operation of ["initialize", "read", "write"] as const) {
    const r = emitCellAccess({ ...cell, operation });
    assert.ok(r.ok);
    assert.equal(r.value.length % 4, 0);
    assert.ok(r.value.length > 16);
    assert.deepEqual(emitCellAccess({ ...cell, operation }), r);
  }
});
test("invalid layouts and budgets fail without partial output", () => {
  for (const args of [
    { ...cell, stateOffset: 8 },
    { ...cell, valueOffset: -1 },
    { ...cell, byteLength: 4097 },
    { ...cell, stateOffset: 4096 },
  ]) {
    const r = emitCellAccess({ ...args, operation: "read" });
    assert.ok(!r.ok);
    assert.equal("value" in r, false);
  }
  assert.ok(!emitCellAccess({ ...cell, operation: "read" }, 4).ok);
  assert.ok(
    emitCellAccess({ ...cell, byteLength: 0, operation: "initialize" }).ok,
  );
});

test("scalar cell payloads use unrolled word copies", () => {
  for (const operation of ["read", "initialize", "write"] as const) {
    const result = emitCellAccess({
      ...cell,
      operation,
      valueOffset: 3,
      byteLength: 24,
    });
    assert.ok(result.ok);
    const view = new DataView(
      result.value.buffer,
      result.value.byteOffset,
      result.value.byteLength,
    );
    let wordLoads = 0,
      wordStores = 0;
    for (let i = 0; i < result.value.length; i += 4) {
      const word = view.getUint32(i, true);
      if (word >>> 22 === 0xf9400000 >>> 22) wordLoads++;
      if (word >>> 22 === 0xf9000000 >>> 22) wordStores++;
    }
    assert.equal(wordLoads, 3);
    assert.equal(wordStores, 3);
  }
});
