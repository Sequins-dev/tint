import { test } from "node:test";
import assert from "node:assert/strict";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import type { ModuleIR, RecordLayout } from "@tint/ir/scalar";
import {
  resolveManagedPointers,
  type ManagedIdentityBinding,
} from "../src/native/managed-imports.ts";

const span = { start: 0, end: 0 };
function fixture(layout: RecordLayout): ModuleIR {
  return {
    records: [layout],
    functions: [
      {
        id: 0,
        name: "matches",
        exported: true,
        parameters: [0],
        slots: ["general"],
        returnType: "boolean",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...span },
              {
                kind: "general-record-is",
                id: 1,
                value: 0,
                record: 0,
                ...span,
              },
            ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
    ],
  };
}
const layout: RecordLayout = {
  byteLength: 64,
  fields: [
    { offset: 16, type: "reference", mutable: false },
    { offset: 24, type: "general", mutable: true },
    { offset: 40, type: "optional-number", mutable: true, presenceOffset: 56 },
  ],
};
function emit() {
  const result = emitModule(fixture(layout), {
    managedABI: {
      version: 1,
      functionBrand: { name: "function", contract: "tint.function.v1" },
      signatures: [],
      records: [{ witness: 0, name: "frame", contract: "tint.test-frame.v1" }],
    },
  });
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
const bindings: readonly ManagedIdentityBinding[] = [
  {
    domain: 17,
    role: "function-brand",
    name: "function",
    contract: "tint.function.v1",
    address: 4096,
    byteLength: 32,
    parameters: [],
    returnType: undefined,
  },
  {
    domain: 17,
    role: "record",
    name: "frame",
    contract: "tint.test-frame.v1",
    address: 8192,
    byteLength: 40,
    parameters: [],
    returnType: undefined,
    recordLayout: layout,
  },
];
function read(address: number, _length: number, offset: number): number {
  return (
    (address === 4096 ? [48, 1, 24, 0] : [64, 1, 16, 1, 24])[offset / 8] ?? -1
  );
}
test("managed record imports retain a complete layout and resolve a canonical descriptor", () => {
  const native = emit();
  const request = native.managedImports.find((item) => item.role === "record");
  assert.ok(request, "record descriptor must be an explicit imported identity");
  assert.deepEqual(request.recordLayout, layout);
  assert.notEqual(request.recordLayout, layout);
  assert.notEqual(request.recordLayout!.fields, layout.fields);
  const linked = resolveManagedPointers(native, bindings, read, 17);
  assert.ok(linked.ok, JSON.stringify(linked));
  assert.equal(linked.value.code[request.offset + 1], 32);
  assert.equal(native.code[request.offset + 1], 0);
});
test("managed record linking rejects equal GC layouts with different semantic field contracts", () => {
  const native = emit();
  for (const changed of [
    {
      ...layout,
      fields: layout.fields.map((field, i) =>
        i === 0 ? { ...field, mutable: true } : field,
      ),
    },
    {
      ...layout,
      fields: layout.fields.map((field, i) =>
        i === 0 ? { ...field, type: "string" as const } : field,
      ),
    },
    {
      ...layout,
      fields: layout.fields.map((field, i) =>
        i === 2 ? { ...field, presenceOffset: 57 } : field,
      ),
    },
  ]) {
    const linked = resolveManagedPointers(
      native,
      [bindings[0]!, { ...bindings[1]!, recordLayout: changed }],
      read,
      17,
    );
    assert.equal(linked.ok, false, JSON.stringify(changed));
  }
  assert.equal(
    resolveManagedPointers(
      native,
      [bindings[0]!, { ...bindings[1]!, contract: "tint.other-frame.v1" }],
      read,
      17,
    ).ok,
    false,
  );
  assert.equal(
    resolveManagedPointers(
      native,
      bindings,
      (address, length, offset) =>
        address === 8192 && offset === 32 ? 40 : read(address, length, offset),
      17,
    ).ok,
    false,
  );
});
test("managed record imports reject missing, duplicate and non-record witnesses", () => {
  for (const records of [
    [{ witness: 1, name: "frame", contract: "tint.test-frame.v1" }],
    [
      { witness: 0, name: "frame", contract: "tint.test-frame.v1" },
      { witness: 0, name: "other", contract: "tint.other.v1" },
    ],
  ]) {
    const result = emitModule(fixture(layout), {
      managedABI: {
        version: 1,
        functionBrand: { name: "function", contract: "tint.function.v1" },
        signatures: [],
        records,
      },
    });
    assert.equal(result.ok, false);
  }
});

test("malformed imported record views are rejected before external metadata reads", () => {
  const native = emit();
  const request = native.managedImports.find((item) => item.role === "record");
  assert.ok(request);
  for (const changed of [
    { ...request, witness: undefined },
    { ...request, witness: -1 },
    { ...request, witness: Number.NaN },
    { ...request, parameters: ["general"] as const },
    { ...request, returnType: "general" as const },
    { ...request, recordLayout: undefined },
    { ...request, recordLayout: { ...layout, byteLength: 63 } },
    {
      ...request,
      recordLayout: {
        ...layout,
        fields: [...layout.fields, layout.fields[0]!],
      },
    },
  ]) {
    let reads = 0;
    const linked = resolveManagedPointers(
      {
        ...native,
        managedImports: native.managedImports.map((item) =>
          item === request ? changed : item,
        ),
      },
      bindings,
      () => {
        reads++;
        return -1;
      },
      17,
    );
    assert.equal(linked.ok, false);
    assert.equal(reads, 0);
  }
});
