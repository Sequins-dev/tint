import { syntaxShape } from "./syntax-shape.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import {
  parseScript,
  rewriteModule,
  type Module,
  type Expression,
} from "@tint/typescript/syntax";
import * as lowering from "../src/lowering/index.ts";
function parsed(source: string) {
  const result = parseScript(createSourceTextView(source));
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
function lower(source: string, evalMode = true) {
  const module = parsed(source),
    // Eval entries are always runtime-compiled; compare under the same mode.
    result = evalMode
      ? lowering.lowerEvalScript(module, source)
      : lowering.lowerScript(module, source, { runtimeCompiled: true });
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
function calls(module: Module, name: string) {
  const found: Extract<Expression, { kind: "call" }>[] = [];
  rewriteModule(module, {
    expression(node) {
      if (
        node.kind === "call" &&
        node.callee.kind === "identifier" &&
        node.callee.name === name
      )
        found.push(node);
      return node;
    },
  });
  return found;
}
function normalize(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(normalize).filter((x) => x !== undefined);
  if (value === null || typeof value !== "object") return value;
  const node = value as Record<string, any>;
  if (node.kind === "variable" && node.declarations[0]?.name === "$evalLexical")
    return undefined;
  if (node.kind === "identifier" && node.name === "$evalLexical")
    return {
      start: node.start,
      end: node.end,
      kind: "member",
      object: {
        start: node.start,
        end: node.end,
        kind: "identifier",
        name: "$global",
      },
      property: "lexical",
    };
  if (
    node.kind === "member" &&
    node.property === "hostDefined" &&
    node.object.kind === "identifier" &&
    node.object.name === "$script"
  )
    return normalize(node.object);
  // Sloppy indirect eval declares vars globally while retaining a fresh lexical scope.
  if (
    node.name === "variables" &&
    node.value?.kind === "call" &&
    node.value.callee?.name === "createGlobalScope"
  )
    return {
      ...node,
      value: {
        start: node.value.start,
        end: node.value.end,
        kind: "identifier",
        name: "$scope",
      },
    };
  const copy = Object.fromEntries(
    Object.entries(node).map(([key, item]) => [key, normalize(item)]),
  ) as Record<string, any>;
  if (
    node.kind === "call" &&
    node.callee.kind === "identifier" &&
    node.callee.name === "instantiateEvalDeclarations"
  ) {
    copy.callee.name = "instantiateGlobalDeclarations";
    copy.arguments = [copy.arguments[0], copy.arguments[2]];
  }
  if (
    node.name === "$scope" &&
    node.initializer?.callee?.name === "createDeclarativeScope"
  )
    copy.initializer = copy.initializer.arguments[0];
  if (node.imported === "instantiateEvalDeclarations") {
    copy.imported = "instantiateGlobalDeclarations";
    copy.local = "instantiateGlobalDeclarations";
  }
  return copy;
}
for (const source of [
  "var v=1;let x=2;function f(){return x+v}f();",
  "class A{m(){return 1}}new A().m();",
  "function* g(){yield 1}g();",
  "if(true){function f(){return 1}}f();",
  "eval(x)?.y;",
  "var $evalLexical=1;$evalLexical;",
])
  test(
    "eval entry changes only declaration scope and effective identity: " +
      source,
    () => {
      const ordinary = lower(source, false),
        evaluated = lower(source);
      assert.deepEqual(
        syntaxShape(normalize(evaluated)),
        syntaxShape(ordinary),
      );
      const setup = calls(evaluated, "instantiateEvalDeclarations");
      assert.equal(setup.length, 1);
      assert.equal(calls(evaluated, "instantiateGlobalDeclarations").length, 0);
      assert.ok(
        evaluated.imports.some((x) =>
          x.bindings.some((y) => y?.imported === "instantiateEvalDeclarations"),
        ),
      );
      assert.ok(
        !evaluated.imports.some((x) =>
          x.bindings.some(
            (y) => y?.imported === "instantiateGlobalDeclarations",
          ),
        ),
      );
    },
  );
for (const [source, strict] of [
  ["'use strict';var x;", true],
  ["'use\\x20strict';var x;", false],
  ["function f(){'use strict'}var x;", false],
  ["var x;", false],
] as const)
  test("eval strict declaration mode: " + source, () => {
    const call = calls(lower(source), "instantiateEvalDeclarations")[0]!;
    const flag = call.arguments[3];
    assert.equal(flag?.kind, "boolean");
    if (flag?.kind === "boolean") assert.equal(flag.value, strict);
  });
test("eval entries retain direct-eval guards and early-error rejection", () => {
  assert.equal(calls(lower("eval(s);"), "callEvalCandidate").length, 1);
  const imported = lowering.lowerEvalScript(parsed('import("x");'));
  assert.ok(imported.ok);
  assert.equal(calls(imported.value, "evaluateImportCall").length, 1);
  const duplicate = lowering.lowerEvalScript(parsed("let a;let a;"));
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.error.code, "EARLY_ERROR");
});

function environments(source: string) {
  return calls(lower(source, false), "createDeclarativeEnvironment").length;
}
test("only sloppy direct-eval owners separate their body lexicals from vars", () => {
  assert.equal(
    environments("function f(){let x;eval(7)}"),
    environments("function f(){let x;void 7}") + 1,
  );
  assert.equal(
    environments('function f(){"use strict";let x;eval(7)}'),
    environments('function f(){"use strict";let x;void 7}'),
  );
  // With nothing else to declare, the body reuses the parameter scope.
  assert.equal(
    calls(
      lower("function f(){let x;eval(7)}", false),
      "instantiateFunctionBody",
    ).length,
    0,
  );
  const module = lower("function f(){var y;let x;eval(7)}", false);
  const plan = calls(module, "instantiateFunctionBody")[0]?.arguments[1];
  assert.equal(plan?.kind, "object");
  if (plan?.kind !== "object") return;
  const property = plan.properties.find(
    (p) => "name" in p && p.name === "lexical",
  );
  assert.ok(property !== undefined && "value" in property);
  assert.deepEqual(
    property.value.kind === "array" ? property.value.elements : undefined,
    [],
  );
});
test("sloppy parameter eval gets a variable record outside parameter bindings", () => {
  assert.equal(
    environments("function f(a=eval(7)){}"),
    environments("function f(a=7){}") + 1,
  );
  assert.equal(
    environments('"use strict";function f(a=eval(7)){}'),
    environments('"use strict";function f(a=7){}'),
  );
});
test("nested eval candidates split their own block-bodied arrow only", () => {
  assert.equal(
    environments("function f(){let x;return ()=>{let y;eval(7)}}"),
    environments("function f(){let x;return ()=>{let y;void 7}}") + 1,
  );
  for (const expression of ["eval?.(7)", "(0,eval)(7)"])
    assert.equal(
      environments("function f(){let x;" + expression + "}"),
      environments("function f(){let x;void 7}"),
    );
});
