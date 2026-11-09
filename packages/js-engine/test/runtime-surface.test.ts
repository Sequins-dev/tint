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
    sha256: "311682cec6c218712808f7b17c34281092ffe7ae41a41f6cb13c77aa203a3962",
  },
  {
    source:
      "var a=1;let b={x:a,get y(){return 1},[a]:2};for(var k in b){} delete b.x;delete missing;typeof zz;",
    sha256: "16b568512af2003731f25d28234c1f6c833d586983ad8bdfeed7c9186371d5a3",
  },
  {
    source:
      "class A{#p=1;static m(){return 1}get g(){return this.#p}}class B extends A{constructor(){super();this.q=super.g}}",
    sha256: "c4c3bb953827cee6605e40499d022d3b513fadb1be184c24930afd486ac44e03",
  },
  {
    source:
      "function* g(){yield 1;yield* [2]}async function f(){await 1;for await(const x of [2]){}}async function* h(){yield await 2}var arr=[...g()];",
    sha256: "fcf8deb7fa0da9982df48d5fe71938c768bad704bd6ee2f2f4df448f92f1e1fd",
  },
  {
    source:
      "with({}){x}try{throw 1}catch(e){}label:for(const x of [1]){break label}",
    sha256: "9c8815ddb7a99436226f03ae073e9fc90bd29e2782332d37e9e55394ceb43d3a",
  },
  {
    source:
      "function p(a,b=1,...c){return arguments.length}(()=>this)();new p();`a${1}`;tag`x`;",
    sha256: "17e8fe84fddd7591232013eb75bce89ca1af036b335c95f3af081572519bb350",
  },
  {
    source:
      "{using resource=null;}async function f(){await using resource=null;}",
    sha256: "a37cce410ba13ba2baae6e76c9ce1cf0b803a5a26797910db40d72ba6ba3729b",
  },
  {
    source:
      "if(true)function globalFn(){}function outer(){if(true)function inner(){};{function local(){}}for(let i=0;i<2;i++){(()=>i)();}}",
    sha256: "1e58335a01c8ee083c7ea886f1269207eaf45982dbe8821df4a1cbfdf4b0b703",
  },
  {
    source: "const pattern=/(?<name>x)/u;const number=1n;number+2n;",
    sha256: "af0e8595d40046e54aea79edb6368c230bdc7bd93e97d7eb2e974faae5b67927",
  },
];
test("managed Script surface declares fixed instantiations and preserves lowered output", () => {
  const surface = lowering.scriptRuntimeSurface();
  assert.equal(surface.length, 165);
  const names = new Map(surface.map((entry) => [entry.name, entry]));
  assert.equal(names.size, 165);
  assert.equal(
    surface.filter((entry) => entry.typeArguments.length > 0).length,
    44,
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
  assert.equal(seen.size, 28, [...seen].sort().join(","));
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
    "a34902767f4d9cdcaeb85bc9924d84117c90f7ce131d31e926f87e6e07f4c817",
  );
});
