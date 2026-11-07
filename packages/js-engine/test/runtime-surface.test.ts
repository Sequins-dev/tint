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
    source:
      "var a=1;let b={x:a,get y(){return 1},[a]:2};for(var k in b){} delete b.x;delete missing;typeof zz;",
    sha256: "7c37346c2f2f6a719b7aebe9aa08025cb4a581e5efaa89d605ba4f088d33f178",
  },
  {
    source:
      "class A{#p=1;static m(){return 1}get g(){return this.#p}}class B extends A{constructor(){super();this.q=super.g}}",
    sha256: "79b349bb7c8f3bf2292dde0fadf21e3f302c219304b8ff6d0d2b04613b1967ee",
  },
  {
    source:
      "function* g(){yield 1;yield* [2]}async function f(){await 1;for await(const x of [2]){}}async function* h(){yield await 2}var arr=[...g()];",
    sha256: "1bb8cfd302f34f4e5b6f7f378c9b0beaceba0783c1eb3d1c6748202cf8182f6a",
  },
  {
    source:
      "with({}){x}try{throw 1}catch(e){}label:for(const x of [1]){break label}",
    sha256: "81f31b053a4c3d11e1d6e8532518a9a804dece87502fd00f23efd6802d9e9a24",
  },
  {
    source:
      "function p(a,b=1,...c){return arguments.length}(()=>this)();new p();`a${1}`;tag`x`;",
    sha256: "32e21776d3bed6248b3af2543bf71af066ee4b89c6a30912f88a17d1a14d53c4",
  },
  {
    source:
      "{using resource=null;}async function f(){await using resource=null;}",
    sha256: "efd6e976fa42705403a0ff65fe0f9c43710e402cbb9c7a9179d02c7133825a00",
  },
  {
    source:
      "if(true)function globalFn(){}function outer(){if(true)function inner(){};{function local(){}}for(let i=0;i<2;i++){(()=>i)();}}",
    sha256: "89cedb30d549a4440d03cd290bcd8172dc504182fc347f8639256952be33be75",
  },
  {
    source: "const pattern=/(?<name>x)/u;const number=1n;number+2n;",
    sha256: "2b883e8c818eba3a7d7007d05bcc74771da113d78c366b59ff9d2771dc65d2d3",
  },
];
test("managed Script surface declares fixed instantiations and preserves lowered output", () => {
  const surface = lowering.scriptRuntimeSurface();
  assert.equal(surface.length, 136);
  const names = new Map(surface.map((entry) => [entry.name, entry]));
  assert.equal(names.size, 136);
  assert.equal(
    surface.filter((entry) => entry.typeArguments.length > 0).length,
    41,
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
      createHash("sha256").update(JSON.stringify(result.value)).digest("hex"),
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
    createHash("sha256").update(JSON.stringify(result.value)).digest("hex"),
    "8b1139bfcc67e1e4b324cdac144c8df7aa7a208019fffb3693fd64af65bb535b",
  );
});
