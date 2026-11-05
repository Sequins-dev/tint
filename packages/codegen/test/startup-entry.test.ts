import { darwinHostABI } from "@tint/platform/darwin/host-abi";
import { test } from "node:test";
import assert from "node:assert/strict";
import { emitHostedEntry, type HostRequest } from "../src/aarch64/startup.ts";
import type { NativeModule } from "@tint/codegen/aarch64/scalar";
function module(
  parameters: readonly { kind: "float" | "integer" | "stack"; index: number }[],
  count = 1,
): NativeModule {
  return {
    sourceRanges: [],
    imports: [],
    signatures: [],
    functionDescriptor: undefined,
    functionDescriptorImport: undefined,
    linkage: "local",
    managedImports: [],
    records: [],
    roots: [],
    strings: [],
    cellHelpers: [],
    helpers: [],
    code: new Uint8Array(count * 16),
    functions: Array.from({ length: count }, (_, id) => ({
      id,
      name: "stub",
      exported: true,
      offset: id * 16,
      byteLength: 16,
      frameBytes: 0,
      signature: {
        parameters: id === 0 ? parameters : [{ kind: "float", index: 0 }],
        stackBytes: parameters.filter((p) => p.kind === "stack").length
          ? 32
          : 0,
      },
    })),
  };
}
function request(): HostRequest {
  return {
    abi: darwinHostABI(),
    allocator: {
      native: module(
        [
          { kind: "float", index: 0 },
          { kind: "float", index: 1 },
          { kind: "integer", index: 4 },
        ],
        2,
      ),
      initialize: 0,
      allocate: 1,
      environmentBytes: 256,
    },
    runtime: {
      native: module([
        ...Array.from({ length: 8 }, (_, index) => ({
          kind: "float" as const,
          index,
        })),
        ...Array.from({ length: 4 }, (_, index) => ({
          kind: "integer" as const,
          index: index + 4,
        })),
        ...Array.from({ length: 3 }, (_, index) => ({
          kind: "stack" as const,
          index: index * 8,
        })),
      ]),
      entry: 0,
    },
    program: { native: module([]), entry: 0 },
    managedBytes: 65536,
    controlBytes: 16384,
    allocationCapacity: 128,
    rootCapacity: 256,
    stackBytes: 1048576,
    pageSize: 16384,
  };
}
test("host entry composes aligned modules and explicit memory imports", () => {
  const result = emitHostedEntry(request());
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.entryOffset, 0);
  assert.ok(result.value.code.length > 64);
  assert.deepEqual(
    [...new Set(result.value.imports.map((i) => i.target.name))].sort(),
    ["_mmap", "_mprotect", "_munmap"],
  );
  for (const fixup of result.value.imports) {
    assert.equal(fixup.offset % 4, 0);
    assert.ok(fixup.offset + 16 <= result.value.code.length);
  }
});
test("invalid host budgets and entry contracts fail before emission", () => {
  const input = request();
  for (const managedBytes of [0, -1, 17, 0x100000000])
    assert.equal(emitHostedEntry({ ...input, managedBytes }).ok, false);
  assert.equal(emitHostedEntry({ ...input, rootCapacity: 0 }).ok, false);
  assert.equal(
    emitHostedEntry({ ...input, program: { ...input.program, entry: 9 } }).ok,
    false,
  );
  assert.equal(
    emitHostedEntry({ ...input, runtime: { native: module([]), entry: 0 } }).ok,
    false,
  );
});

test("hosted context reserves external registration without overlapping allocator state", async () => {
  const backend = await import("@tint/codegen/aarch64/scalar");
  const { encode } = await import("@tint/codegen/aarch64/isa");
  assert.equal(backend.nativeContextBytes, 80);
  assert.equal(backend.nativeExternalMemoryOffset, 64);
  const emitted = emitHostedEntry(request());
  assert.ok(emitted.ok);
  const address = encode({
    op: "add-imm",
    width: 64,
    rd: 1,
    rn: "sp",
    immediate: 176,
    shift: 0,
    setFlags: false,
  });
  assert.ok(address.ok);
  const view = new DataView(
    emitted.value.code.buffer,
    emitted.value.code.byteOffset,
    emitted.value.code.byteLength,
  );
  let found = false;
  for (let offset = 0; offset + 4 <= view.byteLength; offset += 4)
    if (view.getUint32(offset, true) === address.value) found = true;
  assert.ok(
    found,
    "allocator environment follows the complete runtime context",
  );
});

test("standard hosted composition rejects unresolved managed modules in every image role", () => {
  for (const role of ["allocator", "runtime", "program"] as const) {
    const r = request();
    const part = r[role];
    const invalid = {
      ...r,
      [role]: {
        ...part,
        native: { ...part.native, linkage: "unresolved-managed" as const },
      },
    };
    const emitted = emitHostedEntry(invalid);
    assert.equal(emitted.ok, false);
    if (!emitted.ok) assert.match(emitted.error, /unresolved managed/);
  }
});
test("hosted entries issue a permanent, non-reusable identity mapping for each context", () => {
  const emitted = emitHostedEntry(request());
  assert.ok(emitted.ok);
  assert.equal(
    emitted.value.imports.filter((i) => i.target.name === "_mmap").length,
    4,
  );
  assert.equal(
    emitted.value.imports.filter((i) => i.target.name === "_munmap").length,
    3,
    "identity tombstones stay reserved after context cleanup",
  );
});
