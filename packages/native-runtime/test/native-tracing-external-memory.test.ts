import assert from "node:assert/strict";
import test from "node:test";
import * as tracing from "../src/tracing/index.ts";

test("external memory grants require one complete window and preserve exact boundaries", () => {
  assert.equal(typeof tracing.createExternalMemoryRegistry, "function");
  const storage = new Float64Array(5);
  const registry = tracing.createExternalMemoryRegistry(
    storage,
    new Float64Array(0),
  );
  assert.ok(registry);
  assert.equal(registry.contains(4096, 8), false);
  assert.equal(registry.register(4096, 16), true);
  assert.equal(registry.register(4112, 16), true);
  assert.equal(registry.contains(4096, 16), true);
  assert.equal(registry.contains(4104, 8), true);
  assert.equal(
    registry.contains(4104, 16),
    false,
    "adjacent grants do not authorize a spanning access",
  );
  assert.equal(registry.contains(4128, 1), false);
  assert.equal(registry.contains(4095, 1), false);
  assert.equal(registry.contains(4096, 0), false);
  assert.equal(
    registry.register(4096, 16),
    true,
    "exact repeat is idempotent even when full",
  );
  const before = storage.slice();
  assert.equal(registry.register(8192, 16), false);
  assert.deepEqual(storage, before);
});

test("external grants cannot overlap reserved or registered ownership", () => {
  assert.equal(typeof tracing.createExternalMemoryRegistry, "function");
  const storage = new Float64Array(9),
    registry = tracing.createExternalMemoryRegistry(
      storage,
      new Float64Array([4096, 256]),
    );
  assert.ok(registry);
  for (const [base, length] of [
    [4096, 8],
    [4088, 16],
    [4344, 16],
    [4000, 512],
  ]) {
    const before = storage.slice();
    assert.equal(registry.register(base!, length!), false);
    assert.deepEqual(storage, before);
  }
  assert.equal(registry.register(4080, 16), true);
  assert.equal(registry.register(4352, 16), true);
  const before = storage.slice();
  assert.equal(registry.register(4088, 8), false);
  assert.equal(registry.register(4072, 16), false);
  assert.deepEqual(storage, before);
});

test("invalid registry metadata and unsafe ranges fail without publication", () => {
  assert.equal(typeof tracing.createExternalMemoryRegistry, "function");
  for (const length of [0, 1, 2, 4])
    assert.equal(
      tracing.createExternalMemoryRegistry(
        new Float64Array(length),
        new Float64Array(0),
      ),
      undefined,
    );
  for (const count of [1, -1, NaN, Infinity]) {
    const storage = new Float64Array([count, 0, 0]);
    assert.equal(
      tracing.createExternalMemoryRegistry(storage, new Float64Array(0)),
      undefined,
    );
  }
  const storage = new Float64Array(5),
    registry = tracing.createExternalMemoryRegistry(
      storage,
      new Float64Array(0),
    );
  assert.ok(registry);
  for (const [base, length] of [
    [0, 8],
    [-1, 8],
    [1.5, 8],
    [4096, 0],
    [4096, -1],
    [4096, 1.5],
    [NaN, 8],
    [4096, Infinity],
    [Number.MAX_SAFE_INTEGER - 3, 8],
  ]) {
    const before = storage.slice();
    assert.equal(registry.register(base!, length!), false);
    assert.equal(registry.contains(base!, length!), false);
    assert.deepEqual(storage, before);
  }
  assert.equal(
    tracing.createExternalMemoryRegistry(
      storage,
      new Float64Array([1, Infinity]),
    ),
    undefined,
  );
  assert.equal(registry.register(Number.MAX_SAFE_INTEGER - 16, 16), true);
  assert.equal(registry.contains(Number.MAX_SAFE_INTEGER - 8, 8), true);
  assert.equal(registry.contains(Number.MAX_SAFE_INTEGER - 7, 8), false);
});

test("malformed count or reserved extent never grants an out-of-range read", () => {
  const storage = new Float64Array(5),
    reserved = new Float64Array(0);
  const registry = tracing.createExternalMemoryRegistry(storage, reserved);
  assert.ok(registry);
  assert.equal(
    tracing.createExternalMemoryRegistry(
      new Float64Array(3),
      new Float64Array([4096]),
    ),
    undefined,
  );
  for (const count of [-1, 0.5, 3, Infinity, NaN]) {
    storage[0] = count;
    const before = storage.slice();
    assert.equal(registry.contains(4096, 8), false);
    assert.equal(registry.register(4096, 8), false);
    assert.deepEqual(storage, before);
  }
});
