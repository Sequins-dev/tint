import type { ModuleIR, FunctionIR } from "@tint/ir/scalar";
const s = { start: 0, end: 0 };
/** A returned counter closes over a shared, managed cell and outlives its factory. */
export function ownedClosureFixture(): ModuleIR {
  const counter: FunctionIR = {
    id: 0,
    name: "counter",
    exported: false,
    closureEnvironment: 1,
    parameters: [0],
    slots: ["number", "reference", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [{ kind: "closure-environment", id: 0, ...s }],
        terminator: {
          kind: "record",
          object: 0,
          record: 1,
          field: 0,
          operation: "read",
          slot: 1,
          consequent: 1,
          alternate: 4,
          ...s,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 1, slot: 1, ...s }],
        terminator: {
          kind: "record-cell",
          object: 1,
          record: 0,
          field: 0,
          operation: "read",
          slot: 2,
          consequent: 2,
          alternate: 4,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 2, slot: 2, ...s },
          { kind: "load", id: 3, slot: 0, ...s },
          { kind: "binary", id: 4, operator: "+", left: 2, right: 3, ...s },
          { kind: "store", slot: 2, value: 4, ...s },
          { kind: "load", id: 5, slot: 1, ...s },
        ],
        terminator: {
          kind: "record-cell",
          object: 5,
          record: 0,
          field: 0,
          operation: "write",
          slot: 2,
          consequent: 3,
          alternate: 4,
          ...s,
        },
      },
      {
        id: 3,
        instructions: [{ kind: "load", id: 6, slot: 2, ...s }],
        terminator: { kind: "return", value: 6, ...s },
      },
      { id: 4, instructions: [], terminator: { kind: "trap", ...s } },
    ],
  };
  const factory: FunctionIR = {
    id: 1,
    name: "factory",
    exported: false,
    parameters: [0],
    slots: ["number"],
    returnType: "reference",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "record-new", id: 1, record: 0, arguments: [0], ...s },
          { kind: "record-new", id: 2, record: 1, arguments: [1], ...s },
          { kind: "function-new", id: 3, target: 0, environment: 2, ...s },
        ],
        terminator: { kind: "return", value: 3, ...s },
      },
    ],
  };
  const run: FunctionIR = {
    id: 2,
    name: "run",
    exported: true,
    parameters: [0],
    slots: ["number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 7, ...s },
          { kind: "call", id: 1, target: 1, arguments: [0], ...s },
          { kind: "constant", id: 2, value: 3, ...s },
          {
            kind: "call-indirect",
            id: 3,
            target: 0,
            callee: 1,
            arguments: [2],
            ...s,
          },
          { kind: "constant", id: 4, value: 2, ...s },
          {
            kind: "call-indirect",
            id: 5,
            target: 0,
            callee: 1,
            arguments: [4],
            ...s,
          },
          { kind: "constant", id: 6, value: 100, ...s },
          { kind: "call", id: 7, target: 1, arguments: [6], ...s },
          { kind: "constant", id: 8, value: 5, ...s },
          {
            kind: "call-indirect",
            id: 9,
            target: 0,
            callee: 7,
            arguments: [8],
            ...s,
          },
          { kind: "constant", id: 10, value: 0, ...s },
          {
            kind: "call-indirect",
            id: 11,
            target: 0,
            callee: 1,
            arguments: [10],
            ...s,
          },
          { kind: "binary", id: 12, operator: "+", left: 3, right: 5, ...s },
          { kind: "binary", id: 13, operator: "+", left: 12, right: 9, ...s },
          { kind: "binary", id: 14, operator: "+", left: 13, right: 11, ...s },
        ],
        terminator: { kind: "return", value: 14, ...s },
      },
    ],
  };
  return {
    records: [
      {
        byteLength: 32,
        fields: [
          { offset: 24, stateOffset: 16, type: "number", mutable: true },
        ],
      },
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "reference", mutable: false }],
      },
    ],
    functions: [counter, factory, run],
  };
}

export function ownedClosureSiblingsFixture(): ModuleIR {
  const base = ownedClosureFixture(),
    counter = base.functions[0]!;
  const factory: FunctionIR = {
    id: 2,
    name: "factory",
    exported: false,
    parameters: [0],
    slots: ["number"],
    returnType: "reference",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "load", id: 0, slot: 0, ...s },
          { kind: "record-new", id: 1, record: 0, arguments: [0], ...s },
          { kind: "record-new", id: 2, record: 1, arguments: [1], ...s },
          { kind: "function-new", id: 3, target: 0, environment: 2, ...s },
          { kind: "function-new", id: 4, target: 1, environment: 2, ...s },
          { kind: "record-new", id: 5, record: 2, arguments: [3, 4], ...s },
        ],
        terminator: { kind: "return", value: 5, ...s },
      },
    ],
  };
  const run: FunctionIR = {
    id: 3,
    name: "run",
    exported: true,
    parameters: [0],
    slots: ["number", "reference", "reference", "reference", "number"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          { kind: "constant", id: 0, value: 7, ...s },
          { kind: "call", id: 1, target: 2, arguments: [0], ...s },
          { kind: "store", slot: 3, value: 1, ...s },
        ],
        terminator: {
          kind: "record",
          object: 1,
          record: 2,
          field: 0,
          operation: "read",
          slot: 1,
          consequent: 1,
          alternate: 4,
          ...s,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 2, slot: 3, ...s }],
        terminator: {
          kind: "record",
          object: 2,
          record: 2,
          field: 1,
          operation: "read",
          slot: 2,
          consequent: 2,
          alternate: 4,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [
          { kind: "load", id: 3, slot: 1, ...s },
          { kind: "load", id: 4, slot: 2, ...s },
          { kind: "constant", id: 5, value: 3, ...s },
          {
            kind: "call-indirect",
            id: 6,
            target: 0,
            callee: 3,
            arguments: [5],
            ...s,
          },
          { kind: "constant", id: 7, value: 2, ...s },
          {
            kind: "call-indirect",
            id: 8,
            target: 0,
            callee: 4,
            arguments: [7],
            ...s,
          },
          { kind: "binary", id: 9, operator: "+", left: 6, right: 8, ...s },
          { kind: "store", slot: 4, value: 9, ...s },
          { kind: "constant", id: 10, value: 100, ...s },
          { kind: "call", id: 11, target: 2, arguments: [10], ...s },
        ],
        terminator: {
          kind: "record",
          object: 11,
          record: 2,
          field: 0,
          operation: "read",
          slot: 1,
          consequent: 3,
          alternate: 4,
          ...s,
        },
      },
      {
        id: 3,
        instructions: [
          { kind: "load", id: 12, slot: 1, ...s },
          { kind: "constant", id: 13, value: 5, ...s },
          {
            kind: "call-indirect",
            id: 14,
            target: 0,
            callee: 12,
            arguments: [13],
            ...s,
          },
          { kind: "load", id: 15, slot: 2, ...s },
          { kind: "constant", id: 16, value: 0, ...s },
          {
            kind: "call-indirect",
            id: 17,
            target: 0,
            callee: 15,
            arguments: [16],
            ...s,
          },
          { kind: "load", id: 18, slot: 4, ...s },
          { kind: "binary", id: 19, operator: "+", left: 14, right: 17, ...s },
          { kind: "binary", id: 20, operator: "+", left: 18, right: 19, ...s },
        ],
        terminator: { kind: "return", value: 20, ...s },
      },
      { id: 4, instructions: [], terminator: { kind: "trap", ...s } },
    ],
  };
  return {
    records: [
      ...base.records!,
      {
        byteLength: 32,
        fields: [
          { offset: 16, type: "reference", mutable: false },
          { offset: 24, type: "reference", mutable: false },
        ],
      },
    ],
    functions: [counter, { ...counter, id: 1, name: "sibling" }, factory, run],
  };
}

export function ownedClosureReferenceFixture(
  type: "string" | "reference",
): ModuleIR {
  const base = ownedClosureFixture();
  const capture: FunctionIR = {
    ...base.functions[0]!,
    slots: [type, "reference", type],
    returnType: type,
    blocks: base.functions[0]!.blocks.map((block) =>
      block.id === 0
        ? {
            ...block,
            instructions: [
              { kind: "record-new", id: 9, record: 2, arguments: [], ...s },
              ...block.instructions,
            ],
          }
        : block.id === 2
          ? {
              ...block,
              instructions: [{ kind: "load", id: 5, slot: 1, ...s }],
              terminator: {
                kind: "record-cell",
                object: 5,
                record: 0,
                field: 0,
                operation: "write",
                slot: 0,
                consequent: 3,
                alternate: 4,
                ...s,
              },
            }
          : block,
    ),
  };
  const factory: FunctionIR = { ...base.functions[1]!, slots: [type] };
  const run: FunctionIR = {
    id: 2,
    name: "run",
    exported: true,
    parameters: [0],
    slots: ["number", "boolean"],
    returnType: "number",
    entry: 0,
    blocks: [
      {
        id: 0,
        instructions: [
          type === "string"
            ? { kind: "string-literal", id: 0, value: "first", ...s }
            : { kind: "record-new", id: 0, record: 2, arguments: [], ...s },
          { kind: "call", id: 1, target: 1, arguments: [0], ...s },
          type === "string"
            ? { kind: "string-literal", id: 2, value: "second", ...s }
            : { kind: "record-new", id: 2, record: 2, arguments: [], ...s },
          {
            kind: "call-indirect",
            id: 3,
            target: 0,
            callee: 1,
            arguments: [2],
            ...s,
          },
          {
            kind: "call-indirect",
            id: 4,
            target: 0,
            callee: 1,
            arguments: [0],
            ...s,
          },
          { kind: "binary", id: 5, operator: "===", left: 3, right: 0, ...s },
          { kind: "binary", id: 6, operator: "===", left: 4, right: 2, ...s },
          { kind: "store", slot: 1, value: 6, ...s },
        ],
        terminator: {
          kind: "branch",
          condition: 5,
          consequent: 1,
          alternate: 3,
          ...s,
        },
      },
      {
        id: 1,
        instructions: [{ kind: "load", id: 7, slot: 1, ...s }],
        terminator: {
          kind: "branch",
          condition: 7,
          consequent: 2,
          alternate: 3,
          ...s,
        },
      },
      {
        id: 2,
        instructions: [{ kind: "constant", id: 8, value: 1, ...s }],
        terminator: { kind: "return", value: 8, ...s },
      },
      {
        id: 3,
        instructions: [{ kind: "constant", id: 9, value: -1, ...s }],
        terminator: { kind: "return", value: 9, ...s },
      },
    ],
  };
  return {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 24, stateOffset: 16, type, mutable: true }],
      },
      base.records![1]!,
      { byteLength: 32, fields: [] },
    ],
    functions: [capture, factory, run],
  };
}
