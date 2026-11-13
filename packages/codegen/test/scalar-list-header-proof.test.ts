import assert from "node:assert/strict";
import test from "node:test";
import { emitModule } from "@tint/codegen/aarch64/scalar";
import { verify, type FunctionIR, type ModuleIR } from "@tint/ir/scalar";
const s = { start: 0, end: 0 };

/** A dense list read accessor in the shape emission inlines (see
 * listReadShape): the header's root vector at field 1, null for holes and
 * the vector itself for a stored undefined. */
function read(id: number): FunctionIR {
  return {
    id,
    name: `__tint_reference_list_read$${id}`,
    exported: false,
    parameters: [0, 1],
    slots: ["reference", "number", "optional-reference"],
    returnType: "optional-reference",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
        terminator: {
          kind: "record",
          object: 0,
          record: 0,
          field: 1,
          operation: "read",
          slot: 2,
          consequent: 1,
          alternate: 2,
          ...s,
        },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 1, slot: 2, ...s },
          { kind: "reference-vector-is", id: 3, vector: 1, ...s },
          { kind: "reference-value", id: 2, value: 1, ...s },
          { kind: "load", id: 4, slot: 1, ...s },
          { kind: "reference-vector-read", id: 5, vector: 2, index: 4, ...s },
          { kind: "binary", id: 6, operator: "===", left: 5, right: 1, ...s },
        ],
        terminator: { kind: "return", value: 5, ...s },
      },
      { id: 2, instructions: [], terminator: { kind: "trap", ...s } },
    ],
  };
}
/** main(list?) reads element 0 of a list it creates, or of its parameter. */
function main(parameter: boolean): FunctionIR {
  return {
    id: 0,
    name: "main",
    exported: true,
    parameters: parameter ? [0] : [],
    slots: ["reference"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          ...(parameter
            ? []
            : [
                { kind: "constant" as const, id: 10, value: 0, ...s },
                { kind: "reference-none" as const, id: 11, ...s },
                {
                  kind: "record-new" as const,
                  id: 12,
                  record: 0,
                  arguments: [10, 11],
                  ...s,
                },
                { kind: "store" as const, slot: 0, value: 12, ...s },
              ]),
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "constant", id: 1, value: 0, ...s },
          { kind: "call", id: 2, target: 1, arguments: [0, 1], ...s },
          { kind: "constant", id: 3, value: 7, ...s },
        ],
        terminator: { kind: "return", value: 3, ...s },
      },
    ],
  };
}
function module(parameter: boolean): ModuleIR {
  return {
    records: [
      {
        byteLength: 32,
        fields: [
          { offset: 16, type: "number", mutable: true },
          { offset: 24, type: "optional-reference", mutable: true },
        ],
      },
    ],
    functions: [main(parameter), read(1)],
  };
}
/** Words of `main`'s code: the inline read's null test (CBZ X9) and its
 * header class comparison (SUBS XZR, X10, X11). */
function guards(parameter: boolean): { nullTests: number; classTests: number } {
  const ir = module(parameter);
  assert.deepEqual(verify(ir), { ok: true });
  const emitted = emitModule(ir, {
    maxByteLength: 0xffffffff,
    debugSpans: false,
    linearAllocation: false,
    generationalBarriers: false,
    closedRoots: [0],
  });
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const fn = emitted.value.functions[0]!,
    view = new DataView(emitted.value.code.buffer);
  let nullTests = 0,
    classTests = 0;
  for (
    let offset = fn.offset;
    offset < fn.offset + fn.byteLength;
    offset += 4
  ) {
    const word = view.getUint32(offset, true);
    if ((word & 0xff00001f) >>> 0 === 0xb4000009) nullTests++;
    if (word === 0xeb0b015f) classTests++;
  }
  return { nullTests, classTests };
}

test("a list proven to be a non-null header reads without null or class tests", () => {
  assert.deepEqual(guards(false), { nullTests: 0, classTests: 0 });
});

test("an unproven list argument keeps the inline read's null and class tests", () => {
  assert.deepEqual(guards(true), { nullTests: 1, classTests: 1 });
});
