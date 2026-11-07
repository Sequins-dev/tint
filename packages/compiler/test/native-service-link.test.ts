import { test } from "node:test";
import assert from "node:assert/strict";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import { encode, relativeAddress } from "@tint/codegen/aarch64/isa";
import type { ModuleIR, FunctionIR } from "@tint/ir/scalar";
import * as compiler from "../src/native/index.ts";
const span = { start: 0, end: 0 };
function fixture(imported: boolean) {
  const first: FunctionIR = {
    id: 0,
    name: "identity",
    exported: false,
    parameters: [0],
    slots: ["number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
        terminator: { kind: "return", value: 0, ...span },
      },
    ],
  };
  const module: ModuleIR = {
    functions: [
      imported ? { ...first, import: true, blocks: [] } : first,
      {
        ...first,
        id: 1,
        name: "execute",
        exported: true,
        parameters: [],
        slots: [],
        blocks: [
          {
            id: 0,
            instructions: imported
              ? [
                  { kind: "constant", id: 0, value: 42, ...span },
                  { kind: "call", id: 1, target: 0, arguments: [0], ...span },
                ]
              : [
                  {
                    kind: "function-address",
                    id: 0,
                    target: 0,
                    part: "signature",
                    ...span,
                  },
                  { kind: "constant", id: 1, value: 42, ...span },
                ],
            terminator: { kind: "return", value: 1, ...span },
          },
        ],
      },
    ],
  };
  const result = emitModule(
    module,
    imported
      ? {
          managedABI: {
            version: 1,
            signatures: [],
            functions: [
              {
                function: 0,
                name: "hostIdentity",
                contract: "service.identity.v1",
                parameters: ["number"],
                returnType: "number",
              },
            ],
          },
        }
      : {},
  );
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
test("service composition resolves managed imports with relative addresses and retains native metadata", () => {
  assert.equal(typeof compiler.linkNativeServiceModules, "function");
  const host = fixture(false),
    unit = fixture(true),
    before = unit.code.slice(),
    signature = host.signatures[0]!;
  const binding = {
    name: "hostIdentity",
    contract: "service.identity.v1",
    role: "function-entry" as const,
    parameters: ["number" as const],
    returnType: "number" as const,
    metadataOffset: signature.offset,
    entryOffset: host.functions[0]!.offset,
  };
  const linked = compiler.linkNativeServiceModules(host, [
    { native: unit, bindings: [binding] },
  ]);
  assert.ok(linked.ok, JSON.stringify(linked));
  assert.deepEqual(unit.code, before);
  assert.equal(linked.value.native.linkage, "local");
  assert.equal(linked.value.native.managedImports.length, 0);
  assert.equal(
    linked.value.native.functions.length,
    host.functions.length + unit.functions.length,
  );
  const base = linked.value.offsets[0]!,
    view = new DataView(linked.value.native.code.buffer);
  for (const reference of unit.managedReferences!) {
    const sequence = relativeAddress(
      reference.rd,
      17,
      binding.entryOffset - base - reference.offset,
    );
    assert.ok(sequence.ok);
    for (let i = 0; i < 4; i++) {
      const op = encode(sequence.value[i]!);
      assert.ok(op.ok);
      assert.equal(
        view.getUint32(base + reference.offset + i * 4, true),
        op.value,
      );
    }
    const nop = encode({ op: "nop" });
    assert.ok(nop.ok);
    assert.equal(view.getUint32(base + reference.offset + 16, true), nop.value);
  }
});
test("service composition rejects later contracts and foreign metadata before copying bytes", () => {
  assert.equal(typeof compiler.linkNativeServiceModules, "function");
  const host = fixture(false),
    unit = fixture(true),
    before = host.code.slice(),
    signature = host.signatures[0]!;
  const binding = {
    name: "hostIdentity",
    contract: "service.identity.v1",
    role: "function-entry" as const,
    parameters: ["number" as const],
    returnType: "number" as const,
    metadataOffset: signature.offset,
    entryOffset: host.functions[0]!.offset,
  };
  for (const changed of [
    { ...binding, contract: "wrong" },
    { ...binding, metadataOffset: signature.offset + 8 },
    { ...binding, entryOffset: host.code.length + 4 },
    { ...binding, parameters: ["string" as const] },
  ]) {
    const result = compiler.linkNativeServiceModules(host, [
      { native: unit, bindings: [binding] },
      { native: unit, bindings: [changed] },
    ]);
    assert.equal(result.ok, false);
    assert.deepEqual(host.code, before);
  }
  const reference = unit.managedReferences![0]!;
  for (const changed of [
    { ...reference, offset: unit.code.length - 4 },
    { ...reference, rd: 31 },
    { ...reference, import: 99 },
  ]) {
    assert.equal(
      compiler.linkNativeServiceModules(host, [
        {
          native: { ...unit, managedReferences: [changed] },
          bindings: [binding],
        },
      ]).ok,
      false,
    );
  }
});

test("host calls a separately compiled unit through its checked export", () => {
  const host = fixture(true),
    unit = fixture(false),
    signature = unit.signatures[0]!;
  const binding = {
    unit: 0,
    name: "hostIdentity",
    contract: "service.identity.v1",
    role: "function-entry" as const,
    parameters: ["number" as const],
    returnType: "number" as const,
    metadataOffset: signature.offset,
    entryOffset: unit.functions[0]!.offset,
  };
  const linked = compiler.linkNativeServiceModules(
    host,
    [{ native: unit, bindings: [] }],
    [binding],
  );
  assert.ok(linked.ok, JSON.stringify(linked));
  assert.equal(linked.value.native.linkage, "local");
  const reference = host.managedReferences![0]!,
    sequence = relativeAddress(
      reference.rd,
      17,
      linked.value.offsets[0]! + binding.entryOffset - reference.offset,
    );
  assert.ok(sequence.ok);
  const view = new DataView(linked.value.native.code.buffer);
  for (let i = 0; i < 4; i++) {
    const instruction = encode(sequence.value[i]!);
    assert.ok(instruction.ok);
    assert.equal(
      view.getUint32(reference.offset + i * 4, true),
      instruction.value,
    );
  }
  assert.equal(
    compiler.linkNativeServiceModules(
      host,
      [{ native: unit, bindings: [] }],
      [{ ...binding, unit: 1 }],
    ).ok,
    false,
  );
});

test("service composition rejects a unit compiled without the host's generational barriers", () => {
  const host = { ...fixture(false), generationalBarriers: true },
    unit = fixture(false);
  assert.equal(
    compiler.linkNativeServiceModules(host, [{ native: unit, bindings: [] }])
      .ok,
    false,
  );
});
