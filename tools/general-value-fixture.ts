import type { ModuleIR } from "@tint/ir/scalar";
const s = { start: 0, end: 0 };
export function generalValueFixture(): ModuleIR {
  return {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "general", mutable: false }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "run",
        exported: true,
        parameters: [0],
        slots: ["number", "general"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 42, ...s },
              { kind: "general-wrap", id: 1, value: 0, ...s },
              { kind: "call", id: 2, target: 1, arguments: [1], ...s },
              { kind: "record-new", id: 3, record: 0, arguments: [2], ...s },
              { kind: "general-wrap", id: 4, value: 3, ...s },
              { kind: "call", id: 5, target: 1, arguments: [4], ...s },
              {
                kind: "general-value",
                id: 6,
                value: 5,
                type: "reference",
                ...s,
              },
            ],
            terminator: {
              kind: "record",
              object: 6,
              record: 0,
              field: 0,
              operation: "read",
              slot: 1,
              consequent: 1,
              alternate: 2,
              ...s,
            },
          },
          {
            id: 1,
            instructions: [
              { kind: "load", id: 7, slot: 1, ...s },
              { kind: "general-value", id: 8, value: 7, type: "number", ...s },
            ],
            terminator: { kind: "return", value: 8, ...s },
          },
          { id: 2, instructions: [], terminator: { kind: "trap", ...s } },
        ],
      },
      {
        id: 1,
        name: "identity",
        exported: false,
        parameters: [0],
        slots: ["general"],
        returnType: "general",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
            terminator: { kind: "return", value: 0, ...s },
          },
        ],
      },
    ],
  };
}

export function generalExceptionFixture(): ModuleIR {
  return {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: false }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "run",
        exported: true,
        parameters: [0],
        slots: ["number", "general"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 42, ...s },
              { kind: "record-new", id: 1, record: 0, arguments: [0], ...s },
            ],
            terminator: { kind: "jump", target: 1, ...s },
          },
          {
            id: 1,
            exception: { target: 2, slot: 1 },
            instructions: [
              { kind: "constant", id: 2, value: 42, ...s },
              { kind: "general-wrap", id: 3, value: 2, ...s },
              { kind: "call", id: 4, target: 1, arguments: [3], ...s },
            ],
            terminator: { kind: "trap", ...s },
          },
          {
            id: 2,
            instructions: [
              { kind: "load", id: 5, slot: 1, ...s },
              { kind: "general-value", id: 6, value: 5, type: "number", ...s },
            ],
            terminator: { kind: "return", value: 6, ...s },
          },
        ],
      },
      {
        id: 1,
        name: "thrower",
        exported: false,
        parameters: [0],
        slots: ["general"],
        returnType: "general",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [{ kind: "load", id: 0, slot: 0, ...s }],
            terminator: { kind: "throw", value: 0, ...s },
          },
        ],
      },
    ],
  };
}
