import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import {
  parseModule,
  type BlockStatement,
  type Expression,
  type Statement,
} from "@tint/typescript/syntax";
import { forwardSingleUseTemporaries } from "../src/lowering/forward-temporaries.ts";

function block(source: string): BlockStatement {
  const parsed = parseModule(
    createSourceTextView("function f() {" + source + "}"),
  );
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const fn = parsed.value.statements[0];
  assert.ok(fn?.kind === "function" && fn.body.kind === "block");
  return fn.body;
}
function print(node: Expression): string {
  switch (node.kind) {
    case "identifier":
      return node.name;
    case "string":
      return JSON.stringify(node.value);
    case "number":
      return String(node.value);
    case "call":
      return (
        print(node.callee) + "(" + node.arguments.map(print).join(", ") + ")"
      );
    case "member":
      return print(node.object) + "." + node.property;
    case "binary":
      return print(node.left) + " " + node.operator + " " + print(node.right);
    case "assignment":
      return print(node.target) + " = " + print(node.value);
    case "arrow":
      return "() => …";
    default:
      return "<" + node.kind + ">";
  }
}
function statement(node: Statement): string {
  switch (node.kind) {
    case "expression":
      return print(node.expression) + ";";
    case "variable": {
      const declaration = node.declarations[0];
      assert.ok(
        declaration !== undefined &&
          declaration.kind !== "object-binding" &&
          declaration.kind !== "array-binding",
      );
      assert.ok(declaration.initializer !== undefined);
      return (
        node.mode +
        " " +
        declaration.name +
        " = " +
        print(declaration.initializer) +
        ";"
      );
    }
    case "return":
      return (
        "return " +
        (node.expression === undefined ? "" : print(node.expression)) +
        ";"
      );
    case "try":
      return "try { " + node.body.statements.map(statement).join(" ") + " }";
    default:
      return "<" + node.kind + ">";
  }
}
function forward(source: string): string {
  const result = forwardSingleUseTemporaries(block(source), (name) =>
    name.startsWith("$v"),
  );
  return result.statements.map(statement).join(" ");
}

test("a single-use temporary moves into its only consumer", () => {
  assert.equal(forward("const $v1 = f(); g($v1);"), "g(f());");
  assert.equal(
    forward("const $v1 = f(); const $v2 = g($v1); h($v2);"),
    "h(g(f()));",
  );
  assert.equal(forward("const $v1 = f(); return $v1;"), "return f();");
  assert.equal(
    forward("let x = 0; const $v1 = f(); x = $v1;"),
    "let x = 0; x = f();",
  );
  // Constants and literals evaluated first cannot observe the moved call.
  assert.equal(
    forward("const a = k(); const $v1 = f(); g(a, 1, $v1);"),
    "const a = k(); g(a, 1, f());",
  );
  // A list's push reads only a constant before its argument.
  assert.equal(
    forward("const list = []; const $v1 = f(); list.push($v1);"),
    "const list = <array>; list.push(f());",
  );
});

test("forwarding never reorders, drops, duplicates or conditionalizes an evaluation", () => {
  for (const source of [
    // Another call would run first.
    "const $v1 = f(); g(h(), $v1);",
    // A mutable binding read first could be changed by the moved call.
    "let x = 0; const $v1 = f(); g(x, $v1);",
    // Read twice.
    "const $v1 = f(); g($v1, $v1);",
    // Conditional operands.
    "const $v1 = f(); a && $v1;",
    "const $v1 = f(); g(a ?? $v1);",
    // Captured by a nested function.
    "const $v1 = f(); g(() => $v1);",
    // Not a temporary, mutable, or never read.
    "const a1 = f(); g(a1);",
    "let $v1 = f(); g($v1);",
    "const $v1 = f(); g();",
    // A property read first may observe the moved call.
    "const $v1 = f(); g(o.p, $v1);",
  ]) {
    const before = block(source).statements.length;
    assert.equal(
      forwardSingleUseTemporaries(block(source), (name) =>
        name.startsWith("$v"),
      ).statements.length,
      before,
      source,
    );
  }
});

test("named string literals stay named for shared literal tables", () => {
  assert.equal(forward('const $v1 = "s"; g($v1);'), 'const $v1 = "s"; g($v1);');
  // A call may move past a string-literal constant, which evaluates nothing.
  assert.equal(
    forward('const $v1 = f(); const $v2 = "s"; g(o, $v1, $v2);'),
    'const $v2 = "s"; g(o, f(), $v2);',
  );
  // Declared types other than unknown are retained.
  assert.equal(
    forward("const $v1: string[] = f(); g($v1);"),
    "const $v1 = f(); g($v1);",
  );
  assert.equal(forward("const $v1: unknown = f(); g($v1);"), "g(f());");
});

test("nested statement lists are forwarded within themselves", () => {
  assert.equal(
    forward("try { const $v1 = f(); g($v1); } finally { h(); }"),
    "try { g(f()); }",
  );
  // A temporary never moves out of its own list.
  assert.equal(
    forward("const $v1 = f(); try { g($v1); } finally { h(); }"),
    "const $v1 = f(); try { g($v1); }",
  );
});
