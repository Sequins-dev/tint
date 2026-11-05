import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { bindModule } from "@tint/typescript/binding";
import { linkModules } from "../src/modules/index.ts";
import type { SourceModule } from "@tint/typescript/modules/model";
function input(
  id: string,
  text: string,
  dependencies: readonly [string, string][] = [],
): SourceModule {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return { id, module: parsed.value, dependencies: new Map(dependencies) };
}
test("class exports share value/type identity while preserving the inner class name", () => {
  const dep = input(
    "dep",
    "export class Box<T>{value:T;constructor(value:T){this.value=value;}self():Box<T>{return this;}}",
  );
  const main = input(
    "main",
    'import {Box as Item} from "dep";export function make(value:number):Item<number>{return new Item<number>(value);}',
    [["dep", "dep"]],
  );
  const linked = linkModules([main, dep], "main", [], {
    evaluation: "instance",
  });
  assert.ok(linked.ok, JSON.stringify(linked));
  const exports = linked.value.exports.filter(
    (e) => e.module === "dep" && e.name === "Box",
  );
  assert.deepEqual(exports.map((e) => e.namespace).sort(), ["type", "value"]);
  assert.equal(exports[0]?.linkedName, exports[1]?.linkedName);
  const cls = linked.value.module.statements.find((s) => s.kind === "class");
  assert.ok(cls?.kind === "class");
  assert.equal(cls.name, exports[0]?.linkedName);
  assert.notEqual(cls.definition.name, cls.name);
  const method = cls.definition.elements.find(
    (e) =>
      e.kind === "method" && e.key.kind === "string" && e.key.value === "self",
  );
  assert.ok(method?.kind === "method");
  assert.equal(method.returnType?.kind, "named");
  if (method.returnType?.kind === "named")
    assert.equal(method.returnType.name, cls.definition.name);
  const make = linked.value.module.statements.find(
    (s) => s.kind === "function",
  );
  assert.ok(make?.kind === "function");
  assert.equal(make.returnType?.kind, "named");
  if (make.returnType?.kind === "named")
    assert.equal(make.returnType.name, cls.name);
  const bound = bindModule(linked.value.module);
  assert.ok(bound.ok, JSON.stringify(bound));
  assert.equal(
    linked.value.origins.get(cls.definition)?.node,
    dep.module.statements[0]?.kind === "class"
      ? dep.module.statements[0].definition
      : undefined,
  );
});
test("block classes shadow outer generic type names only within their lexical scope", () => {
  const main = input(
    "main",
    "function run<T>(input:T):T{class T{self(x:T):T{return x;}}let local:T;return input;}",
  );
  const linked = linkModules([main], "main", []);
  assert.ok(linked.ok, JSON.stringify(linked));
  const fn = linked.value.module.statements[0];
  assert.ok(fn?.kind === "function" && fn.body.kind === "block");
  assert.equal(fn.returnType?.kind === "named" && fn.returnType.name, "T");
  const cls = fn.body.statements[0],
    variable = fn.body.statements[1];
  assert.ok(cls?.kind === "class" && variable?.kind === "variable");
  const annotation = variable.declarations[0]?.type;
  assert.equal(annotation?.kind === "named" && annotation.name, cls.name);
  const self = cls.definition.elements[0];
  assert.ok(self?.kind === "method");
  assert.equal(
    self.returnType?.kind === "named" && self.returnType.name,
    cls.definition.name,
  );
  assert.ok(bindModule(linked.value.module).ok);
});
test("named class expressions isolate their type names and retain member source origins", () => {
  const main = input(
    "main",
    "class Outer{}function run(){const C=class Outer{self(x:Outer):Outer{return x;}};let outside:Outer;}",
  );
  const linked = linkModules([main], "main", [], { evaluation: "instance" });
  assert.ok(linked.ok, JSON.stringify(linked));
  const outer = linked.value.module.statements[0],
    fn = linked.value.module.statements[1];
  assert.ok(
    outer?.kind === "class" &&
      fn?.kind === "function" &&
      fn.body.kind === "block",
  );
  const declaration = fn.body.statements[0];
  assert.ok(declaration?.kind === "variable");
  const expression = declaration.declarations[0]?.initializer;
  assert.ok(expression?.kind === "class-expression");
  const self = expression.definition.elements[0];
  assert.ok(self?.kind === "method");
  assert.equal(
    self.returnType?.kind === "named" && self.returnType.name,
    expression.definition.name,
  );
  const outside = fn.body.statements[1];
  assert.ok(outside?.kind === "variable");
  const annotation = outside.declarations[0]?.type;
  assert.equal(annotation?.kind === "named" && annotation.name, outer.name);
  assert.equal(linked.value.origins.get(self)?.module, "main");
  assert.ok(bindModule(linked.value.module).ok);
});
test("class definitions require module evaluation and type-only bodies are never executed accidentally", () => {
  const dep = input("dep", "export class C{}");
  assert.equal(linkModules([dep], "dep", []).ok, false);
  const main = input(
    "main",
    'import type {C} from "dep";function f(x:C):C{return x;}',
    [["dep", "dep"]],
  );
  const linked = linkModules([main, dep], "main", [], {
    evaluation: "instance",
  });
  assert.ok(!linked.ok);
  assert.match(linked.error.message, /type-only class/);
});
test("switch clauses share class type names without changing the surrounding scope", () => {
  const main = input(
    "main",
    "function run<T>(input:T):T{switch(0){case 0:let before:T;break;default:class T{}let after:T;}let outside:T;return input;}",
  );
  const linked = linkModules([main], "main", []);
  assert.ok(linked.ok, JSON.stringify(linked));
  const fn = linked.value.module.statements[0];
  assert.ok(fn?.kind === "function" && fn.body.kind === "block");
  const sw = fn.body.statements[0],
    outside = fn.body.statements[1];
  assert.ok(sw?.kind === "switch" && outside?.kind === "variable");
  const cls = sw.clauses[1]?.statements[0];
  assert.ok(cls?.kind === "class");
  for (const declaration of [
    sw.clauses[0]?.statements[0],
    sw.clauses[1]?.statements[1],
  ]) {
    assert.ok(declaration?.kind === "variable");
    const annotation = declaration.declarations[0]?.type;
    assert.equal(annotation?.kind === "named" && annotation.name, cls.name);
  }
  const annotation = outside.declarations[0]?.type;
  assert.equal(annotation?.kind === "named" && annotation.name, "T");
  assert.ok(bindModule(linked.value.module).ok);
});
