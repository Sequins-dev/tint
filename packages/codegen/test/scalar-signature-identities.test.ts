import { test } from "node:test";
import { addressesTarget } from "./address-forms.ts";
import assert from "node:assert/strict";
import type { FunctionIR, ModuleIR, ScalarType } from "@tint/ir/scalar";
import { encode, relativeAddress } from "@tint/codegen/aarch64/isa";
import { emitModule } from "../src/aarch64/scalar/index.ts";
const span = { start: 0, end: 0 };
function identity(
  id: number,
  parameters: ScalarType[],
  result: ScalarType | "void",
): FunctionIR {
  return {
    id,
    name: "f" + id,
    exported: false,
    parameters: parameters.map((_, i) => i),
    slots: parameters,
    returnType: result,
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions:
          result === "void" ? [] : [{ kind: "load", id: 0, slot: 0, ...span }],
        terminator: {
          kind: "return",
          value: result === "void" ? undefined : 0,
          ...span,
        },
      },
    ],
  };
}
function fixture(): ModuleIR {
  const targets = [1, 2, 3, 4, 5, 7, 8];
  return {
    functions: [
      {
        id: 0,
        name: "entry",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              ...targets.map((target, id) => ({
                kind: "function-new" as const,
                id,
                target,
                ...span,
              })),
              { kind: "constant", id: 7, value: 42, ...span },
              {
                kind: "call-indirect",
                id: 8,
                target: 2,
                callee: 0,
                arguments: [7],
                ...span,
              },
            ],
            terminator: { kind: "return", value: 8, ...span },
          },
        ],
      },
      identity(1, ["number"], "number"),
      identity(2, ["number"], "number"),
      identity(3, ["reference"], "reference"),
      identity(4, ["string"], "string"),
      identity(5, ["number"], "void"),
      identity(6, ["boolean"], "boolean"),
      identity(7, ["string", "reference"], "void"),
      identity(8, ["reference", "string"], "void"),
    ],
  };
}
function word(instruction: Parameters<typeof encode>[0]): number {
  const result = encode(instruction);
  assert.ok(result.ok);
  return result.value;
}
function matches(
  view: DataView,
  offset: number,
  rd: number,
  target: number,
): boolean {
  return addressesTarget(view, offset, rd, target);
}
test("referenced local function signatures have versioned typed descriptors and equivalent witnesses share identity", () => {
  const result = emitModule(fixture());
  assert.ok(result.ok, JSON.stringify(result));
  const native = result.value;
  assert.equal(native.signatures.length, 6);
  assert.deepEqual(
    native.signatures.map((signature) => signature.functions),
    [[1, 2], [3], [4], [5], [7], [8]],
  );
  assert.deepEqual(
    native.signatures.map((s) => [s.parameters, s.returnType]),
    [
      [["number"], "number"],
      [["reference"], "reference"],
      [["string"], "string"],
      [["number"], "void"],
      [["string", "reference"], "void"],
      [["reference", "string"], "void"],
    ],
  );
  const view = new DataView(
    native.code.buffer,
    native.code.byteOffset,
    native.code.byteLength,
  );
  const codes = new Map<string, bigint>([
    ["void", 0n],
    ["number", 8n],
    ["reference", 5n],
    ["string", 4n],
  ]);
  for (const signature of native.signatures) {
    assert.equal(signature.version, 1);
    assert.equal(
      view.getBigUint64(signature.offset + 24, true),
      codes.get(signature.returnType),
    );
    for (const [index, type] of signature.parameters.entries())
      assert.equal(
        view.getBigUint64(signature.offset + 32 + index * 8, true),
        codes.get(type),
      );
    assert.equal(signature.offset % 8, 0);
    assert.equal(signature.byteLength, 32 + signature.parameters.length * 8);
    assert.equal(view.getBigUint64(signature.offset, true), 1n);
    assert.equal(
      view.getBigUint64(signature.offset + 8, true),
      BigInt(signature.byteLength),
    );
    assert.equal(
      view.getBigUint64(signature.offset + 16, true),
      BigInt(signature.parameters.length),
    );
  }
  assert.deepEqual(native.records.at(-1)?.referenceOffsets, [24]);
  assert.deepEqual(native.records.at(-1)?.generalOffsets, []);
});
test("function creation and indirect guards address the same permanent signature descriptor", () => {
  const result = emitModule(fixture());
  assert.ok(result.ok, JSON.stringify(result));
  const native = result.value,
    descriptor = native.signatures[0]!;
  const view = new DataView(
    native.code.buffer,
    native.code.byteOffset,
    native.code.byteLength,
  );
  const entry = native.functions[0]!;
  let stores = 0,
    guards = 0;
  for (
    let offset = entry.offset;
    offset < entry.offset + entry.byteLength;
    offset += 4
  ) {
    if (
      view.getUint32(offset, true) ===
        word({ op: "str", width: 64, rt: 10, rn: 9, offset: 32 }) &&
      (matches(view, offset - 16, 10, descriptor.offset) ||
        matches(view, offset - 4, 10, descriptor.offset))
    )
      stores++;
    if (
      view.getUint32(offset, true) ===
        word({ op: "ldr", width: 64, rt: 10, rn: 12, offset: 32 }) &&
      matches(view, offset + 4, 11, descriptor.offset)
    )
      guards++;
  }
  assert.equal(stores, 2);
  assert.equal(guards, 1);
});
test("unreferenced signatures add no descriptor pool or code budget", () => {
  const module: ModuleIR = { functions: [identity(0, ["number"], "number")] };
  const result = emitModule(module);
  assert.ok(result.ok);
  assert.deepEqual(result.value.signatures, []);
  assert.ok(emitModule(module, { maxByteLength: result.value.code.length }).ok);
});
test("signature pool alignment and payload obey exact emission budgets", () => {
  const module = fixture(),
    result = emitModule(module);
  assert.ok(result.ok);
  const length = result.value.code.length;
  assert.ok(emitModule(module, { maxByteLength: length }).ok);
  const short = emitModule(module, { maxByteLength: length - 1 });
  assert.equal(short.ok, false);
  if (!short.ok) {
    assert.equal(short.error.code, "CODE_LIMIT");
    assert.match(
      short.error.message,
      /signature descriptors|stack map table|aligned literal pool/,
    );
  }
  // Signatures are the last pool before the safepoint table, which ends
  // the module.
  const last = result.value.signatures.at(-1)!,
    table = result.value.stackMaps[0]!;
  assert.equal(last.offset + last.byteLength, table.tableOffset);
  assert.equal(table.tableOffset + table.byteLength, length);
});

test("indirect-only witnesses still have a local signature identity", () => {
  const target = identity(1, ["number"], "number");
  const module: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "caller",
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
              { kind: "constant", id: 1, value: 42, ...span },
              {
                kind: "call-indirect",
                id: 2,
                target: 1,
                callee: 0,
                arguments: [1],
                ...span,
              },
            ],
            terminator: { kind: "return", value: 2, ...span },
          },
        ],
      },
      target,
    ],
  };
  const result = emitModule(module);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.signatures.length, 1);
  assert.deepEqual(result.value.signatures[0]!.parameters, ["number"]);
});

test("version-one scalar codes preserve every optional and managed representation", () => {
  const types: ScalarType[] = [
    "general",
    "optional-boolean",
    "primitive",
    "string",
    "reference",
    "optional-reference",
    "optional-string",
    "number",
    "boolean",
    "Uint8Array",
    "Uint16Array",
    "Uint32Array",
    "Float64Array",
    "optional-number",
  ];
  const module: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "allocate",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "void",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: types.map((_, index) => ({
              kind: "function-new",
              id: index,
              target: index + 1,
              ...span,
            })),
            terminator: { kind: "return", value: undefined, ...span },
          },
        ],
      },
      ...types.map((type, index) => identity(index + 1, [type], type)),
    ],
  };
  const emitted = emitModule(module);
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const native = emitted.value,
    view = new DataView(
      native.code.buffer,
      native.code.byteOffset,
      native.code.byteLength,
    );
  assert.equal(native.signatures.length, types.length);
  for (const [index, signature] of native.signatures.entries()) {
    assert.deepEqual(signature.parameters, [types[index]]);
    assert.equal(signature.returnType, types[index]);
    assert.equal(
      view.getBigUint64(signature.offset + 24, true),
      BigInt(index + 1),
    );
    assert.equal(
      view.getBigUint64(signature.offset + 32, true),
      BigInt(index + 1),
    );
  }
});

test("explicit local semantic groups keep equal physical signatures distinct", () => {
  const source = fixture();
  const emitted = emitModule(source, {
    localSignatures: [
      { name: "left", contract: "test.left.v1", functions: [1] },
      { name: "right", contract: "test.right.v1", functions: [2] },
    ],
  });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const left = emitted.value.signatures.find((item) =>
    item.functions.includes(1),
  );
  const right = emitted.value.signatures.find((item) =>
    item.functions.includes(2),
  );
  assert.ok(left && right);
  assert.notEqual(left.offset, right.offset);
  assert.deepEqual(left.identity, { name: "left", contract: "test.left.v1" });
  assert.deepEqual(right.identity, {
    name: "right",
    contract: "test.right.v1",
  });
  const view = new DataView(
    emitted.value.code.buffer,
    emitted.value.code.byteOffset,
    emitted.value.code.byteLength,
  );
  const entry = emitted.value.functions[0];
  assert.ok(entry);
  const patched = (rd: number, target: number): boolean => {
    for (
      let offset = entry.offset;
      offset < entry.offset + entry.byteLength;
      offset += 4
    )
      if (matches(view, offset, rd, target)) return true;
    return false;
  };
  assert.ok(
    patched(10, left.offset),
    "first function value uses its group identity",
  );
  assert.ok(
    patched(10, right.offset),
    "second function value uses its group identity",
  );
  assert.ok(
    patched(11, right.offset),
    "indirect call guard uses the requested witness group",
  );
  assert.deepEqual(left.parameters, right.parameters);
  assert.equal(left.returnType, right.returnType);
  const ordinary = emitModule(source),
    empty = emitModule(source, { localSignatures: [] });
  assert.ok(ordinary.ok && empty.ok);
  assert.deepEqual(empty.value.code, ordinary.value.code);
});

test("local signature groups require unique explicit members and exact physical signatures", () => {
  for (const groups of [
    [{ name: "empty", contract: "test.v1", functions: [] }],
    [{ name: "bad", contract: "test.v1", functions: [99] }],
    [{ name: "bad", contract: "test.v1", functions: [1, 1] }],
    [{ name: "bad", contract: "test.v1", functions: [1, 3] }],
    [
      { name: "a", contract: "a.v1", functions: [1] },
      { name: "a", contract: "b.v1", functions: [2] },
    ],
    [
      { name: "a", contract: "a.v1", functions: [1] },
      { name: "b", contract: "a.v1", functions: [2] },
    ],
    [
      { name: "a", contract: "a.v1", functions: [1] },
      { name: "b", contract: "b.v1", functions: [1] },
    ],
  ])
    assert.equal(
      emitModule(fixture(), { localSignatures: groups }).ok,
      false,
      JSON.stringify(groups),
    );
});
