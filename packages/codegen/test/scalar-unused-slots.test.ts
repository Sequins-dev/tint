import assert from "node:assert/strict";
import test from "node:test";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import type { FunctionIR, ModuleIR } from "@tint/ir/scalar";
const s = { start: 0, end: 0 };
const fn: FunctionIR = {
  id: 0,
  name: "parameter-after-unused-locals",
  exported: true,
  parameters: [2],
  slots: ["reference", "general", "number"],
  returnType: "number",
  entry: 0,
  blocks: [
    {
      id: 0,
      instructions: [{ kind: "load", id: 0, slot: 2, ...s }],
      terminator: { kind: "return", value: 0, ...s },
    },
  ],
};
test("unused managed declarations do not create native roots", () => {
  const r = emitModule({ functions: [fn] });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.value.roots.length, 0);
  assert.equal(r.value.functions[0]!.signature.parameters[0]!.kind, "float");
  assert.deepEqual(fn.parameters, [2]);
  assert.equal(fn.slots.length, 3);
});
test("unused reference ABI arguments remain roots in open code", () => {
  const r = emitModule({ functions: [{ ...fn, parameters: [2, 0] }] });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.value.functions[0]!.signature.parameters.length, 2);
  assert.equal(r.value.roots[0]!.offsets.length, 1);
  assert.equal(r.value.roots[0]!.generalOffsets.length, 0);
});
test("exception and guarded transfer destinations retain native storage", () => {
  const input: ModuleIR = {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: true }],
      },
    ],
    functions: [
      {
        ...fn,
        parameters: [0],
        slots: ["reference", "boolean", "number", "general", "reference"],
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
            exception: { target: 2, slot: 3 },
            terminator: {
              kind: "record",
              object: 0,
              record: 0,
              field: 0,
              operation: "read",
              slot: 2,
              consequent: 1,
              alternate: 2,
              ...s,
            },
          },
          {
            id: 1,
            instructions: [{ kind: "load", id: 1, slot: 2, ...s }],
            terminator: { kind: "return", value: 1, ...s },
          },
          { id: 2, instructions: [], terminator: { kind: "trap", ...s } },
        ],
      },
    ],
  };
  const r = emitModule(input);
  assert.ok(r.ok, JSON.stringify(r));
  // The parameter remains rooted; its load dies at the guarded read before any
  // safepoint. The exception destination retains its separate general root.
  assert.equal(r.value.roots[0]!.offsets.length, 1);
  assert.equal(r.value.roots[0]!.generalOffsets.length, 1);
});
test("invalid original slot uses retain native verification diagnostics", () => {
  const r = emitModule({ functions: [{ ...fn, slots: [] }] });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "INVALID_IR");
});
