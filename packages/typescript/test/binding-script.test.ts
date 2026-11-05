import { test } from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { createSourceText } from "@tint/source/text";
import { parseStrictScript } from "@tint/typescript/syntax";
import * as binding from "../src/binding/index.ts";
function declarations(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseStrictScript(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return binding.collectStrictScriptDeclarations(parsed.value);
}
test("catch patterns bind defaults locally and reject var redeclarations", () => {
  for (const text of [
    "try{}catch({x,x}){}",
    "try{}catch([x,x]){}",
    "try{}catch([x]){var x;}",
    "try{}catch({x}){var x;}",
    "try{}catch({x}){{var x;}}",
    "try{}catch({x}){let x;}",
  ]) {
    const bytes = new TextEncoder().encode(text);
    const source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const parsed = parseStrictScript(source.value);
    assert.ok(parsed.ok, JSON.stringify(parsed));
    const result = binding.bindStrictScript(parsed.value);
    assert.equal(result.ok, false, text);
    if (!result.ok) assert.equal(result.error.code, "DUPLICATE_NAME");
  }
  const bytes = new TextEncoder().encode("try{}catch({x=1,y=x}){(()=>y)();}");
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseStrictScript(source.value);
  assert.ok(parsed.ok);
  const result = binding.bindStrictScript(parsed.value);
  assert.ok(result.ok, JSON.stringify(result));
  assert.ok(result.value.references.every((r) => r.binding !== undefined));
});
test("object parameter expressions bind before body locals and preserve var copies", () => {
  const text = "let outer=42;function f({x=outer,y=()=>x}){var x;return y;}";
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseStrictScript(source.value);
  assert.ok(parsed.ok);
  const result = binding.bindStrictScript(parsed.value);
  assert.ok(result.ok, JSON.stringify(result));
  const x = result.value.bindings.filter((b) => b.name === "x");
  assert.equal(x.length, 2);
  assert.deepEqual(
    x.map((b) => b.kind),
    ["parameter", "var"],
  );
  assert.ok(
    result.value.functions.some((f) => f.parameterCopies?.length === 1),
  );
  assert.ok(result.value.references.every((r) => r.binding !== undefined));
});
test("object assignment targets record writes while keys and defaults remain reads", () => {
  const bytes = new TextEncoder().encode(
    "let x,k,d,source;({[k]:x=d}=source);",
  );
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseStrictScript(source.value);
  assert.ok(parsed.ok);
  const result = binding.bindStrictScript(parsed.value);
  assert.ok(result.ok, JSON.stringify(result));
  const accesses = result.value.references.map((r) => [
    r.node.kind === "identifier" ? r.node.name : "",
    r.access,
  ]);
  assert.deepEqual(accesses, [
    ["k", "read"],
    ["x", "write"],
    ["d", "read"],
    ["source", "read"],
  ]);
});
test("Script declaration collection separates global lexical, var and function names", () => {
  assert.equal(typeof binding.collectStrictScriptDeclarations, "function");
  const result = declarations(
    "let a; const b=1; var v; function f() { var hidden; } function f() {}",
  );
  assert.deepEqual(
    result.lexical.map((d) => [d.name, d.constant]),
    [
      ["a", false],
      ["b", true],
    ],
  );
  assert.deepEqual(result.variables, ["v"]);
  assert.deepEqual(
    result.functions.map((d) => d.name),
    ["f", "f"],
  );
});
test("Script var collection traverses control flow but stops at function boundaries", () => {
  const result = declarations(`
 { let local; var block; function inner() { var hidden; } }
 if (true) { var branch; } else { var alternative; }
 for (var index=0;index<1;index++) { var loop; }
 for (let local=0;local<1;local++) { var loopBody; }
 for (var item of items) { var itemBody; }
 while (false) { var whileBody; }
 do { var doBody; } while (false);
 try { var tried; } catch (error) { var caught; } finally { var finalized; }
 switch (0) { case 0: var switched; break; default: var fallback; }
 const arrow=()=>{var hiddenArrow;};
 `);
  assert.deepEqual(result.variables, [
    "block",
    "branch",
    "alternative",
    "index",
    "loop",
    "loopBody",
    "item",
    "itemBody",
    "whileBody",
    "doBody",
    "tried",
    "caught",
    "finalized",
    "switched",
    "fallback",
  ]);
  assert.deepEqual(
    result.lexical.map((d) => d.name),
    ["arrow"],
  );
  assert.equal(result.functions.length, 0);
});
test("Script var collection extracts every supported iteration pattern name", () => {
  const result = declarations("for (var [key,value] of entries) { var x; }");
  assert.deepEqual(result.variables, ["key", "value", "x"]);
});
function bind(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseStrictScript(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return binding.bindStrictScript(parsed.value);
}
test("object patterns declare every leaf and visit computed keys and defaults", () => {
  const text = "let {x, y:z=fallback, [key()]:{deep=other}, ...rest}=source;";
  const plan = declarations(text);
  assert.deepEqual(
    plan.lexical.map((d) => d.name),
    ["x", "z", "deep", "rest"],
  );
  const result = bind(text);
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(
    result.value.references
      .filter((r) => r.global !== undefined)
      .map((r) => r.global),
    ["source", "fallback", "key", "other"],
  );
  assert.equal(bind("let {x, y:x}=source;").ok, false);
  assert.equal(bind("function f(x){let {x}=source;}").ok, false);
  assert.ok(bind("var {x, y:x}=source;").ok);
  const captured = bind("function f(){let {x=42}={};return ()=>x;}");
  assert.ok(captured.ok);
  assert.ok(captured.value.bindings.some((b) => b.name === "x" && b.captured));
});
test("Script binding preserves unresolved global references for runtime resolution", () => {
  assert.equal(typeof binding.bindStrictScript, "function");
  const result = bind(
    "let local=1; external(local); missing=2; typeof absent; this;",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.scopes[0]?.kind, "script");
  assert.deepEqual(
    result.value.references
      .filter((r) => r.global !== undefined)
      .map((r) => [r.global, r.access]),
    [
      ["external", "read"],
      ["missing", "write"],
      ["absent", "read"],
    ],
  );
  assert.equal(result.value.receiverReferences[0]?.owner, undefined);
});
test("Script binding defers immutable writes to runtime and aliases duplicate global functions", () => {
  const result = bind(
    "const x=1; x=2; function f(){} function f(){} var f; f();",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.bindings.filter((b) => b.name === "f").length, 1);
  assert.equal(result.value.functions.length, 2);
  const written = result.value.references.find((r) => r.access === "write");
  assert.ok(written?.binding !== undefined);
  assert.equal(result.value.bindings[written.binding]?.mutable, false);
});
test("Script binding retains lexical redeclaration errors", () => {
  for (const text of [
    "let x; var x;",
    "let f; function f(){}",
    "{function f(){} function f(){}}",
  ]) {
    const result = bind(text);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "DUPLICATE_NAME");
  }
});

test("strict function bodies share duplicate function bindings, unlike lexical blocks", () => {
  for (const text of [
    "function outer(){function f(){return 1;} function f(){return 2;} return f();}",
    "const outer=()=>{function f(){} function f(){} return f;};",
    "const outer=function(){function f(){} var f; function f(){} return f;};",
  ]) {
    assert.doesNotThrow(() => new Script('"use strict"; ' + text));
    const result = bind(text);
    assert.ok(result.ok, JSON.stringify(result));
    const functions = result.value.bindings.filter((b) => b.name === "f");
    assert.equal(functions.length, 1);
    const declaration = functions[0]!;
    assert.equal(declaration.kind, "function");
    assert.equal(result.value.scopes[declaration.scope]?.kind, "function");
    const declarations = result.value.functions.filter(
      (f) => f.parent === declaration.owner,
    );
    assert.equal(declarations.length, 2);
    assert.equal(declaration.node, declarations[1]?.node);
    assert.ok(
      result.value.aliases?.some(
        (alias) =>
          alias.node === declarations[0]?.node &&
          alias.binding === declaration.id,
      ),
    );
  }
  for (const text of [
    "function outer(){{function f(){} function f(){}}}",
    "function outer(){let f; function f(){}}",
    "function outer(){function f(){} const f=1;}",
  ]) {
    assert.throws(() => new Script('"use strict"; ' + text), SyntaxError);
    const result = bind(text);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "DUPLICATE_NAME");
  }
});

test("parameter-default closures capture parameters independently of body var bindings", () => {
  const text = "function f(a=1, read=()=>a){var a=2; return read();} f();";
  assert.equal(new Script('"use strict"; ' + text).runInNewContext(), 1);
  const result = bind(text);
  assert.ok(result.ok, JSON.stringify(result));
  const parameters = result.value.bindings.filter((b) => b.name === "a");
  assert.equal(parameters.length, 2);
  const parameter = parameters.find((b) => b.kind === "parameter")!;
  const local = parameters.find((b) => b.kind === "var")!;
  assert.notEqual(parameter.scope, local.scope);
  assert.equal(parameter.owner, local.owner);
  const captured = result.value.functions[1]?.captures;
  assert.ok(captured?.some((capture) => capture.binding === parameter.id));
  assert.ok(!captured?.some((capture) => capture.binding === local.id));
  assert.deepEqual(result.value.functions[0]?.parameterCopies, [
    { source: parameter.id, target: local.id },
  ]);
});

test("separate parameter environments still reject body lexical redeclarations", () => {
  for (const text of [
    "function f(a=1){let a;}",
    "function f(a=1){const a=2;}",
  ]) {
    assert.throws(() => new Script('"use strict"; ' + text), SyntaxError);
    const result = bind(text);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "DUPLICATE_NAME");
  }
});

test("body functions override parameter copies without changing default closure captures", () => {
  const text =
    "function f(a=1, read=()=>a){function a(){return 2;} return read();} f();";
  assert.equal(new Script('"use strict"; ' + text).runInNewContext(), 1);
  const result = bind(text);
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.value.functions[0]?.parameterCopies, []);
  const parameter = result.value.bindings.find(
    (b) => b.name === "a" && b.kind === "parameter",
  )!;
  const declaration = result.value.bindings.find(
    (b) => b.name === "a" && b.kind === "function",
  )!;
  assert.notEqual(parameter.id, declaration.id);
  assert.ok(
    result.value.functions[1]?.captures.some((c) => c.binding === parameter.id),
  );
});

test("simple parameters share their binding with body function declarations", () => {
  const text = "function f(a){function a(){return 42;} return a();} f(1);";
  assert.equal(new Script('"use strict"; ' + text).runInNewContext(), 42);
  const result = bind(text);
  assert.ok(result.ok, JSON.stringify(result));
  const named = result.value.bindings.filter((b) => b.name === "a");
  assert.equal(named.length, 1);
  assert.equal(named[0]?.kind, "function");
  assert.equal(result.value.functions[0]?.parameterCopies, undefined);
  assert.ok(result.value.aliases?.some((a) => a.binding === named[0]?.id));
});

test("catch var declarations hoist but initializers target the catch binding", () => {
  const text =
    "var e=1; var observed; try{throw 2;}catch(e){var e=3; observed=e;} e+observed;";
  assert.equal(new Script('"use strict"; ' + text).runInNewContext(), 4);
  const result = bind(text);
  assert.ok(result.ok, JSON.stringify(result));
  const outer = result.value.bindings.find(
    (b) => b.name === "e" && b.kind === "var",
  )!;
  const caught = result.value.bindings.find(
    (b) => b.name === "e" && b.kind === "catch",
  )!;
  assert.notEqual(outer.id, caught.id);
  const targets = result.value.varInitializerTargets;
  assert.equal(targets?.length, 1);
  assert.equal(targets?.[0]?.binding, caught.id);
  assert.ok(
    result.value.aliases?.some(
      (a) => a.node === targets?.[0]?.node && a.binding === outer.id,
    ),
  );
});

test("catch var initializer targets apply to nested iteration without hiding lexical conflicts", () => {
  const result = bind(
    "var e; try{}catch(e){for(var e of [1]){} for(var e=2;e<3;e++){} }",
  );
  assert.ok(result.ok, JSON.stringify(result));
  const caught = result.value.bindings.find((b) => b.kind === "catch")!;
  assert.equal(result.value.varInitializerTargets?.length, 2);
  assert.ok(
    result.value.varInitializerTargets?.every(
      (target) => target.binding === caught.id,
    ),
  );
  for (const text of [
    "let e; try{}catch(e){var e;}",
    "try{}catch(e){{let e; var e;}}",
  ]) {
    assert.throws(() => new Script('"use strict"; ' + text), SyntaxError);
    const bad = bind(text);
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.error.code, "DUPLICATE_NAME");
  }
});

test("Script binding shares sloppy duplicate parameters but keeps lexical conflicts", async () => {
  const { parseScript } = await import("@tint/typescript/syntax");
  assert.equal(typeof binding.bindScript, "function");
  function bind(text: string) {
    const bytes = new TextEncoder().encode(text),
      source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const parsed = parseScript(source.value);
    assert.ok(parsed.ok, JSON.stringify(parsed));
    return binding.bindScript(parsed.value);
  }
  const result = bind("function f(a,a){return a;}");
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(
    result.value.bindings.filter(
      (b) => b.kind === "parameter" && b.name === "a",
    ).length,
    1,
  );
  assert.equal(result.value.aliases?.length, 1);
  assert.equal(bind("function f(a,a){let a;}").ok, false);
  const annex = bind("{function f(){}}");
  assert.ok(annex.ok);
  assert.equal(annex.value.annexFunctionCopies?.[0]?.name, "f");
});
test("named expressions isolate their immutable self binding from parameters and outer names", () => {
  const bytes = new TextEncoder().encode(
      "let f=function self(x=self){return ()=>self;}; self;",
    ),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseStrictScript(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const result = binding.bindStrictScript(parsed.value);
  assert.ok(result.ok, JSON.stringify(result));
  const self = result.value.bindings.find((b) => b.name === "self");
  assert.ok(self);
  assert.equal(self.mutable, false);
  const references = result.value.references.filter(
    (r) => r.node.kind === "identifier" && r.node.name === "self",
  );
  assert.deepEqual(
    references.map((r) => r.binding),
    [self.id, self.id, undefined],
  );
  const typed = binding.bindModule(parsed.value);
  assert.equal(typed.ok, false);
  if (!typed.ok) assert.equal(typed.error.code, "UNSUPPORTED");
});
test("for-in lexical heads reject duplicate names and body var conflicts", () => {
  for (const text of [
    "for (const [x,x] in {}) {}",
    "for (let [x,x] in {}) {}",
    "for (const x in {}) {var x;}",
    "for (let x in {}) {var x;}",
    "for (const {x,x} in {}) {}",
    "for (let {x} in {}) {var x;}",
    "for (const {x,x} of []) {}",
    "for (let {x} of []) {var x;}",
  ]) {
    const bytes = new TextEncoder().encode(text),
      source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const parsed = parseStrictScript(source.value);
    assert.ok(parsed.ok, JSON.stringify(parsed));
    const bound = binding.bindStrictScript(parsed.value);
    assert.equal(bound.ok, false, text);
    if (!bound.ok) assert.equal(bound.error.code, "DUPLICATE_NAME");
  }
});

test("generator and async redeclarations obey lexical block and module scopes", async () => {
  const { parseScript, parseModule } = await import("@tint/typescript/syntax");
  for (const [text, moduleGoal] of [
    ["{ function*g(){} let g; }", false],
    ["{ async function f(){} let f; }", false],
    ["{ async function f(){} var f; }", false],
    [
      "switch(1){case 1:async function f(){};case 2:async function f(){};}",
      false,
    ],
    ["async function f(x){let x;}", false],
    ["const f=async (x)=>{let x;};", false],
    ["var f;async function f(){}", true],
    ["{ function*g(){} var g; }", false],
    ["switch(1){case 1:function*g(){};case 2:function*g(){};}", false],
    ["var g;function*g(){}", true],
    ["function*g(){}var g;", true],
    ["var f;function f(){}", true],
  ] as const) {
    const bytes = new TextEncoder().encode(text);
    const source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const parsed = moduleGoal
      ? parseModule(source.value, "javascript")
      : parseScript(source.value);
    assert.ok(parsed.ok, text);
    const bound = moduleGoal
      ? binding.bindModule(parsed.value)
      : binding.bindScript(parsed.value);
    assert.equal(bound.ok, false, text);
    if (!bound.ok) assert.equal(bound.error.code, "DUPLICATE_NAME", text);
  }
  for (const text of [
    "{function*g(){yield 1;} g;}",
    "{async function f(){return 1;} f;}",
    "var f;async function f(){}",
    "var g;function*g(){}",
    "function*g(){}var g;",
  ]) {
    const bytes = new TextEncoder().encode(text);
    const source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const parsed = parseScript(source.value);
    assert.ok(parsed.ok);
    const bound = binding.bindScript(parsed.value);
    assert.ok(bound.ok, JSON.stringify(bound));
  }
});

test("regexp bodies do not introduce identifier references", () => {
  const bytes = new TextEncoder().encode(
    "const pattern=/identifier/g; pattern;",
  );
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseStrictScript(source.value);
  assert.ok(parsed.ok);
  const result = binding.bindStrictScript(parsed.value);
  assert.ok(result.ok);
  assert.equal(result.value.references.length, 1);
});

test("sloppy conditional functions use synthetic lexical blocks and Annex B copies", async () => {
  const { parseScript } = await import("@tint/typescript/syntax");
  for (const text of [
    "if(true)function f(){}",
    "var f=0;if(true)function f(){}",
    "if(false)function f(){}else function g(){}",
  ]) {
    assert.doesNotThrow(() => new Script(text));
    const bytes = new TextEncoder().encode(text),
      source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const parsed = parseScript(source.value);
    assert.ok(parsed.ok, JSON.stringify(parsed));
    assert.equal(
      binding.validateJavaScriptBindings(parsed.value, "script"),
      undefined,
    );
    const result = binding.bindScript(parsed.value);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(
      result.value.annexFunctionCopies?.length,
      text.includes("else") ? 2 : 1,
    );
  }
});
