import assert from "node:assert/strict";
import test from "node:test";
import { verify, type FunctionIR, type ModuleIR } from "@tint/ir/scalar";
import { buildReferenceListAccessors } from "../src/optimization/reference-list-access.ts";
import { buildReferenceListWrite } from "../src/optimization/reference-list-write.ts";
import { bulkListCopies } from "../src/optimization/bulk-list-copies.ts";
const s = { start: 0, end: 0 };

function fallback(
  id: number,
  name: string,
  parameters: readonly ("reference" | "number" | "optional-reference")[],
  returnType: "reference" | "optional-reference" | "boolean" | "void",
): FunctionIR {
  return {
    id,
    name,
    exported: false,
    parameters: parameters.map((_, index) => index),
    slots: parameters.slice(),
    returnType,
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions:
          returnType === "optional-reference"
            ? [{ kind: "reference-none", id: 0, ...s }]
            : returnType === "boolean"
              ? [{ kind: "constant", id: 0, value: false, ...s }]
              : returnType === "reference"
                ? [
                    { kind: "constant", id: 1, value: 0, ...s },
                    { kind: "reference-none", id: 2, ...s },
                    {
                      kind: "record-new",
                      id: 0,
                      record: 0,
                      arguments: [1, 2],
                      ...s,
                    },
                  ]
                : [],
        terminator: {
          kind: "return",
          value: returnType === "void" ? undefined : 0,
          ...s,
        },
      },
    ],
  };
}

/** `slice`'s lowered copy loop over lists with the generated helpers:
 * while (i < count) { if (has(src, i)) write(dst, i, read(src, i)); i++ }. */
function copier(
  id: number,
  has: number,
  read: number,
  write: number,
): FunctionIR {
  return {
    id,
    name: "copy",
    exported: true,
    parameters: [0, 1, 2],
    slots: ["reference", "reference", "number", "number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...s },
          { kind: "store", slot: 3, value: 0, ...s },
          { kind: "constant", id: 1, value: 1, ...s },
          { kind: "store", slot: 4, value: 1, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 2, slot: 3, ...s },
          { kind: "load", id: 3, slot: 2, ...s },
          { kind: "binary", id: 4, operator: "<", left: 2, right: 3, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 4,
          consequent: 2,
          alternate: 5,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 5, slot: 0, ...s },
          { kind: "load", id: 6, slot: 3, ...s },
          { kind: "call", id: 7, target: has, arguments: [5, 6], ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 7,
          consequent: 3,
          alternate: 4,
          ...s,
        },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 8, slot: 0, ...s },
          { kind: "load", id: 9, slot: 1, ...s },
          { kind: "load", id: 10, slot: 3, ...s },
          { kind: "call", id: 11, target: read, arguments: [8, 10], ...s },
          {
            kind: "call",
            id: undefined,
            target: write,
            arguments: [9, 10, 11],
            ...s,
          },
        ],
        terminator: { kind: "jump", target: 4, ...s },
      },
      {
        id: 4,
        instructions: [
          { kind: "load", id: 12, slot: 3, ...s },
          { kind: "load", id: 13, slot: 4, ...s },
          { kind: "binary", id: 14, operator: "+", left: 12, right: 13, ...s },
          { kind: "store", slot: 3, value: 14, ...s },
        ],
        terminator: { kind: "jump", target: 1, ...s },
      },
      {
        id: 5,
        instructions: [{ kind: "constant", id: 15, value: 0, ...s }],
        terminator: { kind: "return", value: 15, ...s },
      },
    ],
  };
}

function module(direct: boolean): ModuleIR {
  const base: ModuleIR = {
    records: [
      {
        byteLength: 24,
        fields: [
          { offset: 8, type: "number", mutable: true },
          { offset: 16, type: "optional-reference", mutable: true },
        ],
      },
      {
        byteLength: 16,
        fields: [{ offset: 8, type: "optional-reference", mutable: true }],
      },
    ],
    functions: [
      fallback(0, "create", ["number"], "reference"),
      fallback(
        1,
        "write",
        ["reference", "number", "optional-reference"],
        "void",
      ),
      fallback(2, "read", ["reference", "number"], "optional-reference"),
      fallback(3, "has", ["reference", "number"], "boolean"),
      fallback(4, "delete", ["reference", "number"], "boolean"),
    ],
  };
  const accessors = buildReferenceListAccessors(
    base,
    0,
    1,
    { read: 2, has: 3, delete: 4 },
    direct,
  );
  assert.ok(accessors);
  const withAccessors: ModuleIR = {
    ...base,
    functions: [...base.functions, ...accessors.functions],
  };
  const write = buildReferenceListWrite(withAccessors, 0, 1, 0, 1, direct);
  assert.ok(write);
  const functions = [...withAccessors.functions, write];
  functions.push(
    copier(functions.length, accessors.has, accessors.read, write.id),
  );
  return { ...withAccessors, functions };
}

test("slice copy loops over direct-reference lists get a bulk vector copy", () => {
  const input = module(true);
  assert.deepEqual(verify(input), { ok: true });
  const result = bulkListCopies(input, 1000000);
  assert.ok(result);
  assert.equal(result.rewritten, 1);
  assert.deepEqual(verify(result.module), { ok: true });
  const copy = result.module.functions[result.module.functions.length - 1]!;
  const operations = copy.blocks.flatMap((b) => b.instructions);
  assert.ok(
    operations.some((op) => op.kind === "reference-vector-copy" && op.rebase),
  );
  // The fast path allocates the fresh destination's vector itself.
  assert.ok(operations.some((op) => op.kind === "reference-vector-new"));
  // The original loop stays as the fallback.
  assert.ok(operations.some((op) => op.kind === "call"));
});

test("cell-boxed list writers keep the element-wise loop", () => {
  const input = module(false);
  assert.deepEqual(verify(input), { ok: true });
  const result = bulkListCopies(input, 1000000);
  assert.ok(result);
  assert.equal(result.rewritten, 0);
  assert.equal(bulkListCopies(input, 0), undefined);
});
