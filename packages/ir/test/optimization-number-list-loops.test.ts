import assert from "node:assert/strict";
import { test } from "node:test";
import { verify, type FunctionIR, type ModuleIR } from "@tint/ir/scalar";
import { hoistNumberListLoops } from "@tint/ir/optimization";

const span = { start: 0, end: 0 };

function numberListModule(options: {
  readonly mutateInLoop?: boolean;
  readonly readAfterStep?: boolean;
}): ModuleIR {
  const records = [
    {
      byteLength: 40,
      fields: [
        { offset: 16, type: "number" as const, mutable: true },
        { offset: 24, type: "optional-reference" as const, mutable: true },
        { offset: 32, type: "optional-reference" as const, mutable: true },
      ],
    },
  ];
  const lengthFn: FunctionIR = {
    id: 0,
    name: "lengthNumberList",
    exported: false,
    parameters: [0],
    slots: ["reference", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
        terminator: {
          kind: "record",
          object: 0,
          record: 0,
          field: 0,
          operation: "read",
          slot: 1,
          consequent: 1,
          alternate: 2,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 1, slot: 1, ...span }],
        terminator: { kind: "return", value: 1, ...span },
      },
      { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
    ],
  };
  const readFn: FunctionIR = {
    id: 1,
    name: "readNumberList",
    exported: false,
    parameters: [0, 1],
    slots: [
      "reference",
      "number",
      "optional-reference",
      "optional-reference",
      "number",
      "optional-number",
    ],
    returnType: "optional-number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "load", id: 0, slot: 0, ...span }],
        terminator: {
          kind: "record",
          object: 0,
          record: 0,
          field: 2,
          operation: "read",
          slot: 2,
          consequent: 1,
          alternate: 8,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 1, slot: 0, ...span }],
        terminator: {
          kind: "record",
          object: 1,
          record: 0,
          field: 1,
          operation: "read",
          slot: 3,
          consequent: 2,
          alternate: 8,
          ...span,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 2, slot: 2, ...span },
          { kind: "reference-none", id: 3, ...span },
          {
            kind: "binary",
            id: 4,
            operator: "===",
            left: 2,
            right: 3,
            ...span,
          },
        ],
        terminator: {
          kind: "branch",
          condition: 4,
          consequent: 3,
          alternate: 7,
          ...span,
        },
      },
      {
        id: 3,
        instructions: [{ kind: "load", id: 5, slot: 0, ...span }],
        terminator: {
          kind: "record",
          object: 5,
          record: 0,
          field: 0,
          operation: "read",
          slot: 4,
          consequent: 4,
          alternate: 8,
          ...span,
        },
      },
      {
        id: 4,
        instructions: [
          { kind: "load", id: 6, slot: 1, ...span },
          { kind: "load", id: 7, slot: 4, ...span },
          { kind: "binary", id: 8, operator: "<", left: 6, right: 7, ...span },
        ],
        terminator: {
          kind: "branch",
          condition: 8,
          consequent: 5,
          alternate: 7,
          ...span,
        },
      },
      {
        id: 5,
        instructions: [
          { kind: "load", id: 9, slot: 3, ...span },
          { kind: "reference-none", id: 10, ...span },
          {
            kind: "binary",
            id: 11,
            operator: "!==",
            left: 9,
            right: 10,
            ...span,
          },
        ],
        terminator: {
          kind: "branch",
          condition: 11,
          consequent: 6,
          alternate: 7,
          ...span,
        },
      },
      {
        id: 6,
        instructions: [
          { kind: "load", id: 12, slot: 3, ...span },
          {
            kind: "reference-value",
            id: 13,
            value: 12,
            type: "Float64Array",
            ...span,
          },
          { kind: "load", id: 14, slot: 1, ...span },
          { kind: "array-read", id: 15, array: 13, index: 14, ...span },
        ],
        terminator: { kind: "return", value: 15, ...span },
      },
      {
        id: 7,
        instructions: [{ kind: "undefined", id: 16, ...span }],
        terminator: { kind: "return", value: 16, ...span },
      },
      { id: 8, instructions: [], terminator: { kind: "trap", ...span } },
    ],
  };
  const mutateFn: FunctionIR = {
    id: 2,
    name: "mutateNumberList",
    exported: false,
    parameters: [0],
    slots: ["reference", "number"],
    returnType: "void",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...span },
          { kind: "store", slot: 1, value: 0, ...span },
          { kind: "load", id: 1, slot: 0, ...span },
        ],
        terminator: {
          kind: "record",
          object: 1,
          record: 0,
          field: 0,
          operation: "write",
          slot: 1,
          consequent: 1,
          alternate: 2,
          ...span,
        },
      },
      {
        id: 1,
        instructions: [],
        terminator: { kind: "return", value: undefined, ...span },
      },
      { id: 2, instructions: [], terminator: { kind: "trap", ...span } },
    ],
  };

  // sum(list): for (let i = 0; i < uint32(lengthNumberList(list)); i++) sum += readNumberList(list, i) ?? 0
  const bodyInstructions: FunctionIR["blocks"][number]["instructions"] =
    options.readAfterStep === true
      ? [
          { kind: "load", id: 10, slot: 1, ...span },
          { kind: "constant", id: 11, value: 1, ...span },
          {
            kind: "binary",
            id: 12,
            operator: "+",
            left: 10,
            right: 11,
            ...span,
          },
          { kind: "store", slot: 1, value: 12, ...span },
          { kind: "load", id: 13, slot: 0, ...span },
          { kind: "load", id: 14, slot: 1, ...span },
          { kind: "call", id: 15, target: 1, arguments: [13, 14], ...span },
          { kind: "constant", id: 16, value: 0, ...span },
          {
            kind: "optional-value-or",
            id: 17,
            value: 15,
            fallback: 16,
            ...span,
          },
          { kind: "load", id: 18, slot: 2, ...span },
          {
            kind: "binary",
            id: 19,
            operator: "+",
            left: 18,
            right: 17,
            ...span,
          },
          { kind: "store", slot: 2, value: 19, ...span },
        ]
      : [
          { kind: "load", id: 10, slot: 0, ...span },
          { kind: "load", id: 11, slot: 1, ...span },
          { kind: "call", id: 12, target: 1, arguments: [10, 11], ...span },
          ...(options.mutateInLoop === true
            ? [
                {
                  kind: "call" as const,
                  id: undefined,
                  target: 2,
                  arguments: [10],
                  ...span,
                },
              ]
            : []),
          { kind: "constant", id: 13, value: 0, ...span },
          {
            kind: "optional-value-or",
            id: 14,
            value: 12,
            fallback: 13,
            ...span,
          },
          { kind: "load", id: 15, slot: 2, ...span },
          {
            kind: "binary",
            id: 16,
            operator: "+",
            left: 15,
            right: 14,
            ...span,
          },
          { kind: "store", slot: 2, value: 16, ...span },
          { kind: "constant", id: 17, value: 1, ...span },
          {
            kind: "binary",
            id: 18,
            operator: "+",
            left: 11,
            right: 17,
            ...span,
          },
          { kind: "store", slot: 1, value: 18, ...span },
        ];

  const sumFn: FunctionIR = {
    id: 3,
    name: "sum",
    exported: true,
    parameters: [0],
    slots: ["reference", "number", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 0, ...span },
          { kind: "store", slot: 1, value: 0, ...span },
          { kind: "store", slot: 2, value: 0, ...span },
        ],
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 1,
        instructions: [
          { kind: "load", id: 1, slot: 0, ...span },
          { kind: "call", id: 2, target: 0, arguments: [1], ...span },
          { kind: "unary", id: 3, operator: "uint32", operand: 2, ...span },
          { kind: "load", id: 4, slot: 1, ...span },
          { kind: "binary", id: 5, operator: "<", left: 4, right: 3, ...span },
        ],
        terminator: {
          kind: "branch",
          condition: 5,
          consequent: 2,
          alternate: 3,
          ...span,
        },
      },
      {
        id: 2,
        instructions: bodyInstructions,
        terminator: { kind: "jump", target: 1, ...span },
      },
      {
        id: 3,
        instructions: [{ kind: "load", id: 20, slot: 2, ...span }],
        terminator: { kind: "return", value: 20, ...span },
      },
    ],
  };

  return { records, functions: [lengthFn, readFn, mutateFn, sumFn] };
}

test("hoistNumberListLoops versions read-only counted NumberList loops with unchecked Float64Array reads", () => {
  const module = numberListModule({});
  assert.ok(verify(module).ok, JSON.stringify(verify(module)));
  const result = hoistNumberListLoops(module, 1000000);
  assert.ok(result);
  assert.equal(result.rewritten, 1);
  assert.ok(verify(result.module).ok, JSON.stringify(verify(result.module)));
  const sumFn = result.module.functions[3]!;
  const ops = sumFn.blocks.flatMap((b) => b.instructions.map((op) => op.kind));
  assert.ok(ops.includes("array-element"));
  // The hot loop header no longer calls lengthNumberList (only the cold copy keeps it).
  const headerCalls = sumFn.blocks[1]!.instructions.filter(
    (op) => op.kind === "call",
  );
  assert.equal(headerCalls.length, 0);
});

test("hoistNumberListLoops declines loops that may mutate the NumberList header or read after stepping", () => {
  for (const options of [{ mutateInLoop: true }, { readAfterStep: true }]) {
    const module = numberListModule(options);
    assert.ok(verify(module).ok, JSON.stringify(verify(module)));
    const result = hoistNumberListLoops(module, 1000000);
    assert.ok(result);
    assert.equal(result.rewritten, 0);
  }
});
