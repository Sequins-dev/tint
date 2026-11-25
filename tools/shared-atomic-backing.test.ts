import assert from "node:assert/strict";
import test from "node:test";
import * as native from "../packages/native-runtime/src/shared-blocks.ts";
import { NodeSharedMemoryHost } from "./node-shared-memory-host.ts";
import { NodeSharedBlockService } from "./node-shared-block-service.ts";
import type {
  SharedBlockService,
  SharedUnsignedWidth,
} from "@tint/js-runtime/bytes/shared";
const policy = { pageSize: 64, maxBlocks: 2, maxReservedBytes: 128 };
function nativeService() {
  const host = new NodeSharedMemoryHost();
  const result = native.createNativeSharedBlockService(host, policy, host);
  assert.ok(result.ok);
  return { host, service: result.value };
}
test("native atomic authority requires its independent explicit capability on create and attach", () => {
  const host = new NodeSharedMemoryHost();
  const base = native.createNativeSharedBlockService(host, policy);
  assert.ok(base.ok);
  assert.equal(base.value.atomics, undefined);
  const alias = native.attachNativeSharedBlockService(
    host,
    base.value.registry,
  );
  assert.ok(alias.ok);
  assert.equal(alias.value.atomics, undefined);
  const atomic = native.attachNativeSharedBlockService(
    host,
    base.value.registry,
    host,
  );
  assert.ok(atomic.ok);
  assert.ok(atomic.value.atomics);
  assert.deepEqual(
    Object.keys(native.nativeSharedMemoryHost()).sort(),
    [
      "mapMemory",
      "unmapMemory",
      "readSharedUnsigned",
      "writeSharedUnsigned",
      "readSharedWord64",
      "writeSharedWord64",
      "compareExchangeSharedWord64",
    ].sort(),
  );
  const trusted = native.nativeSharedAtomicMemoryHost();
  assert.deepEqual(Object.keys(trusted), ["compareExchangeSharedUnsigned"]);
  assert.throws(
    () => trusted.compareExchangeSharedUnsigned(1, 8, 0, 1, 0, 1),
    (error) => error === "HOST_UNAVAILABLE",
  );
});
for (const kind of ["node", "native"] as const) {
  test(`${kind} atomic backing returns observed exact widths through aliases and authoritative grow bounds`, () => {
    const setup = kind === "native" ? nativeService() : undefined;
    const service: SharedBlockService =
      setup?.service ?? new NodeSharedBlockService();
    const made = service.create(8, 32, true);
    assert.ok(made.ok);
    let alias = service;
    if (setup) {
      const attached = native.attachNativeSharedBlockService(
        new NodeSharedMemoryHost(setup.host.kernel),
        setup.service.registry,
        new NodeSharedMemoryHost(setup.host.kernel),
      );
      assert.ok(attached.ok);
      alias = attached.value;
    }
    const atomics = alias.atomics;
    assert.ok(atomics);
    for (const width of [1, 2, 4] as const) {
      const maximum = width === 1 ? 255 : width === 2 ? 65535 : 4294967295;
      assert.equal(
        service.writeUnsigned(
          made.value.handle,
          width,
          width,
          maximum,
          "seq-cst",
        ),
        "none",
      );
      assert.deepEqual(
        atomics.compareExchangeUnsigned(
          made.value.handle,
          width,
          width,
          maximum,
          1,
        ),
        { ok: true, value: maximum },
      );
      assert.deepEqual(
        atomics.compareExchangeUnsigned(
          made.value.handle,
          width,
          width,
          maximum,
          0,
        ),
        { ok: true, value: 1 },
      );
      assert.deepEqual(
        atomics.compareExchangeUnsigned(made.value.handle, width, width, 1, 1),
        { ok: true, value: 1 },
      );
      assert.deepEqual(
        service.readUnsigned(made.value.handle, width, width, "seq-cst"),
        { ok: true, value: 1 },
      );
      assert.deepEqual(
        atomics.compareExchangeUnsigned(made.value.handle, 16, width, 0, 1),
        { ok: false, error: "invalid-range" },
      );
    }
    assert.equal(service.grow(made.value.handle, 32), "none");
    assert.deepEqual(
      atomics.compareExchangeUnsigned(made.value.handle, 16, 4, 0, 4294967295),
      { ok: true, value: 0 },
    );
    assert.deepEqual(
      service.readUnsigned(made.value.handle, 16, 4, "seq-cst"),
      { ok: true, value: 4294967295 },
    );
    for (const [handle, offset, width, expected, replacement, error] of [
      [999, 0, 1, 0, 1, "invalid-handle"],
      [made.value.handle, 0, 8, 0, 1, "invalid-width"],
      [made.value.handle, 1, 2, 0, 1, "unaligned"],
      [made.value.handle, -1, 1, 0, 1, "invalid-range"],
      [made.value.handle, 32, 1, 0, 1, "invalid-range"],
      [made.value.handle, 0, 1, 256, 0, "invalid-value"],
      [made.value.handle, 0, 2, 0, 65536, "invalid-value"],
      [made.value.handle, 0, 4, NaN, 0, "invalid-value"],
      [made.value.handle, 0, 4, 0, -1, "invalid-value"],
      [made.value.handle, 0, 4, 0.5, 0, "invalid-value"],
    ] as const)
      assert.deepEqual(
        atomics.compareExchangeUnsigned(
          handle,
          offset,
          width as SharedUnsignedWidth,
          expected,
          replacement,
        ),
        { ok: false, error },
      );
  });
  test(`${kind} Word64 CAS transports every bit and preserves output on failure`, () => {
    const setup = kind === "native" ? nativeService() : undefined;
    const service: SharedBlockService =
      setup?.service ?? new NodeSharedBlockService();
    const made = service.create(16, 16, false);
    assert.ok(made.ok);
    const atomics = service.atomics;
    assert.ok(atomics);
    const handle = made.value.handle,
      output = new Uint32Array([123, 456]);
    assert.equal(
      service.writeWord64(handle, 8, "seq-cst", 0xffffffff, 0xffffffff),
      "none",
    );
    assert.equal(
      atomics.compareExchangeWord64(
        handle,
        8,
        0xffffffff,
        0xffffffff,
        1,
        0x80000000,
        output,
      ),
      "none",
    );
    assert.deepEqual([...output], [0xffffffff, 0xffffffff]);
    assert.equal(
      atomics.compareExchangeWord64(handle, 8, 0, 0, 0, 0, output),
      "none",
    );
    assert.deepEqual([...output], [1, 0x80000000]);
    assert.equal(
      atomics.compareExchangeWord64(
        handle,
        8,
        1,
        0x80000000,
        1,
        0x80000000,
        output,
      ),
      "none",
    );
    assert.deepEqual([...output], [1, 0x80000000]);
    for (const [badHandle, offset, lo, hi, newLo, newHi, error] of [
      [999, 8, 0, 0, 0, 0, "invalid-handle"],
      [handle, 1, 0, 0, 0, 0, "unaligned"],
      [handle, 16, 0, 0, 0, 0, "invalid-range"],
      [handle, 8, -1, 0, 0, 0, "invalid-value"],
      [handle, 8, 0, 4294967296, 0, 0, "invalid-value"],
      [handle, 8, 0, 0, 4294967296, 0, "invalid-value"],
      [handle, 8, 0, 0, 0, NaN, "invalid-value"],
    ] as const) {
      assert.equal(
        atomics.compareExchangeWord64(
          badHandle,
          offset,
          lo,
          hi,
          newLo,
          newHi,
          output,
        ),
        error,
      );
      assert.deepEqual([...output], [1, 0x80000000]);
    }
    const short = new Uint32Array([77]);
    assert.equal(
      atomics.compareExchangeWord64(handle, 8, 1, 0x80000000, 0, 0, short),
      "invalid-value",
    );
    assert.deepEqual([...short], [77]);
  });
}
test("raw reference unsigned CAS validates without truncation and preserves adjacent bytes", () => {
  const host = new NodeSharedMemoryHost(),
    base = host.mapMemory(64);
  assert.equal(host.writeSharedUnsigned(base, 64, 0, 4, 0xffffffff, 1), 0);
  assert.equal(host.compareExchangeSharedUnsigned(base, 64, 1, 1, 255, 1), 255);
  assert.equal(host.readSharedUnsigned(base, 64, 0, 4, 1), 0xffff01ff);
  assert.equal(host.compareExchangeSharedUnsigned(base, 64, 0, 1, 256, 0), -1);
  assert.equal(host.compareExchangeSharedUnsigned(base, 64, 0, 1, 0, 256), -1);
  assert.equal(host.compareExchangeSharedUnsigned(base, 64, 1, 2, 0, 1), -1);
  assert.equal(host.compareExchangeSharedUnsigned(base, 64, 64, 1, 0, 1), -1);
});

test("native atomic calls keep metadata scratch separate from caller output and retain registry quotas", () => {
  const { host, service } = nativeService();
  const made = service.create(16, 16, false);
  assert.ok(made.ok);
  const atomics = service.atomics;
  assert.ok(atomics);
  const captured = new Set<Uint32Array>();
  let registryReads = 0;
  const read = host.readSharedWord64.bind(host);
  host.readSharedWord64 = (address, length, offset, order, scratch) => {
    if (address === service.registry.base) {
      captured.add(scratch);
      registryReads++;
    }
    return read(address, length, offset, order, scratch);
  };
  const output = new Uint32Array(2);
  assert.equal(
    atomics.compareExchangeWord64(made.value.handle, 0, 0, 0, 1, 0, output),
    "none",
  );
  // First access resolves and caches the fixed-length descriptor; later calls
  // reuse it without re-reading the immutable length word.
  const afterFirst = registryReads;
  assert.ok(afterFirst > 0);
  assert.deepEqual(
    atomics.compareExchangeUnsigned(made.value.handle, 0, 4, 1, 2),
    { ok: true, value: 1 },
  );
  assert.equal(registryReads, afterFirst);
  assert.equal(
    atomics.compareExchangeWord64(made.value.handle, 0, 2, 0, 2, 0, output),
    "none",
  );
  assert.equal(registryReads, afterFirst);
  assert.ok(!captured.has(output));
  // Growable blocks still read the authoritative length on every operation.
  const growable = service.create(8, 16, true);
  assert.ok(growable.ok);
  assert.equal(
    atomics.compareExchangeWord64(growable.value.handle, 0, 0, 0, 3, 0, output),
    "none",
  );
  const afterGrowableFirst = registryReads;
  assert.equal(
    atomics.compareExchangeWord64(growable.value.handle, 0, 3, 0, 4, 0, output),
    "none",
  );
  assert.ok(registryReads > afterGrowableFirst);
  assert.ok(!captured.has(output));
  assert.deepEqual(service.create(0, 0, false), {
    ok: false,
    error: "allocation-limit",
  });
  assert.equal(host.kernel.mappings.size, 3);
});
