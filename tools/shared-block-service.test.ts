import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { NodeSharedMemoryHost } from "./node-shared-memory-host.ts";
import {
  createSharedStorage,
  attachSharedStorage,
  sameSharedBlock,
} from "@tint/js-runtime/bytes/shared";
async function api() {
  assert.ok(
    existsSync("packages/native-runtime/src/shared-blocks.ts"),
    "native shared block service must exist",
  );
  return import("../packages/native-runtime/src/shared-blocks.ts");
}
async function fixture(maxBlocks = 4, maxReservedBytes = 256) {
  const serviceApi = await api(),
    host = new NodeSharedMemoryHost();
  const result = serviceApi.createNativeSharedBlockService(host, {
    pageSize: 64,
    maxBlocks,
    maxReservedBytes,
  });
  assert.ok(result.ok);
  return { serviceApi, host, service: result.value };
}
test("native shared registry identity and data survive distinct service and storage wrappers", async () => {
  const { serviceApi, host, service } = await fixture();
  const block = createSharedStorage(service, 8, 32, true);
  assert.ok(block.ok);
  const facade = serviceApi.attachNativeSharedBlockService(
    new NodeSharedMemoryHost(host.kernel),
    service.registry,
  );
  assert.ok(facade.ok);
  assert.notEqual(service, facade.value);
  const alias = attachSharedStorage(facade.value, block.value.handle);
  assert.ok(alias.ok);
  assert.ok(sameSharedBlock(block.value, alias.value));
  assert.equal(
    service.writeUnsigned(block.value.handle, 0, 4, 0xffffffff, "unordered"),
    "none",
  );
  assert.deepEqual(
    facade.value.readUnsigned(block.value.handle, 0, 4, "seq-cst"),
    { ok: true, value: 0xffffffff },
  );
  assert.equal(facade.value.grow(block.value.handle, 24), "none");
  assert.deepEqual(service.length(block.value.handle, "seq-cst"), {
    ok: true,
    value: 24,
  });
  for (let offset = 8; offset < 24; offset++)
    assert.deepEqual(
      service.readUnsigned(block.value.handle, offset, 1, "unordered"),
      { ok: true, value: 0 },
    );
  const other = await fixture();
  const different = createSharedStorage(other.service, 8, 32, true);
  assert.ok(different.ok);
  assert.equal(sameSharedBlock(block.value, different.value), false);
});
test("native registry quotas and failed mapping rollback are authoritative across aliases", async () => {
  const { serviceApi, host, service } = await fixture(2, 128);
  const aliases = serviceApi.attachNativeSharedBlockService(
    new NodeSharedMemoryHost(host.kernel),
    service.registry,
  );
  assert.ok(aliases.ok);
  host.kernel.failNextMap = true;
  assert.deepEqual(service.create(0, 32, true), {
    ok: false,
    error: "allocation-limit",
  });
  assert.equal(host.kernel.mappings.size, 1);
  const first = aliases.value.create(0, 0, false);
  assert.ok(first.ok);
  assert.equal(first.value.handle, 1);
  const second = service.create(1, 64, true);
  assert.ok(second.ok);
  assert.equal(second.value.handle, 2);
  assert.deepEqual(aliases.value.create(0, 0, false), {
    ok: false,
    error: "allocation-limit",
  });
  assert.equal(host.kernel.mappings.size, 3);
  assert.notEqual(first.value.blockId, second.value.blockId);
  const bounded = await fixture(8, 64);
  assert.ok(bounded.service.create(0, 0, false).ok);
  assert.deepEqual(bounded.service.create(0, 1, true), {
    ok: false,
    error: "allocation-limit",
  });
});
test("native shared Word64 transport remains bit-exact and byte/width bounds remain separate", async () => {
  const { service } = await fixture();
  const block = service.create(16, 32, true);
  assert.ok(block.ok);
  const handle = block.value.handle,
    scratch = new Uint32Array(2);
  assert.equal(
    service.writeWord64(handle, 0, "seq-cst", 0xffffffff, 0xffffffff),
    "none",
  );
  assert.equal(service.readWord64(handle, 0, "unordered", scratch), "none");
  assert.deepEqual([...scratch], [0xffffffff, 0xffffffff]);
  assert.equal(service.writeUnsigned(handle, 1, 1, 7, "unordered"), "none");
  assert.deepEqual(service.readUnsigned(handle, 1, 1, "unordered"), {
    ok: true,
    value: 7,
  });
  assert.deepEqual(service.readUnsigned(handle, 1, 4, "unordered"), {
    ok: false,
    error: "unaligned",
  });
  assert.deepEqual(service.readUnsigned(handle, 16, 1, "unordered"), {
    ok: false,
    error: "invalid-range",
  });
  assert.equal(
    service.readWord64(handle, 0, "seq-cst", new Uint32Array(1)),
    "invalid-value",
  );
  assert.equal(
    service.writeWord64(handle, 0, "seq-cst", 0x100000000, 0),
    "invalid-value",
  );
  for (const invalid of [0, -1, 1.5, 999, NaN])
    assert.deepEqual(service.describe(invalid), {
      ok: false,
      error: "invalid-handle",
    });
});
test("native grow uses a real CAS publication even at equality and rejects a racing smaller target", async () => {
  const { serviceApi, host, service } = await fixture();
  const block = service.create(8, 64, true);
  assert.ok(block.ok);
  const handle = block.value.handle;
  const aliases = serviceApi.attachNativeSharedBlockService(
    new NodeSharedMemoryHost(host.kernel),
    service.registry,
  );
  assert.ok(aliases.ok);
  host.compareScratch.length = 0;
  assert.equal(service.grow(handle, 8), "none");
  assert.ok(host.compareScratch.length > 0);
  let raced = false;
  host.beforeCompare = () => {
    if (raced) return;
    raced = true;
    assert.equal(aliases.value.grow(handle, 32), "none");
  };
  assert.equal(service.grow(handle, 16), "invalid-length");
  assert.deepEqual(service.length(handle, "seq-cst"), { ok: true, value: 32 });
  host.beforeCompare = undefined;
  assert.equal(service.grow(handle, 31), "invalid-length");
  assert.equal(service.grow(handle, 65), "invalid-length");
  const first = host.compareScratch[0];
  host.compareScratch.length = 0;
  assert.equal(service.grow(handle, 32), "none");
  assert.notEqual(
    host.compareScratch[0],
    first,
    "scratch must be per operation",
  );
});
test("native registry publication and quota lock live in scalar shared control memory", async () => {
  const { serviceApi, host, service } = await fixture();
  const abi = await import("@tint/abi/shared-block");
  const scratch = new Uint32Array(2);
  assert.equal(
    host.readSharedWord64(
      service.registry.base,
      service.registry.byteLength,
      abi.sharedRegistryLockOffset,
      1,
      scratch,
    ),
    0,
  );
  assert.deepEqual([...scratch], [0, 0]);
  const original = host.mapMemory.bind(host);
  let observed = false;
  host.mapMemory = (length) => {
    observed = true;
    assert.equal(
      host.readSharedWord64(
        service.registry.base,
        service.registry.byteLength,
        abi.sharedRegistryLockOffset,
        1,
        scratch,
      ),
      0,
    );
    assert.equal(scratch[0], 1);
    assert.deepEqual(service.describe(1), {
      ok: false,
      error: "invalid-handle",
    });
    return original(length);
  };
  assert.ok(service.create(0, 32, true).ok);
  assert.equal(observed, true);
  const alias = serviceApi.attachNativeSharedBlockService(
    new NodeSharedMemoryHost(host.kernel),
    service.registry,
  );
  assert.ok(alias.ok);
  assert.ok(alias.value.describe(1).ok);
  assert.equal(
    host.readSharedWord64(
      service.registry.base,
      service.registry.byteLength,
      abi.sharedRegistryPublishedCountOffset,
      1,
      scratch,
    ),
    0,
  );
  assert.deepEqual([...scratch], [1, 0]);
  assert.equal(
    host.readSharedWord64(
      service.registry.base,
      service.registry.byteLength,
      abi.sharedRegistryReservedBytesOffset,
      1,
      scratch,
    ),
    0,
  );
  assert.deepEqual([...scratch], [64, 0]);
});

test("native registry validates policy before mapping and rolls back unpublished reservations", async () => {
  const serviceApi = await api(),
    host = new NodeSharedMemoryHost();
  for (const pageSize of [0, 1, 7, 24, NaN, Infinity])
    assert.deepEqual(
      serviceApi.createNativeSharedBlockService(host, {
        pageSize,
        maxBlocks: 1,
        maxReservedBytes: 128,
      }),
      { ok: false, error: "invalid-length" },
    );
  assert.equal(host.kernel.mappings.size, 0);
  host.kernel.failNextMap = true;
  assert.deepEqual(
    serviceApi.createNativeSharedBlockService(host, {
      pageSize: 64,
      maxBlocks: 1,
      maxReservedBytes: 128,
    }),
    { ok: false, error: "allocation-limit" },
  );
  assert.equal(host.kernel.mappings.size, 0);
  const created = serviceApi.createNativeSharedBlockService(host, {
    pageSize: 64,
    maxBlocks: 2,
    maxReservedBytes: 128,
  });
  assert.ok(created.ok);
  // A host returning an owned but misaligned mapping must be rolled back before publication.
  const map = host.mapMemory.bind(host),
    unmap = host.unmapMemory.bind(host);
  let rejectedBase = 0,
    rolledBack = false;
  host.mapMemory = (length) => {
    const base = map(length);
    const block = host.kernel.mappings.get(base)!;
    host.kernel.mappings.delete(base);
    rejectedBase = base + 8;
    host.kernel.mappings.set(rejectedBase, {
      base: rejectedBase,
      bytes: block.bytes,
    });
    return rejectedBase;
  };
  host.unmapMemory = (base, length) => {
    if (base === rejectedBase) rolledBack = true;
    return unmap(base, length);
  };
  assert.deepEqual(created.value.create(0, 64, true), {
    ok: false,
    error: "allocation-limit",
  });
  assert.equal(rolledBack, true);
  assert.equal(host.kernel.mappings.size, 1);
  host.mapMemory = map;
  const first = created.value.create(0, 65, true);
  assert.ok(first.ok);
  assert.equal(first.value.handle, 1);
  assert.deepEqual(
    created.value.create(0, 0, false),
    { ok: false, error: "allocation-limit" },
    "maximum reservations are page rounded and quota is not initial length",
  );
});
