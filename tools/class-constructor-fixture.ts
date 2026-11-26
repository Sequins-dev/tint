import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule, type Expression } from "@tint/typescript/syntax";
import {
  checkClosureModule,
  type ExpressionInfo,
  type Local,
} from "@tint/typescript/checker";
import { lowerFunction } from "@tint/ts-native/scalar";
import type { ModuleIR } from "@tint/ir/scalar";
import { createRecordContracts } from "@tint/ts-native/closure/records";

/** Exercise static state through function identity before source class evaluation exists. */
export function classConstructorFixture(write: boolean): {
  module: ModuleIR;
  bytes: number;
} {
  const bytes = new TextEncoder().encode(
    `class Other{static tag:number=0;static count:number=1;}class Box{static count:number=42;}function read(box:{new():Box;count:number}):number{return ${write ? "box.count=42" : "box.count"};}`,
  );
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const records = createRecordContracts(
    checked.value,
    {
      pointerSize: 8,
      wordSize: 8,
      allocationAlignment: 16,
      frameAlignment: 16,
      maxAlignment: 16,
    },
    4096,
    (message) => {
      throw Error(message);
    },
  );
  const storage = records.classes[1]!;
  const node = parsed.value.statements[2];
  assert.ok(node?.kind === "function" && node.body.kind === "block");
  const statement = node.body.statements[0];
  assert.ok(statement?.kind === "return" && statement.expression !== undefined);
  const result = statement.expression;
  const member = result.kind === "assignment" ? result.target : result;
  assert.ok(member.kind === "member");
  records.access(member, member.object, member.property, "number", write);
  const access = records.accesses.get(member)!;
  assert.equal(access.choices.length, 2);
  assert.notEqual(access.choices[0]!.record, storage.constructorState);
  const local: Local = {
    id: 0,
    name: "box",
    type: "reference",
    mutable: true,
    parameter: true,
    span: node,
  };
  const reader = lowerFunction(
    {
      id: 1,
      node,
      parameters: ["reference"],
      returnType: "number",
      locals: [local],
      declarations: new Map([[node.parameters[0]!, local]]),
      expressions: new Map<Expression, ExpressionInfo>([
        [member.object, { type: "reference", local: 0, callee: undefined }],
        [member, { type: "number", local: undefined, callee: undefined }],
        [result, { type: "number", local: undefined, callee: undefined }],
        ...(result.kind === "assignment"
          ? [
              [
                result.value,
                {
                  type: "number" as const,
                  local: undefined,
                  callee: undefined,
                },
              ] as [Expression, ExpressionInfo],
            ]
          : []),
      ]),
    },
    [],
    records,
  );
  const s = { start: 0, end: 0 };
  return {
    bytes:
      48 +
      records.records[storage.constructorState]!.byteLength +
      records.records[storage.prototype]!.byteLength,
    module: {
      records: records.records,
      functions: [
        {
          id: 0,
          name: "run",
          exported: true,
          parameters: [0],
          slots: ["number", "reference", "number", "number"],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                {
                  kind: "record-new",
                  id: 1,
                  record: storage.prototype,
                  arguments: [undefined],
                  ...s,
                },
                {
                  kind: "record-new",
                  id: 2,
                  record: storage.constructorState,
                  arguments: [1, undefined, undefined, undefined],
                  ...s,
                },
                { kind: "constant", id: 3, value: write ? 1 : 42, ...s },
                {
                  kind: "function-new",
                  id: 0,
                  target: 2,
                  environment: 2,
                  ...s,
                },
                { kind: "store", slot: 1, value: 0, ...s },
                { kind: "store", slot: 2, value: 3, ...s },
              ],
              terminator: {
                kind: "record-cell",
                operation: "initialize",
                object: 2,
                record: storage.constructorState,
                field: 1,
                slot: 2,
                consequent: 1,
                alternate: 2,
                ...s,
              },
            },
            {
              id: 1,
              instructions: [
                { kind: "load", id: 4, slot: 1, ...s },
                { kind: "call", id: 5, target: 1, arguments: [4], ...s },
                { kind: "store", slot: 3, value: 5, ...s },
                { kind: "function-environment", id: 6, callee: 4, ...s },
                { kind: "reference-value", id: 7, value: 6, ...s },
              ],
              terminator: {
                kind: "record-cell",
                operation: "read",
                object: 7,
                record: storage.constructorState,
                field: 1,
                slot: 2,
                consequent: 3,
                alternate: 2,
                ...s,
              },
            },
            { id: 2, instructions: [], terminator: { kind: "trap", ...s } },
            {
              id: 3,
              instructions: [
                { kind: "load", id: 8, slot: 2, ...s },
                { kind: "constant", id: 9, value: 42, ...s },
                {
                  kind: "binary",
                  id: 10,
                  operator: "===",
                  left: 8,
                  right: 9,
                  ...s,
                },
              ],
              terminator: {
                kind: "branch",
                condition: 10,
                consequent: 4,
                alternate: 2,
                ...s,
              },
            },
            {
              id: 4,
              instructions: [{ kind: "load", id: 11, slot: 3, ...s }],
              terminator: { kind: "return", value: 11, ...s },
            },
          ],
        },
        reader,
        {
          id: 2,
          name: "classCallMustNotExecute",
          closureEnvironment: storage.constructorState,
          exported: false,
          parameters: [],
          slots: [],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [],
              terminator: { kind: "trap", ...s },
            },
          ],
        },
      ],
    },
  };
}
