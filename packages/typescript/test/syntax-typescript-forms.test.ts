import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import {
  parseModule,
  parseScript,
  type Expression,
  type Module,
  type Statement,
} from "@tint/typescript/syntax";

function parse(text: string): Module {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}
function initializer(statement: Statement | undefined): Expression {
  assert.ok(statement?.kind === "variable");
  const declaration = statement.declarations[0];
  assert.ok(
    declaration !== undefined &&
      declaration.kind !== "object-binding" &&
      declaration.kind !== "array-binding",
  );
  assert.ok(declaration.initializer !== undefined);
  return declaration.initializer;
}

test("as, as const and non-null assertions wrap their operand", () => {
  const module = parse(
    "const a = x as number[]; const b = y!.z; const c = { k: 1 } as const;",
  );
  const a = initializer(module.statements[0]);
  assert.equal(a.kind, "satisfies");
  assert.ok(
    a.kind === "satisfies" && a.assertion === "as" && a.type.kind === "array",
  );
  const b = initializer(module.statements[1]);
  assert.ok(
    b.kind === "member" &&
      b.object.kind === "satisfies" &&
      b.object.assertion === "non-null",
  );
  const c = initializer(module.statements[2]);
  assert.ok(
    c.kind === "satisfies" &&
      c.type.kind === "named" &&
      c.type.name === "unknown",
  );
});

test("JavaScript keeps rejecting TypeScript assertions", () => {
  assert.equal(parseScript(createSourceTextView("var a = x as y;")).ok, false);
});

test("member modifiers erase; declare and abstract members vanish", () => {
  const module = parse(
    "abstract class A { private readonly x = 1; declare y: number; abstract m(): void; protected abstract z: string; static override readonly w = 2; n?: number; o!: string; }",
  );
  const statement = module.statements[0];
  assert.ok(statement?.kind === "class");
  const names = statement.definition.elements.map((element) =>
    element.kind === "static-block" || element.key.kind !== "string"
      ? "?"
      : element.key.value,
  );
  assert.deepEqual(names, ["x", "w", "n", "o"]);
});

test("parameter properties assign after super in derived constructors", () => {
  const module = parse(
    "class B extends A { constructor(public a: number, private readonly b = 2) { super(); log(); } }",
  );
  const statement = module.statements[0];
  assert.ok(statement?.kind === "class");
  const constructor = statement.definition.elements[0];
  assert.ok(constructor !== undefined && constructor.kind === "method");
  const body = constructor.body.statements.map((s) =>
    s.kind === "expression"
      ? s.expression.kind === "assignment" &&
        s.expression.target.kind === "member"
        ? "this." + s.expression.target.property
        : s.expression.kind === "call" && s.expression.callee.kind === "super"
          ? "super"
          : "call"
      : s.kind,
  );
  assert.deepEqual(body, ["super", "this.a", "this.b", "call"]);
});

test("enums become objects built by an immediately invoked arrow", () => {
  const module = parse("export enum E { A, B = 5, C }");
  const statement = module.statements[0];
  assert.ok(statement?.kind === "variable" && statement.exported);
  const value = initializer(statement);
  assert.ok(
    value.kind === "call" &&
      value.callee.kind === "group" &&
      value.callee.expression.kind === "arrow",
  );
});

test("ambient declarations leave no runtime statements", () => {
  const module = parse(
    "declare const p: { env: Record<string, string> };\ndeclare function f(x: number): void;\ndeclare global { interface W { x: number } }\nexport declare class C { m(): void; }\nconst z = 1;",
  );
  assert.deepEqual(
    module.statements.map((s) => s.kind),
    ["empty", "empty", "empty", "empty", "variable"],
  );
});
