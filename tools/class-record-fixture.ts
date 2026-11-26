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

/** Exercise class layouts and field reads without class construction: own
 * data fields are deferred (no initialization state), so construction writes
 * them and reads are plain record accesses. */
export function classRecordFixture(): { module: ModuleIR; bytes: number } {
  const bytes = new TextEncoder().encode(
    "class Box{value:number=42;read():number{return this.value;}}function read(box:Box):number{return box.value;}",
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
  const storage = records.classes[0]!;
  const node = parsed.value.statements[1];
  assert.ok(node?.kind === "function" && node.body.kind === "block");
  const statement = node.body.statements[0];
  assert.ok(
    statement?.kind === "return" && statement.expression?.kind === "member",
  );
  const member = statement.expression;
  records.access(member, member.object, member.property, "number", false);
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
      ]),
    },
    [],
    records,
  );
  const s = { start: 0, end: 0 };
  return {
    bytes:
      48 +
      records.records[storage.instance]!.byteLength +
      records.records[storage.prototype]!.byteLength,
    module: {
      records: records.records,
      functions: [
        {
          id: 0,
          name: "run",
          exported: true,
          parameters: [0],
          slots: ["number", "reference", "number"],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "function-new", id: 0, target: 2, ...s },
                {
                  kind: "record-new",
                  id: 1,
                  record: storage.prototype,
                  arguments: [undefined, 0],
                  ...s,
                },
                {
                  kind: "record-new",
                  id: 2,
                  record: storage.instance,
                  arguments: [undefined, undefined, 1],
                  ...s,
                },
                { kind: "constant", id: 3, value: 42, ...s },
                { kind: "store", slot: 1, value: 2, ...s },
                { kind: "store", slot: 2, value: 3, ...s },
              ],
              terminator: {
                kind: "record",
                operation: "write",
                object: 2,
                record: storage.instance,
                field: 0,
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
              ],
              terminator: { kind: "return", value: 5, ...s },
            },
            { id: 2, instructions: [], terminator: { kind: "trap", ...s } },
          ],
        },
        reader,
        {
          id: 2,
          name: "method",
          exported: false,
          parameters: [],
          slots: [],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [{ kind: "constant", id: 0, value: 42, ...s }],
              terminator: { kind: "return", value: 0, ...s },
            },
          ],
        },
      ],
    },
  };
}
