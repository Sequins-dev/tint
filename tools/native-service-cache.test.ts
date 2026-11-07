import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { nativeServiceFixtureRequest } from "./native-service-fixture.ts";
import * as cache from "./native-service-cache.ts";
function inputs() {
  return {
    toolchainSha256: "a".repeat(64),
    sourceSnapshotSha256: "b".repeat(64),
    request: nativeServiceFixtureRequest(),
    data: [{ name: "calendar", bytes: new Uint8Array([1, 2, 3]) }],
  };
}
test("unit indexes pin every artifact and bind name and reject changed cached bytes", () => {
  assert.equal(typeof cache.createNativeServiceUnitIndex, "function");
  const directory = mkdtempSync(join(tmpdir(), "tint-service-index-"));
  try {
    const cached = cache.prepareCachedNativeServiceUnit(directory, inputs()),
      item = { cached, bind: { module: "facade", name: "instantiate" } };
    const index = cache.createNativeServiceUnitIndex([item]);
    assert.equal(index.identity.nativeLinkingMode, "aot-native-services-v1");
    assert.equal(index.identity.nativeServiceUnitIndexSha256.length, 64);
    assert.equal(
      index.services[0]?.unit.factoryContract,
      cached.unit.factoryContract,
    );
    assert.notEqual(
      cache.createNativeServiceUnitIndex([
        { ...item, bind: { ...item.bind, name: "other" } },
      ]).identity.nativeServiceUnitIndexSha256,
      index.identity.nativeServiceUnitIndexSha256,
    );
    cached.unit.native.code[0] = (cached.unit.native.code[0] ?? 0) ^ 1;
    assert.throws(() => cache.createNativeServiceUnitIndex([item]), /artifact/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("native unit key covers source, toolchain, data, contracts, adapters and all effective options", () => {
  assert.equal(typeof cache.nativeServiceCacheKey, "function");
  const original = inputs(),
    key = cache.nativeServiceCacheKey(original);
  const changes = [
    { ...original, toolchainSha256: "c".repeat(64) },
    { ...original, sourceSnapshotSha256: "c".repeat(64) },
    {
      ...original,
      data: [{ name: "calendar", bytes: new Uint8Array([1, 2, 4]) }],
    },
    { ...original, request: { ...original.request, entry: "other" } },
    {
      ...original,
      request: {
        ...original.request,
        module: { ...original.request.module, end: 99 },
      },
    },
    {
      ...original,
      request: { ...original.request, specifiers: new Set(["other"]) },
    },
    {
      ...original,
      request: {
        ...original.request,
        instantiations: new Map([["seed", ["number"]]]),
      },
    },
    {
      ...original,
      request: {
        ...original.request,
        read: {
          ...original.request.read,
          directory: { ...original.request.read.directory, name: "other" },
        },
      },
    },
    {
      ...original,
      request: {
        ...original.request,
        runtime: { ...original.request.runtime, maxSpecializations: 4 },
      },
    },
    {
      ...original,
      request: {
        ...original.request,
        runtime: {
          ...original.request.runtime,
          globals: ["undefined", "other"],
        },
      },
    },
  ];
  for (const changed of changes)
    assert.notEqual(cache.nativeServiceCacheKey(changed), key);
  assert.equal(cache.nativeServiceCacheKey(inputs()), key);
  assert.throws(
    () =>
      cache.nativeServiceCacheKey(
        Object.assign({}, original, {
          request: { ...original.request, unknownOption: true },
        }),
      ),
    /unknown/,
  );
  assert.throws(
    () => cache.nativeServiceCacheKey({ ...original, toolchainSha256: "bad" }),
    /digest/,
  );
});
test("native unit cache reuses exact artifacts and rejects stale or corrupt entries", () => {
  assert.equal(typeof cache.prepareCachedNativeServiceUnit, "function");
  const directory = mkdtempSync(join(tmpdir(), "tint-service-cache-"));
  try {
    const input = inputs(),
      first = cache.prepareCachedNativeServiceUnit(directory, input);
    assert.equal(first.hit, false);
    const second = cache.prepareCachedNativeServiceUnit(directory, inputs());
    assert.equal(second.hit, true);
    assert.equal(second.digest, first.digest);
    assert.deepEqual(second.unit, first.unit);
    assert.notEqual(
      cache.prepareCachedNativeServiceUnit(directory, {
        ...input,
        data: [{ name: "calendar", bytes: new Uint8Array([4]) }],
      }).key,
      first.key,
    );
    const path = join(directory, first.key + ".json"),
      bytes = readFileSync(path);
    const mismatched = JSON.parse(bytes.toString());
    mismatched.payload = mismatched.payload.replace(
      "tint.service.factory.v1/",
      "wrong.service.factory.v1/",
    );
    mismatched.digest = createHash("sha256")
      .update(mismatched.payload)
      .digest("hex");
    writeFileSync(path, JSON.stringify(mismatched));
    assert.throws(
      () => cache.prepareCachedNativeServiceUnit(directory, input),
      /factory|surface/,
    );
    for (const mutate of [
      (value: Record<string, unknown>) => ({ ...value, version: 99 }),
      (value: Record<string, unknown>) => ({ ...value, key: "0".repeat(64) }),
      (value: Record<string, unknown>) => ({ ...value, code: "AAAA" }),
      (value: Record<string, unknown>) => ({
        ...value,
        metadata: { entryOffset: 99 },
      }),
    ]) {
      writeFileSync(path, JSON.stringify(mutate(JSON.parse(bytes.toString()))));
      assert.throws(
        () => cache.prepareCachedNativeServiceUnit(directory, input),
        /native service cache/,
      );
    }
    writeFileSync(path, bytes.subarray(0, bytes.length - 3));
    assert.throws(
      () => cache.prepareCachedNativeServiceUnit(directory, input),
      /native service cache/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
