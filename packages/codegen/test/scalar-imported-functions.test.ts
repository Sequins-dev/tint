import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModuleIR } from "@tint/ir/scalar";
import { emitModule } from "../src/aarch64/scalar/index.ts";
test("bodyless imports require an explicit managed function-entry binding", () => {
  const module: ModuleIR = {
    functions: [
      {
        id: 0,
        name: "imported",
        import: true,
        exported: false,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [],
      },
    ],
  };
  const result = emitModule(module);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error.message, /function-entry/);
});
function importingModule(): ModuleIR {
  return {
    functions: [
      {
        id: 0,
        name: "helper",
        import: true,
        exported: false,
        parameters: [0],
        slots: ["number"],
        returnType: "number",
        entry: 0,
        blocks: [],
      },
      {
        id: 1,
        name: "run",
        exported: true,
        parameters: [],
        slots: [],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 42, start: 0, end: 0 },
              {
                kind: "call",
                id: 1,
                target: 0,
                arguments: [0],
                start: 0,
                end: 0,
              },
            ],
            terminator: { kind: "return", value: 1, start: 0, end: 0 },
          },
        ],
      },
    ],
  };
}
test("bound managed imports use pointer slots without local entry code or a function brand", () => {
  const result = emitModule(importingModule(), {
    closedRoots: [1],
    managedABI: {
      version: 1,
      signatures: [],
      functions: [
        {
          function: 0,
          name: "helper",
          contract: "test.helper.v1",
          parameters: ["number"],
          returnType: "number",
        },
      ],
    },
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.linkage, "unresolved-managed");
  assert.equal(result.value.functionDescriptor, undefined);
  assert.equal(result.value.functionDescriptorImport, undefined);
  assert.equal(result.value.functions[0]?.import, true);
  assert.equal(result.value.functions[0]?.byteLength, 0);
  assert.equal(result.value.functions[1]?.offset, 0);
  assert.ok(result.value.functions[1]!.byteLength > 0);
  assert.equal(result.value.managedImports.length, 1);
  const imported = result.value.managedImports[0]!;
  assert.equal(imported.role, "function-entry");
  assert.equal(imported.witness, 0);
  assert.deepEqual(imported.parameters, ["number"]);
  assert.deepEqual(
    [...result.value.code.subarray(imported.offset, imported.offset + 8)],
    new Array(8).fill(0),
  );
});
test("entry bindings require exact imported targets, ABIs and unique membership", () => {
  const base = {
    function: 0,
    name: "helper",
    contract: "test.helper.v1",
    parameters: ["number" as const],
    returnType: "number" as const,
  };
  for (const binding of [
    { ...base, function: 1 },
    { ...base, parameters: ["string" as const] },
    { ...base, returnType: "void" as const },
  ]) {
    const result = emitModule(importingModule(), {
      managedABI: { version: 1, signatures: [], functions: [binding] },
    });
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.match(result.error.message, /imported function|imported.*ABI/);
  }
  const duplicate = emitModule(importingModule(), {
    managedABI: {
      version: 1,
      signatures: [],
      functions: [base, { ...base, name: "second" }],
    },
  });
  assert.equal(duplicate.ok, false);
  const root = emitModule(importingModule(), {
    closedRoots: [0],
    managedABI: { version: 1, signatures: [], functions: [base] },
  });
  assert.equal(root.ok, false);
});
