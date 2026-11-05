import type { ModuleIR } from "@tint/ir/scalar";
const s = { start: 0, end: 0 };

/** Inspect a function's existing managed environment without invoking the function. */
export function functionEnvironmentFixture(present: boolean): ModuleIR {
  return {
    records: [
      {
        byteLength: 32,
        fields: [{ offset: 16, type: "number", mutable: true }],
      },
    ],
    functions: [
      {
        id: 0,
        name: "run",
        exported: true,
        parameters: [0],
        slots: ["number", "number"],
        returnType: "number",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "constant", id: 0, value: 42, ...s },
              ...(present
                ? [
                    {
                      kind: "record-new" as const,
                      id: 1,
                      record: 0,
                      arguments: [0],
                      ...s,
                    },
                  ]
                : []),
              {
                kind: "function-new",
                id: 2,
                target: 1,
                ...(present ? { environment: 1 } : {}),
                ...s,
              },
              { kind: "function-environment", id: 3, callee: 2, ...s },
              ...(present
                ? [{ kind: "reference-value" as const, id: 8, value: 3, ...s }]
                : [
                    {
                      kind: "unary" as const,
                      id: 4,
                      operator: "truthy" as const,
                      operand: 3,
                      ...s,
                    },
                    {
                      kind: "unary" as const,
                      id: 5,
                      operator: "boolean-number" as const,
                      operand: 4,
                      ...s,
                    },
                    {
                      kind: "binary" as const,
                      id: 6,
                      operator: "-" as const,
                      left: 0,
                      right: 5,
                      ...s,
                    },
                  ]),
            ],
            terminator: present
              ? {
                  kind: "record",
                  object: 8,
                  record: 0,
                  field: 0,
                  operation: "read",
                  slot: 1,
                  consequent: 1,
                  alternate: 2,
                  ...s,
                }
              : { kind: "return", value: 6, ...s },
          },
          ...(present
            ? [
                {
                  id: 1,
                  instructions: [
                    { kind: "load" as const, id: 7, slot: 1, ...s },
                  ],
                  terminator: { kind: "return" as const, value: 7, ...s },
                },
                {
                  id: 2,
                  instructions: [],
                  terminator: { kind: "trap" as const, ...s },
                },
              ]
            : []),
        ],
      },
      {
        id: 1,
        name: "mustNotInvoke",
        exported: false,
        parameters: [],
        slots: [],
        returnType: "void",
        entry: 0,
        ...(present ? { closureEnvironment: 0 } : {}),
        blocks: [
          { id: 0, instructions: [], terminator: { kind: "trap", ...s } },
        ],
      },
    ],
  };
}
