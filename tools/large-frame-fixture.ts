import type { ModuleIR } from "@tint/ir/scalar";
const span = { start: 0, end: 0 };
export function largeFrameFixture(): ModuleIR {
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
        slots: ["number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              ...Array.from({ length: 5000 }, (_, id) => ({
                kind: "constant" as const,
                id,
                value: id === 4999 ? 42 : 0,
                ...span,
              })),
              {
                kind: "record-new",
                id: 5000,
                record: 0,
                arguments: [4999],
                ...span,
              },
            ],
            terminator: { kind: "return", value: 4999, ...span },
          },
        ],
      },
    ],
  };
}
export function largeImageFixture(): ModuleIR {
  const base = largeFrameFixture(),
    first = base.functions[0]!;
  return {
    ...base,
    functions: [
      first,
      ...Array.from({ length: 512 }, (_, index) => ({
        id: index + 1,
        name: "padding" + index,
        exported: false,
        parameters: [],
        slots: [],
        returnType: "number" as const,
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: Array.from({ length: 128 }, (_, id) => ({
              kind: "constant" as const,
              id,
              value: id,
              ...span,
            })),
            terminator: { kind: "return" as const, value: 127, ...span },
          },
        ],
      })),
    ],
  };
}

export function largeBranchFixture(): ModuleIR {
  const base = largeFrameFixture();
  return {
    ...base,
    functions: [
      {
        ...base.functions[0]!,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 42, ...span },
              { kind: "record-new", id: 1, record: 0, arguments: [0], ...span },
              ...Array.from({ length: 70000 }, (_, index) => ({
                kind: "constant" as const,
                id: index + 2,
                value: 0,
                ...span,
              })),
            ],
            terminator: { kind: "return", value: 0, ...span },
          },
        ],
      },
    ],
  };
}
