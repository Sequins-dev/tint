import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule, type Expression } from "@tint/typescript/syntax";
import type { ExpressionInfo, Local } from "@tint/typescript/checker";
import { lowerFunction, type RecordAccess } from "@tint/ts-native/scalar";
import type { ModuleIR } from "@tint/ir/scalar";

/** Physical contract fixture, independent of class syntax/checking. */
export function prototypeRecordFixture(
  own: "absent" | "undefined" | "value",
  depth: number = 1,
): ModuleIR {
  assert.ok(depth === 1 || depth === 2);
  const bytes = new TextEncoder().encode(
    "function read(object: unknown): number | undefined { return object.value; }",
  );
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const node = parsed.value.statements[0];
  assert.ok(node?.kind === "function" && node.body.kind === "block");
  const statement = node.body.statements[0];
  assert.ok(
    statement?.kind === "return" && statement.expression?.kind === "member",
  );
  const member = statement.expression;
  const local: Local = {
    id: 0,
    name: "object",
    type: "reference",
    mutable: true,
    parameter: true,
    span: node,
  };
  let access: RecordAccess = {
    type: "optional-number",
    choices: [{ record: 1, field: 0, type: "optional-number" }],
  };
  for (let index = 0; index < depth; index++) {
    access = {
      type: "optional-number",
      choices: [
        // A mismatched descriptor must advance dispatch, not read its layout.
        { record: 1, field: 0, type: "optional-number" },
        {
          record: 0,
          field: 0,
          type: "optional-number",
          prototype: { field: 1, access },
        },
      ],
    };
  }
  const reader = lowerFunction(
    {
      id: 1,
      node,
      parameters: ["reference"],
      returnType: "optional-number",
      locals: [local],
      declarations: new Map([[node.parameters[0]!, local]]),
      expressions: new Map<Expression, ExpressionInfo>([
        [member.object, { type: "reference", local: 0, callee: undefined }],
        [
          member,
          { type: "optional-number", local: undefined, callee: undefined },
        ],
      ]),
    },
    [],
    {
      constructions: new Map(),
      accesses: new Map<Expression, RecordAccess>([[member, access]]),
    },
  );
  const s = { start: 0, end: 0 };
  return {
    records: [
      {
        byteLength: 64,
        fields: [
          {
            offset: 24,
            presenceOffset: 16,
            type: "optional-number",
            mutable: true,
          },
          { offset: 48, type: "reference", mutable: false },
        ],
      },
      {
        byteLength: 48,
        fields: [{ offset: 16, type: "optional-number", mutable: true }],
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
              {
                kind: "constant",
                id: 0,
                value: own === "value" ? 7 : 42,
                ...s,
              },
              { kind: "optional-wrap", id: 9, value: 0, ...s },
              { kind: "record-new", id: 1, record: 1, arguments: [9], ...s },
              { kind: "undefined", id: 2, ...s },
              { kind: "constant", id: 3, value: 42, ...s },
              { kind: "optional-wrap", id: 10, value: 3, ...s },
              ...(depth === 2
                ? [
                    {
                      kind: "record-new" as const,
                      id: 11,
                      record: 0,
                      arguments: [undefined, 1],
                      ...s,
                    },
                  ]
                : []),
              {
                kind: "record-new",
                id: 4,
                record: 0,
                arguments: [
                  own === "absent" ? undefined : own === "undefined" ? 2 : 10,
                  depth === 2 ? 11 : 1,
                ],
                ...s,
              },
              { kind: "call", id: 5, target: 1, arguments: [4], ...s },
              ...(own === "undefined"
                ? [
                    {
                      kind: "optional-present" as const,
                      id: 6,
                      value: 5,
                      ...s,
                    },
                    {
                      kind: "unary" as const,
                      id: 7,
                      operator: "boolean-number" as const,
                      operand: 6,
                      ...s,
                    },
                    {
                      kind: "binary" as const,
                      id: 8,
                      operator: "-" as const,
                      left: 3,
                      right: 7,
                      ...s,
                    },
                  ]
                : [{ kind: "optional-value" as const, id: 8, value: 5, ...s }]),
            ],
            terminator: { kind: "return", value: 8, ...s },
          },
        ],
      },
      reader,
    ],
  };
}

/** A second lookup must observe a write made after the first lookup. */
export function prototypeMutationFixture(
  target: "own" | "prototype",
): ModuleIR {
  const module = prototypeRecordFixture("absent"),
    runner = module.functions[0]!,
    first = runner.blocks[0]!,
    call = first.instructions.findIndex((op) => op.kind === "call"),
    s = { start: 0, end: 0 };
  return {
    ...module,
    functions: [
      {
        ...runner,
        slots: ["number", "reference", "optional-number", "optional-number"],
        blocks: [
          {
            id: 0,
            instructions: [
              ...first.instructions
                .slice(0, call + 1)
                .map((op) =>
                  op.kind === "constant" && op.id === 0
                    ? { ...op, value: 7 }
                    : op,
                ),
              { kind: "store", slot: 1, value: 4, ...s },
              { kind: "store", slot: 2, value: 10, ...s },
              { kind: "store", slot: 3, value: 5, ...s },
            ],
            terminator: {
              kind: "record",
              object: target === "own" ? 4 : 1,
              record: target === "own" ? 0 : 1,
              field: 0,
              operation: "write",
              slot: 2,
              consequent: 1,
              alternate: 2,
              ...s,
            },
          },
          {
            id: 1,
            instructions: [
              { kind: "load", id: 12, slot: 1, ...s },
              { kind: "call", id: 15, target: 1, arguments: [12], ...s },
              { kind: "optional-value", id: 16, value: 15, ...s },
              { kind: "load", id: 17, slot: 3, ...s },
              { kind: "optional-value", id: 18, value: 17, ...s },
              { kind: "constant", id: 19, value: 7, ...s },
              {
                kind: "binary",
                id: 20,
                operator: "-",
                left: 16,
                right: 18,
                ...s,
              },
              {
                kind: "binary",
                id: 21,
                operator: "+",
                left: 20,
                right: 19,
                ...s,
              },
            ],
            terminator: { kind: "return", value: 21, ...s },
          },
          { id: 2, instructions: [], terminator: { kind: "trap", ...s } },
        ],
      },
      module.functions[1]!,
    ],
  };
}
