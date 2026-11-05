import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { NodeSharedBlockService } from "./node-shared-block-service.ts";
import { workspaceModules } from "./workspace-sources.ts";
import type { SharedOrder } from "@tint/js-runtime/bytes/shared";

async function contract() {
  assert.ok(
    existsSync("packages/js-runtime/src/bytes/shared.ts"),
    "portable shared-block contract must exist",
  );
  return import("../packages/js-runtime/src/bytes/shared.ts");
}
async function fixture(initial = 8, maximum = 24, growable = true) {
  const api = await contract();
  const service = new NodeSharedBlockService();
  const result = api.createSharedStorage(service, initial, maximum, growable);
  assert.ok(result.ok);
  return { api, service, storage: result.value };
}

test("shared aliases retain primitive engine/block identity including empty blocks", async () => {
  const { api, service, storage } = await fixture(0, 0, false);
  const alias = api.attachSharedStorage(service, storage.handle);
  assert.ok(alias.ok);
  assert.notEqual(alias.value, storage);
  assert.equal(api.sameSharedBlock(storage, alias.value), true);
  assert.equal(typeof storage.engineId, "number");
  assert.equal(typeof storage.blockId, "number");
  const distinct = api.createSharedStorage(service, 0, 0, false);
  assert.ok(distinct.ok);
  assert.equal(api.sameSharedBlock(storage, distinct.value), false);
  const other = await fixture(0, 0, false);
  assert.equal(storage.blockId, other.storage.blockId);
  assert.equal(api.sameSharedBlock(storage, other.storage), false);
  assert.deepEqual(api.attachSharedStorage(service, 999), {
    ok: false,
    error: "invalid-handle",
  });
});

test("growth publishes authoritative shared length without relocating or erasing bytes", async () => {
  const { api, service, storage } = await fixture(4, 16);
  const alias = api.attachSharedStorage(service, storage.handle);
  assert.ok(alias.ok);
  const block = service.blocks.get(storage.handle)!;
  const payload = block.payload;
  assert.ok(payload instanceof SharedArrayBuffer);
  assert.equal(
    api.writeSharedUnsigned(storage, 0, 4, 0xffffffff, "unordered"),
    "none",
  );
  // A different host wrapper really aliases the same shared bytes.
  const hostAlias = structuredClone(payload);
  assert.notEqual(hostAlias, payload);
  new Uint8Array(hostAlias)[0] = 17;
  assert.deepEqual(api.readSharedByte(storage, 0), { ok: true, value: 17 });
  assert.equal(api.growSharedStorage(alias.value, 12), "none");
  assert.equal(service.blocks.get(storage.handle)!.payload, payload);
  assert.deepEqual(api.sharedStorageLength(storage, "seq-cst"), {
    ok: true,
    value: 12,
  });
  assert.equal(api.growSharedStorage(storage, 8), "invalid-length");
  assert.equal(api.growSharedStorage(storage, 12), "none");
  assert.equal(api.growSharedStorage(storage, 17), "invalid-length");
  assert.deepEqual([...new Uint8Array(payload, 4, 8)], Array(8).fill(0));
  assert.deepEqual(api.readSharedByte(alias.value, 0), { ok: true, value: 17 });
  // Direct host growth models another alias publishing before this wrapper acts.
  assert.equal(service.grow(storage.handle, 16), "none");
  assert.equal(api.growSharedStorage(storage, 14), "invalid-length");
  assert.deepEqual(api.sharedStorageLength(alias.value, "seq-cst"), {
    ok: true,
    value: 16,
  });
});

test("a shared view witness captures exactly one ordered length and never rereads it", async () => {
  const api = await contract();
  class ObservedService extends NodeSharedBlockService {
    readonly reads: SharedOrder[] = [];
    override length(handle: number, order: SharedOrder) {
      this.reads.push(order);
      return super.length(handle, order);
    }
  }
  const service = new ObservedService();
  const created = api.createSharedStorage(service, 7, 16, true);
  assert.ok(created.ok);
  const storage = created.value;
  const witness = api.sharedStorageWindow(storage, 2, undefined, 2, "seq-cst");
  assert.ok(witness.ok);
  assert.equal(witness.value.length, 2);
  assert.equal(witness.value.byteLength, 7);
  assert.deepEqual(service.reads, ["seq-cst"]);
  assert.equal(api.growSharedStorage(storage, 12), "none");
  assert.equal(witness.value.length, 2);
  const tracking = api.sharedStorageWindow(
    storage,
    2,
    undefined,
    2,
    "unordered",
  );
  assert.ok(tracking.ok);
  assert.equal(tracking.value.length, 5);
  assert.deepEqual(service.reads, ["seq-cst", "unordered"]);
  const fixed = api.sharedStorageWindow(storage, 2, 2, 2, "seq-cst");
  assert.ok(fixed.ok);
  assert.equal(fixed.value.length, 2);
  assert.deepEqual(
    api.sharedStorageWindow(storage, 12, 0, 1, "seq-cst").ok,
    true,
  );
  assert.deepEqual(api.sharedStorageWindow(storage, 12, 1, 1, "seq-cst"), {
    ok: false,
    error: "invalid-range",
  });
  assert.deepEqual(
    api.sharedStorageWindow(storage, 14, undefined, 1, "seq-cst"),
    { ok: false, error: "invalid-range" },
  );
});

test("fixed views can become accessible after growth and tracking views discard partial elements", async () => {
  const { api, storage } = await fixture(3, 16);
  assert.deepEqual(api.sharedStorageWindow(storage, 0, 2, 2, "seq-cst"), {
    ok: false,
    error: "invalid-range",
  });
  const tracking = api.sharedStorageWindow(storage, 0, undefined, 2, "seq-cst");
  assert.ok(tracking.ok);
  assert.equal(tracking.value.length, 1);
  assert.equal(api.growSharedStorage(storage, 4), "none");
  const fixed = api.sharedStorageWindow(storage, 0, 2, 2, "seq-cst");
  assert.ok(fixed.ok);
  assert.equal(fixed.value.length, 2);
});

test("shared byte accesses remain separate from aligned width-preserving integer accesses", async () => {
  const { api, storage } = await fixture(16, 16, false);
  for (const width of [1, 2, 4] as const) {
    const value = 2 ** (width * 8) - 1;
    for (const order of ["unordered", "seq-cst"] as const) {
      assert.equal(
        api.writeSharedUnsigned(storage, 0, width, value, order),
        "none",
      );
      assert.deepEqual(api.readSharedUnsigned(storage, 0, width, order), {
        ok: true,
        value,
      });
    }
  }
  assert.equal(api.writeSharedByte(storage, 1, 0x87), "none");
  assert.deepEqual(api.readSharedByte(storage, 1), { ok: true, value: 0x87 });
  assert.deepEqual(api.readSharedUnsigned(storage, 1, 4, "unordered"), {
    ok: false,
    error: "unaligned",
  });
  assert.equal(
    api.writeSharedUnsigned(storage, 1, 2, 1, "unordered"),
    "unaligned",
  );
  assert.deepEqual(api.readSharedUnsigned(storage, 16, 4, "unordered"), {
    ok: false,
    error: "invalid-range",
  });
  assert.equal(api.writeSharedByte(storage, 16, 1), "invalid-range");
  assert.equal(api.writeSharedByte(storage, 0, 256), "invalid-value");
});

test("Word64 transport preserves arbitrary 64-bit payloads as exact lo/hi halves", async () => {
  const { api, service, storage } = await fixture(16, 16, false);
  for (const word of [
    { lo: 0xffffffff, hi: 0xffffffff },
    { lo: 1, hi: 0x80000000 },
    { lo: 0, hi: 0 },
    { lo: 0xffffffff, hi: 0x1fffff },
  ]) {
    for (const order of ["unordered", "seq-cst"] as const) {
      assert.equal(api.writeSharedWord64(storage, 8, word, order), "none");
      assert.deepEqual(api.readSharedWord64(storage, 8, order), {
        ok: true,
        value: word,
      });
      assert.equal(
        new BigUint64Array(
          service.blocks.get(storage.handle)!.payload,
          8,
          1,
        )[0],
        (BigInt(word.hi) << 32n) | BigInt(word.lo),
      );
    }
  }
  assert.equal(
    api.writeSharedWord64(storage, 0, { lo: 0x100000000, hi: 0 }, "unordered"),
    "invalid-value",
  );
  assert.deepEqual(api.readSharedWord64(storage, 1, "unordered"), {
    ok: false,
    error: "unaligned",
  });
  assert.deepEqual(api.readSharedWord64(storage, 16, "unordered"), {
    ok: false,
    error: "invalid-range",
  });
});

test("shared numeric validation rejects unsound assertions before invoking trusted leaves", async () => {
  const { api, service, storage } = await fixture();
  const invalid = [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1];
  const before = service.blocks.size;
  for (const length of invalid) {
    assert.deepEqual(api.createSharedStorage(service, length, 16, true), {
      ok: false,
      error: "invalid-length",
    });
    assert.equal(api.growSharedStorage(storage, length), "invalid-length");
    assert.deepEqual(api.readSharedByte(storage, length), {
      ok: false,
      error: "invalid-range",
    });
    assert.deepEqual(api.attachSharedStorage(service, length), {
      ok: false,
      error: "invalid-handle",
    });
  }
  assert.equal(service.blocks.size, before);
  assert.deepEqual(api.createSharedStorage(service, 2, 4, false), {
    ok: false,
    error: "invalid-length",
  });
  assert.deepEqual(
    api.createSharedStorage(service, 0, 32 * 1024 * 1024, true),
    { ok: false, error: "allocation-limit" },
  );
  assert.deepEqual(api.sharedStorageLength(storage, "bad" as SharedOrder), {
    ok: false,
    error: "invalid-order",
  });
  assert.deepEqual(api.readSharedUnsigned(storage, 0, 8 as 4, "unordered"), {
    ok: false,
    error: "invalid-width",
  });
  assert.deepEqual(
    api.sharedStorageWindow(storage, 0, undefined, 0, "seq-cst"),
    { ok: false, error: "invalid-range" },
  );
  assert.deepEqual(
    api.sharedStorageWindow(storage, 1, undefined, 2, "seq-cst"),
    { ok: false, error: "unaligned" },
  );
  const fixed = await fixture(4, 4, false);
  assert.equal(api.growSharedStorage(fixed.storage, NaN), "fixed-length");
  // Invalid primitive arguments must not reach host length/access operations.
  service.length = () => {
    throw Error("unexpected length read");
  };
  service.readUnsigned = () => {
    throw Error("unexpected payload read");
  };
  assert.deepEqual(
    api.sharedStorageWindow(storage, -1, undefined, 1, "seq-cst"),
    { ok: false, error: "invalid-range" },
  );
  assert.deepEqual(api.readSharedByte(storage, -1), {
    ok: false,
    error: "invalid-range",
  });
  assert.deepEqual(
    api.readSharedUnsigned(storage, 0, 4, "bad" as SharedOrder),
    { ok: false, error: "invalid-order" },
  );
});

test("trusted service independently rejects unknown handles and access bounds", async () => {
  const { service, storage } = await fixture();
  assert.deepEqual(service.length(999, "seq-cst"), {
    ok: false,
    error: "invalid-handle",
  });
  assert.equal(service.grow(999, 0), "invalid-handle");
  assert.deepEqual(service.readUnsigned(999, 0, 4, "unordered"), {
    ok: false,
    error: "invalid-handle",
  });
  assert.equal(
    service.writeWord64(999, 0, "unordered", 0, 0),
    "invalid-handle",
  );
  assert.equal(
    service.readWord64(storage.handle, 0, "unordered", new Uint32Array(1)),
    "invalid-value",
  );
  assert.equal(
    service.writeUnsigned(storage.handle, 8, 1, 1, "unordered"),
    "invalid-range",
  );
  assert.equal(
    service.writeUnsigned(storage.handle, 1, 2, 1, "unordered"),
    "unaligned",
  );
  assert.deepEqual(
    service.readUnsigned(storage.handle, 0, 8 as 4, "unordered"),
    { ok: false, error: "invalid-width" },
  );
  assert.equal(
    service.writeUnsigned(storage.handle, 0, 8 as 4, 1, "unordered"),
    "invalid-width",
  );
});

test("shared storage remains portable and independent of ordinary storage", async () => {
  await contract();
  const ids = workspaceModules(["packages/js-runtime/src/bytes/shared.ts"])
    .map((module) => module.id)
    .sort();
  assert.deepEqual(ids, [
    "packages/foundation/src/binary/word64.ts",
    "packages/js-runtime/src/bytes/shared.ts",
  ]);
  assert.deepEqual(
    workspaceModules(["packages/js-runtime/src/bytes/index.ts"]).map(
      (module) => module.id,
    ),
    ["packages/js-runtime/src/bytes/index.ts"],
  );
});
