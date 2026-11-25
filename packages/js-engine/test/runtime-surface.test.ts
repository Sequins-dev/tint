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
    sha256: "7d10295409ca6ba024cfc3d9130b921631773fd6fd20c49eaba79f610719d642",
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
    sha256: "3b7d8cfbe25602b799c4efaebfef7d331e1183baf3b2628ef5632ec028840578",
  },
  {
    source:
      "with({}){x}try{throw 1}catch(e){}label:for(const x of [1]){break label}",
    sha256: "b67a6601d237f35bd909fddb5d304e626f58c567c73844569e07841ce28a5c8f",
  },
  {
    source:
      "function p(a,b=1,...c){return arguments.length}(()=>this)();new p();`a${1}`;tag`x`;",
    sha256: "66b3c69e1060bcff86fa404ad10be913dc2bcb1266bf148a4efa8e85e1d3eb96",
  },
  {
    source:
      "{using resource=null;}async function f(){await using resource=null;}",
    sha256: "7336538dee2ec9934d03e90466ce729c9ce2a598ee70e2acc0c4c8d85a9b2fca",
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
  assert.equal(surface.length, 199);
  const names = new Map(surface.map((entry) => [entry.name, entry]));
  assert.equal(names.size, 199);
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
    "09aa3da747e7c8c8d037e92d7c4412bb763e170c45090ca7bd37080f270ad88e",
  );
});
