import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule, type Expression } from "@tint/typescript/syntax";
import {
  checkClosureModule,
  type ExpressionInfo,
  type Local,
} from "@tint/typescript/checker";
import { lowerFunction, type ConstructorCall } from "@tint/ts-native/scalar";
import type { ModuleIR, FunctionIR, ScalarType } from "@tint/ir/scalar";

/** Callee rebinding and argument side effects must precede construction entry dispatch. */
export type ClassNewCase =
  "order" | "defaults" | "throw-argument" | "throw-constructor";
export function classNewFixture(mode: ClassNewCase = "order"): {
  module: ModuleIR;
  bytes: number;
} {
  const optional = mode === "defaults";
  const body =
    mode === "throw-argument" || mode === "throw-constructor"
      ? "try{return new C(bad(),0);}catch{return new D(42,40);}"
      : `return new C(${optional ? "" : "(C=D)===D?(x=40):0,x+=2"});`;
  const bytes = new TextEncoder().encode(
    `function build(C:{new(a${optional ? "?" : ""}:number,b${optional ? "?" : ""}:number):{value:number}},D:{new(a${optional ? "?" : ""}:number,b${optional ? "?" : ""}:number):{value:number}},x:number):{value:number}{${body}}function bad():number{throw "argument";}`,
  );
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok);
  const checked = checkClosureModule(parsed.value);
  assert.ok(checked.ok, JSON.stringify(checked));
  const node = parsed.value.statements[0];
  assert.ok(node?.kind === "function" && node.body.kind === "block");
  const constructions: (Expression & { kind: "new" })[] = [];
  const locals: Local[] = node.parameters.map((p, id) => {
    assert.ok(p.kind !== "pattern-parameter");
    return {
      id,
      name: p.name,
      type: id === 2 ? "number" : "reference",
      mutable: true,
      parameter: true,
      span: p,
    };
  });
  const expressions = new Map<Expression, ExpressionInfo>();
  checked.value.expressions.forEach((id, expression) => {
    if (expression.kind === "new") constructions.push(expression);
    const type = checked.value.types[id];
    const target =
      expression.kind === "assignment" || expression.kind === "compound"
        ? expression.target
        : expression;
    const local =
      target.kind === "identifier"
        ? locals.find((local) => local.name === target.name)?.id
        : undefined;
    expressions.set(expression, {
      type:
        type?.kind === "boolean"
          ? "boolean"
          : type?.kind === "number" || type?.kind === "literal"
            ? "number"
            : "reference",
      local,
      callee: expression.kind === "call" ? 5 : undefined,
    });
  });
  const s = { start: 0, end: 0 };
  const parameter: ScalarType = optional ? "optional-number" : "number";
  const signature = {
    parameters: [parameter, parameter],
    returnType: "reference" as const,
  };
  const build = lowerFunction(
    {
      id: 1,
      node,
      parameters: ["reference", "reference", "number"],
      returnType: "reference",
      locals,
      declarations: new Map(node.parameters.map((p, i) => [p, locals[i]!])),
      expressions,
    },
    [
      signature,
      signature,
      signature,
      signature,
      { parameters: [], returnType: "void" },
      { parameters: [], returnType: "number" },
    ],
    {
      constructions: new Map(),
      accesses: new Map(),
      constructors: new Map<Expression, ConstructorCall>(
        constructions.map((construction) => [
          construction,
          {
            target: 2,
            entry: {
              type: "reference",
              functionEnvironment: true,
              choices: [{ record: 0, field: 0, type: "reference" }],
            },
          },
        ]),
      ),
    },
  );
  function factory(id: number, wrong: boolean): FunctionIR {
    if (mode === "throw-constructor" && !wrong)
      return {
        id,
        name: "throwingConstruction",
        exported: false,
        parameters: [0, 1],
        slots: ["number", "number"],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [],
            terminator: { kind: "throw-literal", value: "construction", ...s },
          },
        ],
      };
    if (optional)
      return {
        id,
        name: wrong ? "wrongConstruction" : "construction",
        exported: false,
        parameters: [0, 1],
        slots: [parameter, parameter],
        returnType: "reference",
        entry: 0,
        blocks: [
          {
            id: 0,
            instructions: [
              { kind: "load", id: 0, slot: 0, ...s },
              { kind: "optional-present", id: 1, value: 0, ...s },
            ],
            terminator: {
              kind: "branch",
              condition: 1,
              consequent: 2,
              alternate: 1,
              ...s,
            },
          },
          {
            id: 1,
            instructions: [
              { kind: "load", id: 2, slot: 1, ...s },
              { kind: "optional-present", id: 3, value: 2, ...s },
            ],
            terminator: {
              kind: "branch",
              condition: 3,
              consequent: 2,
              alternate: 3,
              ...s,
            },
          },
          { id: 2, instructions: [], terminator: { kind: "trap", ...s } },
          {
            id: 3,
            instructions: [
              { kind: "constant", id: 4, value: wrong ? 40 : 42, ...s },
              { kind: "record-new", id: 5, record: 1, arguments: [4], ...s },
            ],
            terminator: { kind: "return", value: 5, ...s },
          },
        ],
      };
    return {
      id,
      name: wrong ? "wrongConstruction" : "construction",
      exported: false,
      parameters: [0, 1],
      slots: ["number", "number"],
      returnType: "reference",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            { kind: "load", id: 0, slot: wrong ? 0 : 1, ...s },
            { kind: "record-new", id: 1, record: 1, arguments: [0], ...s },
          ],
          terminator: { kind: "return", value: 1, ...s },
        },
      ],
    };
  }
  return {
    bytes: 288,
    module: {
      records: [
        {
          byteLength: 32,
          fields: [{ offset: 16, type: "reference", mutable: false }],
        },
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
          slots: ["number", "number"],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions: [
                { kind: "function-new", id: 0, target: 2, ...s },
                { kind: "record-new", id: 1, record: 0, arguments: [0], ...s },
                {
                  kind: "function-new",
                  id: 2,
                  target: 4,
                  environment: 1,
                  ...s,
                },
                { kind: "function-new", id: 3, target: 3, ...s },
                { kind: "record-new", id: 4, record: 0, arguments: [3], ...s },
                {
                  kind: "function-new",
                  id: 5,
                  target: 4,
                  environment: 4,
                  ...s,
                },
                { kind: "constant", id: 6, value: 0, ...s },
                { kind: "call", id: 7, target: 1, arguments: [2, 5, 6], ...s },
              ],
              terminator: {
                kind: "record",
                operation: "read",
                object: 7,
                record: 1,
                field: 0,
                slot: 1,
                consequent: 1,
                alternate: 2,
                ...s,
              },
            },
            {
              id: 1,
              instructions: [{ kind: "load", id: 8, slot: 1, ...s }],
              terminator: { kind: "return", value: 8, ...s },
            },
            { id: 2, instructions: [], terminator: { kind: "trap", ...s } },
          ],
        },
        build,
        factory(2, false),
        factory(3, true),
        {
          id: 4,
          name: "classCallMustNotExecute",
          exported: false,
          parameters: [],
          slots: [],
          returnType: "void",
          closureEnvironment: 0,
          entry: 0,
          blocks: [
            { id: 0, instructions: [], terminator: { kind: "trap", ...s } },
          ],
        },
        {
          id: 5,
          name: "bad",
          exported: false,
          parameters: [],
          slots: [],
          returnType: "number",
          entry: 0,
          blocks: [
            {
              id: 0,
              instructions:
                mode === "throw-constructor"
                  ? [{ kind: "constant", id: 0, value: 40, ...s }]
                  : [],
              terminator:
                mode === "throw-constructor"
                  ? { kind: "return", value: 0, ...s }
                  : { kind: "throw-literal", value: "argument", ...s },
            },
          ],
        },
      ],
    },
  };
}
