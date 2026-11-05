import { test } from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { createSourceText } from "@tint/source/text";
import {
  parseScript,
  parseModule,
  rewriteModule,
} from "../src/syntax/index.ts";
function source(text: string) {
  const bytes = new TextEncoder().encode(text);
  const result = createSourceText(bytes, bytes.length);
  assert.ok(result.ok);
  return result.value;
}
for (const text of [
  'import("x");',
  '"import";',
  'import("x",);',
  'import("x", {with:{type:"json"}},);',
  "function f(){return import(name, options).then(f);}",
  'new (import("x"));',
])
  test(`import expression accepts ${text}`, () => {
    assert.doesNotThrow(() => new Script(text));
    const result = parseScript(source(text));
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.imports.length, 0);
  });
for (const text of [
  "import();",
  "import(...x);",
  'import("x", ...y);',
  'import("x",{},3);',
  'new import("x");',
  'import?.("x");',
  "import.meta;",
  "import.foo;",
  'import("x")=1;',
])
  test(`import expression rejects ${text}`, () => {
    assert.throws(() => new Script(text), SyntaxError);
    const result = parseScript(source(text));
    assert.equal(result.ok, false);
  });
test("import.meta is module-only, including nested functions", () => {
  for (const text of [
    "import.meta;",
    "function f(){return import.meta.url;}",
  ]) {
    const result = parseModule(source(text), "javascript");
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(parseScript(source(text)).ok, false);
  }
  for (const text of ["import.foo;", "import.m\\u0065ta;"])
    assert.equal(parseModule(source(text), "javascript").ok, false);
});
test("import arguments retain evaluation order through syntax rewriting", () => {
  const result = parseScript(source("import(specifier, options);"));
  assert.ok(result.ok, JSON.stringify(result));
  const names: string[] = [];
  const rewritten = rewriteModule(result.value, {
    expression(node) {
      if (node.kind === "identifier") names.push(node.name);
      return node;
    },
  });
  assert.deepEqual(names, ["specifier", "options"]);
  assert.deepEqual(rewritten.statements, result.value.statements);
});

test("deferred and source import calls preserve their phase", () => {
  for (const phase of ["defer", "source"]) {
    const result = parseScript(source(`import.${phase}(specifier, options);`));
    assert.ok(result.ok, JSON.stringify(result));
    const statement = result.value.statements[0];
    assert.equal(statement?.kind, "expression");
    if (statement?.kind !== "expression") return;
    const expression = statement.expression;
    assert.equal(expression.kind, "import-call");
    if (expression.kind !== "import-call") return;
    assert.equal(expression.phase, phase);
    assert.deepEqual(
      rewriteModule(result.value, {}).statements,
      result.value.statements,
    );
  }
});

test("static phased imports preserve namespace and source bindings", () => {
  for (const [text, phase, namespace] of [
    ['import defer * as ns from "x";', "defer", true],
    ['import source wasm from "x";', "source", false],
  ] as const) {
    const result = parseModule(source(text), "javascript");
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.imports[0]?.phase, phase);
    assert.equal(result.value.imports[0]?.bindings[0]?.namespace, namespace);
    assert.deepEqual(
      rewriteModule(result.value, {}).imports,
      result.value.imports,
    );
  }
  for (const text of [
    'import defer x from "x";',
    'import source * as ns from "x";',
    'import source {x} from "x";',
  ])
    assert.equal(parseModule(source(text), "javascript").ok, false);
  for (const text of ['import defer from "x";', 'import source from "x";']) {
    const result = parseModule(source(text), "javascript");
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.imports[0]?.phase, undefined);
  }
});
