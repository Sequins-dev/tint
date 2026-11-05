import * as syntax from "@tint/typescript/syntax";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDynamicFunction,
  type DynamicFunctionKind,
} from "@tint/typescript/syntax";
import { validateJavaScriptBindings } from "@tint/typescript/binding";

const constructors: Record<DynamicFunctionKind, FunctionConstructor> = {
  normal: Function,
  generator: Object.getPrototypeOf(function* () {}).constructor,
  async: Object.getPrototypeOf(async function () {}).constructor,
  "async-generator": Object.getPrototypeOf(async function* () {}).constructor,
};
for (const kind of [
  "normal",
  "generator",
  "async",
  "async-generator",
] as const) {
  test(`dynamic ${kind} functions parse independent fragments and canonical source`, () => {
    const body = "return '\ud800';",
      parsed = parseDynamicFunction(kind, ["a", "b = 1"], body);
    assert.ok(parsed.ok, JSON.stringify(parsed));
    assert.equal(
      validateJavaScriptBindings(parsed.value.module, "script"),
      undefined,
    );
    assert.equal(
      parsed.value.sourceText,
      constructors[kind]("a", "b = 1", body).toString(),
    );
    const statement = parsed.value.module.statements[0];
    assert.ok(
      statement?.kind === "expression" &&
        statement.expression.kind === "function-expression",
    );
    assert.equal(
      statement.expression.name,
      undefined,
      "anonymous is source text, not a named-function lexical binding",
    );
    assert.equal(statement.expression.parameters.length, 2);
    const returned = statement.expression.body.statements[0];
    assert.ok(
      returned?.kind === "return" && returned.expression?.kind === "string",
    );
    assert.equal(returned.expression.value, "\ud800");
  });
  for (const [parameters, body] of [
    [["/*"], "*/ ) {"],
    [["a) {}); (function anonymous(b"], ""],
    [[], "} ); (function anonymous() {"],
    [["a: number"], "return a;"],
    [["...a,"], "return a;"],
    [["a = 1"], "'use strict';return a;"],
    [[], "super.x;"],
  ] as const) {
    test(`dynamic ${kind} rejects invalid fragment boundaries: ${JSON.stringify([parameters, body])}`, () => {
      assert.throws(() => constructors[kind](...parameters, body), SyntaxError);
      const parsed = parseDynamicFunction(kind, parameters, body);
      assert.equal(parsed.ok, false, JSON.stringify(parsed));
      if (!parsed.ok)
        assert.ok(
          ["SYNTAX_ERROR", "LEXICAL_ERROR"].includes(parsed.error.code),
        );
    });
  }
}
test("dynamic grammar kind controls await and yield parameters", () => {
  for (const [kind, name, valid] of [
    ["normal", "await", true],
    ["normal", "yield", true],
    ["async", "await", false],
    ["generator", "yield", false],
    ["async-generator", "yield", false],
    ["async-generator", "await", false],
  ] as const) {
    const parsed = parseDynamicFunction(kind, [name], "");
    assert.equal(parsed.ok, valid, JSON.stringify({ kind, name, parsed }));
  }
});

test("dynamic fragments agree with reference constructors after binding validation", () => {
  const parameters = [
    [],
    ["a"],
    ["a", "a"],
    ["a=1"],
    ["{a}"],
    ["[a]"],
    ["...a"],
    ["await"],
    ["yield"],
    ["a/* comment */"],
    ["a// comment"],
    ["/*"],
    ["a){}//"],
    ["a", "...b"],
    ["a: number"],
    ["a = new.target"],
  ];
  const bodies = [
    "",
    "return 1;",
    "'use strict';",
    "let a;",
    "var a;",
    "return new.target;",
    "await 1;",
    "yield 1;",
    "return '\ud800';",
    "// trailing comment",
    "/*",
    "*/",
    "} //",
    "return /}/;",
    "return `x${1}`;",
    "super();",
    "super.x;",
    "return anonymous;",
    "return await;",
    "return yield;",
  ];
  for (const kind of [
    "normal",
    "generator",
    "async",
    "async-generator",
  ] as const)
    for (const params of parameters)
      for (const body of bodies) {
        let expected = true;
        try {
          constructors[kind](...params, body);
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          expected = false;
        }
        const parsed = parseDynamicFunction(kind, params, body),
          accepted =
            parsed.ok &&
            validateJavaScriptBindings(parsed.value.module, "script") ===
              undefined;
        assert.equal(
          accepted,
          expected,
          JSON.stringify({ kind, params, body, parsed }),
        );
      }
});

test("expected argument count stops at the first default or rest, not a binding pattern", () => {
  assert.equal(typeof syntax.expectedArgumentCount, "function");
  for (const [parameters, expected] of [
    [[], 0],
    [["a", "a"], 2],
    [["{x}", "[y]"], 2],
    [["{x = 1}", "y"], 2],
    [["a", "b = 1", "c"], 1],
    [["a", "...rest"], 1],
    [["{x} = {}", "y"], 0],
  ] as const) {
    const parsed = parseDynamicFunction("normal", parameters, "");
    assert.ok(parsed.ok, JSON.stringify(parsed));
    const statement = parsed.value.module.statements[0];
    assert.ok(
      statement?.kind === "expression" &&
        statement.expression.kind === "function-expression",
    );
    assert.equal(
      syntax.expectedArgumentCount(statement.expression.parameters),
      expected,
    );
    assert.equal(expected, Function(...parameters, "").length);
  }
});
