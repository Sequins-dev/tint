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
    sha256: "68a5b33ecbe2a5e6d9f501cc7447c07afac270393d7a652c485f3bf4056e8d63",
  },
  {
    source:
      "var a=1;let b={x:a,get y(){return 1},[a]:2};for(var k in b){} delete b.x;delete missing;typeof zz;",
    sha256: "c40bb531c0f5502fce4c4ff7043b73f1317e83739a61790944fb2e40e4f00cb0",
  },
  {
    source:
      "class A{#p=1;static m(){return 1}get g(){return this.#p}}class B extends A{constructor(){super();this.q=super.g}}",
    sha256: "56e806869be53c1f38861743bae59886e62c7b6d06689365b65bd1ca723632b1",
  },
  {
    source:
      "function* g(){yield 1;yield* [2]}async function f(){await 1;for await(const x of [2]){}}async function* h(){yield await 2}var arr=[...g()];",
    sha256: "5dc8e79f28f5c8b16597131c333a19074d69951270d645ddb3a2f00915e04c20",
  },
  {
    source:
      "with({}){x}try{throw 1}catch(e){}label:for(const x of [1]){break label}",
    sha256: "e8a140858de8d2c0fe78d9346021c0b35b3b93f2a42c3d2e46ecc73f6680d76f",
  },
  {
    source:
      "function p(a,b=1,...c){return arguments.length}(()=>this)();new p();`a${1}`;tag`x`;",
    sha256: "8b71545c6be6381d564147ba597b4b1e42b0540985412340204a58755e834430",
  },
  {
    source:
      "{using resource=null;}async function f(){await using resource=null;}",
    sha256: "b2afef50795991f44bb3ef434e75d1fc96ec057136ad118199d3f21dabb9e6a9",
  },
  {
    source:
      "if(true)function globalFn(){}function outer(){if(true)function inner(){};{function local(){}}for(let i=0;i<2;i++){(()=>i)();}}",
    sha256: "41a3ed5937a1f99edc5400bf17721df1acc7a7b6369c6e5eb2cfe2a81cc5947b",
  },
  {
    source: "const pattern=/(?<name>x)/u;const number=1n;number+2n;",
    sha256: "a48c8597375c4e3dabed9c815eb2c5d9d8385c349f266b4326c713f5591a4f14",
  },
];
test("managed Script surface declares fixed instantiations and preserves lowered output", () => {
  const surface = lowering.scriptRuntimeSurface();
  assert.equal(surface.length, 178);
  const names = new Map(surface.map((entry) => [entry.name, entry]));
  assert.equal(names.size, 178);
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
    "a0378e6492228ecdd195ce846402ebcc1fc289a7714d013702a08ba82215cb46",
  );
});
