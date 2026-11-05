import type { ModuleIR } from "@tint/ir/scalar";
const s = { start: 0, end: 0 };
/** The receiver remains distinct from the ordinary Number argument. */
export function receiverIRFixture(indirect = false, supplied = true): ModuleIR {
  return {
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
              { kind: "function-new", id: 4, target: 1, ...s },
              { kind: "constant", id: 0, value: 19, ...s },
              { kind: "general-wrap", id: 1, value: 0, ...s },
              { kind: "constant", id: 2, value: supplied ? 23 : 42, ...s },
              {
                ...(indirect
                  ? { kind: "call-indirect" as const, callee: 4 }
                  : { kind: "call" as const }),
                id: 3,
                target: 1,
                arguments: [2],
                ...(supplied ? { receiver: 1 } : {}),
                ...s,
              },
            ],
            terminator: { kind: "return", value: 3, ...s },
          },
        ],
      },
      {
        id: 1,
        name: "receiver",
        exported: false,
        parameters: [0],
        receiverSlot: 2,
        slots: ["number", "boolean", "general"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 2, ...s },
              supplied
                ? {
                    kind: "general-value",
                    id: 1,
                    value: 0,
                    type: "number",
                    ...s,
                  }
                : { kind: "general-none", id: 1, ...s },
              { kind: "load", id: 2, slot: 0, ...s },
              supplied
                ? {
                    kind: "binary",
                    id: 3,
                    operator: "+",
                    left: 1,
                    right: 2,
                    ...s,
                  }
                : { kind: "general-equal", id: 3, left: 0, right: 1, ...s },
            ],
            terminator: supplied
              ? { kind: "return", value: 3, ...s }
              : {
                  kind: "branch",
                  condition: 3,
                  consequent: 1,
                  alternate: 2,
                  ...s,
                },
          },
          ...(!supplied
            ? [
                {
                  id: 1,
                  instructions: [
                    { kind: "load" as const, id: 4, slot: 0, ...s },
                  ],
                  terminator: { kind: "return" as const, value: 4, ...s },
                },
                {
                  id: 2,
                  instructions: [
                    { kind: "constant" as const, id: 5, value: 0, ...s },
                  ],
                  terminator: { kind: "return" as const, value: 5, ...s },
                },
              ]
            : []),
        ],
      },
    ],
  };
}
