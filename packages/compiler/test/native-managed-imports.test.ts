import { emitModule } from "@tint/codegen/aarch64/scalar";
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  NativeManagedPointerImport,
  NativeModule,
} from "@tint/codegen/aarch64/scalar";
import {
  resolveManagedPointers,
  type ManagedIdentityBinding,
} from "../src/native/managed-imports.ts";

const brand: NativeManagedPointerImport = {
  role: "function-brand",
  name: "brand",
  contract: "tint.function.v1",
  offset: 16,
  byteLength: 8,
  witness: undefined,
  parameters: [],
  returnType: undefined,
};
const signature: NativeManagedPointerImport = {
  role: "signature",
  name: "reader",
  contract: "tint.global-reader.v1",
  offset: 24,
  byteLength: 8,
  witness: 0,
  parameters: ["string"],
  returnType: "general",
};
function fixture(
  imports: readonly NativeManagedPointerImport[] = [brand, signature],
): NativeModule {
  return {
    linkage: "unresolved-managed",
    managedImports: imports,
    functionDescriptorImport: brand,
    functionDescriptor: undefined,
    code: new Uint8Array(32),
    functions: [],
    records: [],
    roots: [],
    strings: [],
    signatures: [],
    helpers: [],
    cellHelpers: [],
    imports: [],
    sourceRanges: [],
  };
}
const bindings: readonly ManagedIdentityBinding[] = [
  {
    domain: 17,
    role: "function-brand",
    name: "brand",
    contract: "tint.function.v1",
    address: 0x100000008,
    byteLength: 32,
    parameters: [],
    returnType: undefined,
  },
  {
    domain: 17,
    role: "signature",
    name: "reader",
    contract: "tint.global-reader.v1",
    address: 0x200000008,
    byteLength: 40,
    parameters: ["string"],
    returnType: "general",
  },
];
function read(address: number, length: number, offset: number): number {
  const index =
    address === bindings[0]!.address
      ? 0
      : address === bindings[1]!.address
        ? 1
        : -1;
  assert.notEqual(index, -1);
  assert.equal(length, index === 0 ? 32 : 40);
  return (index === 0 ? [48, 1, 24, 0] : [1, 40, 1, 1, 4])[offset / 8] ?? -1;
}
function pointer(bytes: Uint8Array, offset: number): number {
  let value = 0;
  for (let i = 7; i >= 0; i--) value = value * 256 + bytes[offset + i]!;
  return value;
}
test("managed linking validates descriptor roles and patches full-width pointers in a new image", () => {
  const native = fixture(),
    before = native.code.slice();
  const linked = resolveManagedPointers(native, bindings, read, 17);
  assert.ok(linked.ok, JSON.stringify(linked));
  assert.deepEqual(native.code, before);
  assert.notEqual(linked.value.code, native.code);
  assert.equal(pointer(linked.value.code, 16), bindings[0]!.address);
  assert.equal(pointer(linked.value.code, 24), bindings[1]!.address);
  assert.equal(
    "functions" in linked.value,
    false,
    "Resolved bytes are not an AOT NativeModule",
  );
});
test("managed linking requires explicit names, roles, contracts and complete ordered signature", () => {
  for (const changed of [
    bindings.slice(0, 1),
    [bindings[0]!, { ...bindings[1]!, name: "other" }],
    [bindings[0]!, { ...bindings[1]!, role: "function-brand" as const }],
    [bindings[0]!, { ...bindings[1]!, contract: "unrelated" }],
    [bindings[0]!, { ...bindings[1]!, parameters: ["reference"] as const }],
    [bindings[0]!, { ...bindings[1]!, returnType: "reference" as const }],
    [...bindings, bindings[1]!],
  ])
    assert.equal(
      resolveManagedPointers(fixture(), changed, read, 17).ok,
      false,
      JSON.stringify(changed),
    );
  const reordered = { ...signature, parameters: ["string", "number"] as const };
  assert.equal(
    resolveManagedPointers(
      fixture([brand, reordered]),
      [
        bindings[0]!,
        { ...bindings[1]!, parameters: ["number", "string"], byteLength: 48 },
      ],
      read,
      17,
    ).ok,
    false,
  );
});
test("managed linking rejects malformed slots before inspecting any identities", () => {
  for (const changed of [
    { ...signature, offset: -8 },
    { ...signature, offset: 25 },
    { ...signature, offset: 32 },
    { ...signature, offset: Number.NaN },
    { ...signature, offset: 16 },
    { ...signature, byteLength: 16 as 8 },
  ]) {
    let reads = 0;
    assert.equal(
      resolveManagedPointers(
        fixture([brand, changed]),
        bindings,
        () => {
          reads++;
          return 0;
        },
        17,
      ).ok,
      false,
    );
    assert.equal(reads, 0);
  }
  const native = fixture();
  native.code[24] = 1;
  assert.equal(resolveManagedPointers(native, bindings, read, 17).ok, false);
  assert.equal(native.code[24], 1);
});
test("managed linking verifies immutable function and signature wire layouts without partial patching", () => {
  for (const offset of [0, 8, 16, 24]) {
    const native = fixture();
    const linked = resolveManagedPointers(
      native,
      bindings,
      (address, length, at) =>
        address === bindings[0]!.address && at === offset
          ? 99
          : read(address, length, at),
      17,
    );
    assert.equal(linked.ok, false);
    assert.deepEqual(native.code, new Uint8Array(32));
  }
  for (const offset of [0, 8, 16, 24, 32])
    assert.equal(
      resolveManagedPointers(
        fixture(),
        bindings,
        (address, length, at) =>
          address === bindings[1]!.address && at === offset
            ? 99
            : read(address, length, at),
        17,
      ).ok,
      false,
    );
  assert.equal(
    resolveManagedPointers(
      fixture(),
      bindings,
      () => {
        throw new Error("unreadable");
      },
      17,
    ).ok,
    false,
  );
});
test("managed identities require exact aligned permanent windows", () => {
  for (const address of [
    0,
    -8,
    1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MAX_SAFE_INTEGER - 7,
  ]) {
    assert.equal(
      resolveManagedPointers(
        fixture(),
        [bindings[0]!, { ...bindings[1]!, address }],
        read,
        17,
      ).ok,
      false,
      String(address),
    );
  }
  for (const byteLength of [0, 32, 48, -1, Number.NaN])
    assert.equal(
      resolveManagedPointers(
        fixture(),
        [bindings[0]!, { ...bindings[1]!, byteLength }],
        read,
        17,
      ).ok,
      false,
      String(byteLength),
    );
});

test("managed linking rejects inconsistent explicit function-brand roles and occupied metadata", () => {
  for (const native of [
    { ...fixture(), linkage: "local" as const },
    { ...fixture(), functionDescriptorImport: undefined },
    {
      ...fixture(),
      functionDescriptorImport: { ...brand, contract: "different" },
    },
    {
      ...fixture(),
      functionDescriptor: {
        record: 0,
        offset: 0,
        byteLength: 48,
        referenceOffsets: [24],
        generalOffsets: [],
      },
    },
    fixture([{ ...brand, role: "invalid" as "function-brand" }, signature]),
    fixture([brand, { ...signature, witness: undefined }]),
    {
      ...fixture(),
      records: [
        {
          record: 0,
          offset: 8,
          byteLength: 48,
          referenceOffsets: [24],
          generalOffsets: [],
        },
      ],
    },
    {
      ...fixture(),
      signatures: [
        {
          version: 1 as const,
          offset: 0,
          byteLength: 40,
          parameters: ["string"] as const,
          returnType: "general" as const,
          functions: [0],
        },
      ],
    },
  ])
    assert.equal(
      resolveManagedPointers(native, bindings, read, 17).ok,
      false,
      JSON.stringify(native),
    );
});

test("managed resolver consumes actual emitter relocations without treating private descriptors as brands", async () => {
  const { emitModule } = await import("@tint/codegen/aarch64/scalar");
  const span = { start: 0, end: 0 };
  const emitted = emitModule(
    {
      functions: [
        {
          id: 0,
          name: "entry",
          exported: true,
          parameters: [0],
          slots: ["reference"],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "load", id: 0, slot: 0, ...span },
                {
                  kind: "call-indirect",
                  id: 1,
                  target: 1,
                  callee: 0,
                  arguments: [],
                  ...span,
                },
              ],
              terminator: { kind: "return", value: 1, ...span },
            },
          ],
        },
        {
          id: 1,
          name: "witness",
          exported: false,
          parameters: [],
          slots: [],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [{ kind: "constant", id: 0, value: 42, ...span }],
              terminator: { kind: "return", value: 0, ...span },
            },
          ],
        },
      ],
    },
    {
      managedABI: {
        version: 1,
        functionBrand: { name: brand.name, contract: brand.contract },
        signatures: [
          {
            witness: 1,
            name: signature.name,
            contract: signature.contract,
            parameters: [],
            returnType: "number",
          },
        ],
      },
    },
  );
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const identities = [
    bindings[0]!,
    {
      ...bindings[1]!,
      byteLength: 32,
      parameters: [],
      returnType: "number" as const,
    },
  ];
  const linked = resolveManagedPointers(
    emitted.value,
    identities,
    (address, length, offset) => {
      if (address === bindings[0]!.address)
        return read(address, length, offset);
      assert.equal(length, 32);
      return [1, 32, 0, 8][offset / 8] ?? -1;
    },
    17,
  );
  assert.ok(linked.ok, JSON.stringify(linked));
  for (const request of emitted.value.managedImports) {
    assert.equal(
      pointer(linked.value.code, request.offset),
      request.role === "function-brand"
        ? identities[0]!.address
        : identities[1]!.address,
    );
    assert.equal(pointer(emitted.value.code, request.offset), 0);
  }
});
test("every managed identity contract is preflighted before reading any descriptor", () => {
  const mismatches: readonly (readonly ManagedIdentityBinding[])[] = [
    [bindings[0]!, { ...bindings[1]!, contract: "tint.global-reader.v2" }],
    [bindings[0]!, { ...bindings[1]!, parameters: ["reference"] }],
    [bindings[0]!, { ...bindings[1]!, returnType: "number" }],
    [bindings[0]!, { ...bindings[1]!, byteLength: 48 }],
  ];
  for (const changed of mismatches) {
    let reads = 0;
    const result = resolveManagedPointers(
      fixture(),
      changed,
      (...args) => {
        reads++;
        return read(...args);
      },
      17,
    );
    assert.equal(result.ok, false);
    assert.equal(
      reads,
      0,
      "a later invalid contract must not authorize earlier pointer reads",
    );
  }
});
test("managed identities require the expected issued context domain before any reads", () => {
  const scoped = bindings.map((binding) => ({ ...binding, domain: 17 }));
  assert.ok(resolveManagedPointers(fixture(), scoped, read, 17).ok);
  for (const expected of [0, -1, NaN, Number.MAX_SAFE_INTEGER + 1, 19]) {
    let reads = 0;
    assert.equal(
      resolveManagedPointers(
        fixture(),
        scoped,
        (...args) => {
          reads++;
          return read(...args);
        },
        expected,
      ).ok,
      false,
    );
    assert.equal(reads, 0);
  }
  let reads = 0;
  assert.equal(
    resolveManagedPointers(
      fixture(),
      [scoped[0]!, { ...scoped[1]!, domain: 19 }],
      (...args) => {
        reads++;
        return read(...args);
      },
      17,
    ).ok,
    false,
  );
  assert.equal(reads, 0);
});

test("member-only callback signatures retain an ABI representative for linker preflight", () => {
  const span = { start: 0, end: 0 };
  const emitted = emitModule(
    {
      functions: [
        {
          id: 0,
          name: "callback",
          exported: false,
          parameters: [0],
          slots: ["string"],
          returnType: "general",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [{ kind: "general-none", id: 0, ...span }],
              terminator: { kind: "return", value: 0, ...span },
            },
          ],
        },
      ],
    },
    {
      managedABI: {
        version: 1,
        functionBrand: { name: brand.name, contract: brand.contract },
        signatures: [
          {
            name: signature.name,
            contract: signature.contract,
            localFunctions: [0],
            parameters: ["string"],
            returnType: "general",
          },
        ],
      },
    },
  );
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const resolved = resolveManagedPointers(emitted.value, bindings, read, 17);
  assert.ok(resolved.ok, JSON.stringify(resolved));
  const imported = emitted.value.managedImports.find(
    (item) => item.role === "signature",
  );
  assert.ok(imported);
  assert.equal(imported.witness, 0);
  assert.equal(
    pointer(resolved.value.code, imported.offset),
    bindings[1]!.address,
  );
});
