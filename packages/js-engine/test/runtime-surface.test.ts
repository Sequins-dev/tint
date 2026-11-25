import { syntaxShapeJSON } from "./syntax-shape.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createSourceTextView } from "@tint/source/text";
import {
  parseScript,
  rewriteModule,
  bindingIdentifiers,
} from "@tint/typescript/syntax";
import * as lowering from "../src/lowering/index.ts";
const corpus = [
  {
    // A `with` body keeps reference-based identifier callees (base object).
    source: "var o={m(){return this}};with(o){m();}",
    sha256: "ac4e3bd68cc78e93bea725f5f5a2a7be99bfea75a7cfaa4e48982019011cfaef",
  },
  {
    source:
      "var a=1;let b={x:a,get y(){return 1},[a]:2};for(var k in b){} delete b.x;delete missing;typeof zz;",
    sha256: "f27167950095c2a16ad2c7e48f0837909dd1439b9dfebd63693de5608ae2592a",
  },
  {
    source:
      "class A{#p=1;static m(){return 1}get g(){return this.#p}}class B extends A{constructor(){super();this.q=super.g}}",
    sha256: "c9a580d07b3e0efd43ec449095ae41766436c8b3600e3cd1a3755c1a1b7ac73a",
  },
  {
    source:
      "function* g(){yield 1;yield* [2]}async function f(){await 1;for await(const x of [2]){}}async function* h(){yield await 2}var arr=[...g()];",
    sha256: "13932c75a5e0f7a84eb7241a5b830c4ad721fbf2d69d4a6291cbf90114fd9c3e",
  },
  {
    source:
      "with({}){x}try{throw 1}catch(e){}label:for(const x of [1]){break label}",
    sha256: "b4b9dd7aaae589fceec3255394d185cfb50f7053817aa6906608c5b1526fb153",
  },
  {
    source:
      "function p(a,b=1,...c){return arguments.length}(()=>this)();new p();`a${1}`;tag`x`;",
    sha256: "cf3bde9bd5fed43da9d91bcbe25471eb9e2574ed531a973fc58310a16c5b8fec",
  },
  {
    source:
      "{using resource=null;}async function f(){await using resource=null;}",
    sha256: "327a724d59317df03e2b47c63e4091abd0794b3b32185d2f38dc189553579eae",
  },
  {
    source:
      "if(true)function globalFn(){}function outer(){if(true)function inner(){};{function local(){}}for(let i=0;i<2;i++){(()=>i)();}}",
    sha256: "a71b02004274f4cb0f0bf0bbde5befbebcb98cc798b47ea10f009938cc3185df",
  },
  {
    source: "const pattern=/(?<name>x)/u;const number=1n;number+2n;",
    sha256: "2244a13db89ca895c1ff90c9b4e57053831e9f69d43439b7b9cc2dc2c58d8d50",
  },
];
test("managed Script surface declares fixed instantiations and preserves lowered output", () => {
  const surface = lowering.scriptRuntimeSurface();
  assert.equal(surface.length, 210);
  const names = new Map(surface.map((entry) => [entry.name, entry]));
  assert.equal(names.size, 210);
  assert.equal(
    surface.filter((entry) => entry.typeArguments.length > 0).length,
    46,
  );
  assert.deepEqual(names.get("getIdentifierValue")?.typeArguments, [
    "ScriptPropertyKey",
    "unknown",
  ]);
  assert.deepEqual(names.get("throwIfRuntimeError")?.typeArguments, []);
  assert.deepEqual(names.get("runScriptContext")?.typeArguments, [
    "ScriptCompletionRecord",
  ]);
  assert.deepEqual(names.get("deleteBindingReference")?.typeArguments, [
    "ScriptPropertyKey",
    "unknown",
  ]);
  assert.deepEqual(names.get("setGlobalBinding")?.typeArguments, [
    "ScriptPropertyKey",
    "unknown",
  ]);
  assert.deepEqual(names.get("setMutableBinding")?.typeArguments, ["unknown"]);
  assert.deepEqual(names.get("getBindingValue")?.typeArguments, ["unknown"]);
  const seen = new Set<string>();
  for (const item of corpus) {
    const parsed = parseScript(createSourceTextView(item.source));
    assert.ok(parsed.ok, JSON.stringify(parsed));
    const result = lowering.lowerScript(parsed.value, item.source);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(
      createHash("sha256").update(syntaxShapeJSON(result.value)).digest("hex"),
      item.sha256,
      item.source,
    );
    rewriteModule(result.value, {
      type(type) {
        if (type.kind !== "named") return type;
        const entry = names.get(type.name);
        if (entry === undefined) return type;
        const arguments_ = (type.arguments ?? []).map((argument) => {
          assert.ok(argument.kind === "named");
          return argument.name;
        });
        assert.deepEqual(arguments_, entry.typeArguments, type.name);
        return type;
      },
      expression(expression) {
        if (
          expression.kind !== "call" ||
          expression.callee.kind !== "identifier"
        )
          return expression;
        const name = expression.callee.name,
          entry = names.get(name);
        if (entry === undefined) return expression;
        const arguments_ = (expression.typeArguments ?? []).map((type) => {
          assert.ok(type.kind === "named");
          return type.name;
        });
        assert.deepEqual(arguments_, entry.typeArguments, name);
        if (entry.typeArguments.length > 0) seen.add(name);
        return expression;
      },
    });
  }
  assert.equal(seen.size, 27, [...seen].sort().join(","));
});

test("Script entry receives host identity and derives its realm from that record", () => {
  const parsed = parseScript(createSourceTextView("var x=42;x;"));
  assert.ok(parsed.ok);
  const lowered = lowering.lowerScript(parsed.value, "var x=42;x;");
  assert.ok(lowered.ok);
  const entry = lowered.value.statements.find(
    (statement) =>
      statement.kind === "function" && statement.name === "execute",
  );
  assert.ok(entry?.kind === "function");
  const parameter = entry.parameters[1];
  assert.ok(parameter !== undefined && parameter.kind !== "pattern-parameter");
  assert.equal(parameter.name, "$script");
  const type = parameter.type;
  assert.ok(type?.kind === "named");
  assert.equal(type.name, "ScriptRecord");
  assert.ok(entry.body.kind === "block");
  const realm = entry.body.statements[0];
  assert.ok(realm?.kind === "variable");
  const pattern = realm.declarations[0];
  assert.ok(pattern);
  const identifiers = bindingIdentifiers(pattern),
    declaration = identifiers[0];
  assert.equal(identifiers.length, 1);
  assert.ok(declaration);
  assert.equal(declaration.name, "$errors");
  const initializer = declaration.initializer;
  assert.ok(initializer?.kind === "member");
  assert.equal(initializer.property, "realm");
  assert.ok(
    initializer.object.kind === "identifier" &&
      initializer.object.name === "$script",
  );
  let selfReferences = 0,
    recordReferences = 0;
  rewriteModule(lowered.value, {
    expression(expression) {
      if (expression.kind === "identifier" && expression.name === "execute")
        selfReferences++;
      if (expression.kind === "identifier" && expression.name === "$script")
        recordReferences++;
      return expression;
    },
  });
  assert.equal(selfReferences, 0);
  assert.ok(recordReferences >= 2);
  const imported = lowered.value.imports
    .flatMap((declaration) => declaration.bindings)
    .find((binding) => binding.imported === "ScriptRecord");
  assert.ok(imported?.typeOnly);
});

test("direct-eval sites keep a stable typed lowering contract", () => {
  const source =
    "function f(a){try{throw 1}catch(e){with({}){eval(a)}}}class D extends Object{constructor(){eval(7);super()}}";
  const parsed = parseScript(createSourceTextView(source));
  assert.ok(parsed.ok);
  const result = lowering.lowerScript(parsed.value, source);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(
    createHash("sha256").update(syntaxShapeJSON(result.value)).digest("hex"),
    "1aac2fd90e7d7ed68ce49ab53285cac94292646777a0978f26af912c9002ea98",
  );
});
