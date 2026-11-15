import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  NativeModule,
  NativeManagedPointerImport,
} from "@tint/codegen/aarch64/scalar";
import {
  resolveManagedPointers,
  managedIdentityByteLength,
  type ManagedIdentityBinding,
} from "../src/native/managed-imports.ts";
const request: NativeManagedPointerImport = {
  role: "function-entry",
  name: "entry",
  contract: "test.entry.v1",
  offset: 0,
  byteLength: 8,
  witness: 0,
  parameters: ["number"],
  returnType: "number",
};
const binding: ManagedIdentityBinding = {
  role: "function-entry",
  name: "entry",
  contract: "test.entry.v1",
  domain: 17,
  address: 0x4000,
  byteLength: 40,
  entry: 0x9004,
  parameters: ["number"],
  returnType: "number",
};
function fixture(
  imports: readonly NativeManagedPointerImport[] = [request],
): NativeModule {
  return {
    linkage: "unresolved-managed",
    managedImports: imports,
    functionDescriptor: undefined,
    functionDescriptorImport: undefined,
    code: new Uint8Array(imports.length * 8),
    functions: [],
    records: [],
    stackMaps: [],
    strings: [],
    signatures: [],
    helpers: [],
    cellHelpers: [],
    imports: [],
    sourceRanges: [],
  };
}
const words = [1, 40, 1, 8, 8];
test("function-entry imports check signature metadata and patch the code address", () => {
  const native = fixture(),
    reads: number[] = [];
  const result = resolveManagedPointers(
    native,
    [binding],
    (address, length, offset) => {
      assert.equal(address, binding.address);
      assert.equal(length, 40);
      reads.push(offset);
      return words[offset / 8]!;
    },
    17,
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(reads, [0, 8, 16, 24, 32]);
  assert.equal(
    new DataView(result.value.code.buffer).getBigUint64(0, true),
    BigInt(binding.entry!),
  );
  assert.deepEqual([...native.code], new Array(8).fill(0));
  assert.equal(
    managedIdentityByteLength({
      role: "function-entry",
      parameters: ["number"],
      returnType: "number",
    }),
    40,
  );
});
test("entry authority, ABI, role and context are all validated before metadata reads", () => {
  for (const changed of [
    { ...binding, entry: undefined },
    ...[-1, 0, NaN, Infinity, 0x9002].map((entry) => ({ ...binding, entry })),
    { ...binding, domain: 19 },
    { ...binding, contract: "different" },
    { ...binding, role: "signature" as const },
    { ...binding, returnType: "string" as const },
    { ...binding, parameters: ["string" as const] },
    { ...binding, address: 0x4004 },
  ]) {
    let reads = 0;
    const result = resolveManagedPointers(
      fixture(),
      [changed],
      () => {
        reads++;
        return -1;
      },
      17,
    );
    assert.equal(result.ok, false);
    assert.equal(reads, 0);
  }
  const native = fixture([
    request,
    { ...request, name: "second", contract: "test.second.v1", offset: 8 },
  ]);
  let reads = 0;
  const result = resolveManagedPointers(
    native,
    [binding, { ...binding, name: "second", contract: "wrong" }],
    () => {
      reads++;
      return -1;
    },
    17,
  );
  assert.equal(result.ok, false);
  assert.equal(reads, 0);
  assert.deepEqual([...native.code], new Array(16).fill(0));
});
test("a late signature mismatch never patches any entry", () => {
  const native = fixture(),
    before = native.code.slice();
  let reads = 0;
  const result = resolveManagedPointers(
    native,
    [binding],
    (_a, _b, offset) => {
      reads++;
      return offset === 32 ? 4 : words[offset / 8]!;
    },
    17,
  );
  assert.equal(result.ok, false);
  assert.equal(reads, 5);
  assert.deepEqual(native.code, before);
});
