import { test } from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { createSourceText } from "@tint/source/text";
import {
  parseScript,
  parseModule,
  rewriteModule,
} from "@tint/typescript/syntax";
function parse(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  return parseScript(source.value);
}
for (const source of [
  "async function f(){return 42;}",
  "async function f(a,a){}",
  "(async function f(a,a){})",
  "let f=async function(){return 42;};",
  "let f=async function named(){return named;};",
  "async function await(){}",
  "async function f(){function g(await){return await;}return g(42);}",
  "async function f(){return ()=>await;}",
  "async function f(){class C{x=await;m(await){return await;}}}",
])
  test(`async function grammar accepts ${source}`, () => {
    assert.doesNotThrow(() => new Script(source));
    const result = parse(source);
    assert.ok(result.ok, JSON.stringify(result));
    const flags: boolean[] = [];
    rewriteModule(result.value, {
      statement(node) {
        if (node.kind === "function") flags.push(node.async === true);
        return node;
      },
      expression(node) {
        if (node.kind === "function-expression")
          flags.push(node.async === true);
        return node;
      },
    });
    assert.ok(flags.includes(true));
  });
for (const source of [
  'async function f(a,a){"use strict";}',
  '(async function f(a,a){"use strict";})',
  "async function f(await){}",
  "async function f(){let await;}",
  "(async function await(){})",
  "async function f(){function await(){}}",
  "async function f(){(await)=>1;}",
  "async function f(x=await 1){}",
  "async function f(){let aw\\u0061it;}",
])
  test(`async grammar rejects ${source}`, () => {
    assert.throws(() => new Script(source), SyntaxError);
    const result = parse(source);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "SYNTAX_ERROR");
  });
test("async prefix requires literal spelling and no line terminator", () => {
  const result = parse("async\nfunction f(){}");
  assert.ok(result.ok);
  assert.equal(result.value.statements[0]?.kind, "expression");
  const fn = result.value.statements[1];
  assert.ok(fn?.kind === "function");
  assert.notEqual(fn.async, true);
  assert.equal(parse("as\\u0079nc function f(){}").ok, false);
});

for (const source of [
  "const f=async x=>x;",
  "const f=async (x)=>{return x;};",
  "const f=async ()=>42;",
  "const f=async ({x},...rest)=>x;",
  "async function f(){return async x=>x;}",
])
  test(`async arrow grammar accepts ${source}`, () => {
    assert.doesNotThrow(() => new Script(source));
    const result = parse(source);
    assert.ok(result.ok, JSON.stringify(result));
    let found = false;
    rewriteModule(result.value, {
      expression(node) {
        if (node.kind === "arrow" && node.async) found = true;
        return node;
      },
    });
    assert.ok(found);
  });
for (const source of [
  "const f=async await=>1;",
  "const f=async (await)=>1;",
  "const f=async (x=await 1)=>x;",
  "const f=async (x,x)=>x;",
  "const f=async x\n=>x;",
  "const f=as\\u0079nc x=>x;",
])
  test(`async arrow grammar rejects ${source}`, () => {
    assert.throws(() => new Script(source), SyntaxError);
    assert.equal(parse(source).ok, false);
  });
test("async call expressions retain ordinary identifier semantics", () => {
  for (const source of [
    "async(42);",
    "x?async(42):19;",
    "async=>async;",
    "async\n(x=>x);",
  ]) {
    assert.doesNotThrow(() => new Script(source));
    const result = parse(source);
    assert.ok(result.ok, JSON.stringify(result));
    rewriteModule(result.value, {
      expression(node) {
        if (node.kind === "arrow") assert.notEqual(node.async, true);
        return node;
      },
    });
  }
});

test("async arrows preserve typed return annotations and conditional colons", () => {
  for (const text of [
    "const f=async (x:number):number=>x;",
    "const f=b?async (x:number):number=>x:g;",
    "const f=b?async(x):g;",
  ]) {
    const bytes = new TextEncoder().encode(text),
      source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const result = parseModule(source.value);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

for (const source of [
  "({async f(x){return x;}});",
  "({async ['f'](){return super.x;}});",
  "({async get(){return 42;}});",
  "class C{async f(){return 42;}static async g(){return 19;}}",
  "class C{async #f(){return 42;}g(){return this.#f();}}",
  "class C{static async constructor(){return 42;}}",
])
  test(`async method grammar accepts ${source}`, () => {
    assert.doesNotThrow(() => new Script(source));
    const result = parse(source);
    assert.ok(result.ok, JSON.stringify(result));
    let found = false;
    rewriteModule(result.value, {
      statement(node) {
        if (node.kind === "class")
          found ||= node.definition.elements.some(
            (e) => e.kind === "method" && e.async === true,
          );
        return node;
      },
      expression(node) {
        if (node.kind === "function-expression" && node.async) found = true;
        return node;
      },
    });
    assert.ok(found);
  });
for (const source of [
  "({async f(a,a){}});",
  "({async f(await){}});",
  "({async\nf(){}});",
  "class C{async constructor(){}}",
  "class C{async f(await){}}",
  "class C{async f(x=await 1){}}",
  "class C{async x=1;}",
  "class C{get async f(){}}",
])
  test(`async method grammar rejects ${source}`, () => {
    assert.throws(() => new Script(source), SyntaxError);
    const result = parse(source);
    assert.equal(result.ok, false);
  });
test("async remains an ordinary method or field name without a modifier", () => {
  for (const source of [
    "({async(){return 1;},async:42});",
    "class C{async(){return 42;}}",
    "class C{async\nf(){return 42;}}",
  ]) {
    assert.doesNotThrow(() => new Script(source));
    const result = parse(source);
    assert.ok(result.ok, JSON.stringify(result));
    rewriteModule(result.value, {
      statement(node) {
        if (node.kind === "class")
          for (const e of node.definition.elements)
            if (e.kind === "method") assert.notEqual(e.async, true);
        return node;
      },
      expression(node) {
        if (node.kind === "function-expression")
          assert.notEqual(node.async, true);
        return node;
      },
    });
  }
});

for (const source of [
  "async function f(){return await 42;}",
  "async function f(){return await await 42;}",
  "const f=async x=>await x;",
  "({async f(){return 1+await 41;}});",
  "class C{async f(){return await\n42;}}",
])
  test(`await grammar accepts ${source}`, () => {
    assert.doesNotThrow(() => new Script(source));
    const result = parse(source);
    assert.ok(result.ok, JSON.stringify(result));
    let found = false;
    rewriteModule(result.value, {
      expression(node) {
        if (node.kind === "await") found = true;
        return node;
      },
    });
    assert.ok(found);
  });
for (const source of [
  "async function f(){await;}",
  "async function f(){return await 2 ** 3;}",
  "async function f(){new await 42;}",
  "async function f(){await 1=42;}",
])
  test(`await grammar rejects ${source}`, () => {
    assert.throws(() => new Script(source), SyntaxError);
    const result = parse(source);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "SYNTAX_ERROR");
  });

for (const source of [
  "async function* f(){yield await 42; return 19;}",
  "async function* f(a,a){}",
  "const f=async function* named(){yield;};",
  "({async *f(){yield 42;}});",
  "class C{async *f(){yield await 42;} static async *g(){return 19;}}",
  "class C{async *#f(){yield 42;}}",
])
  test(`async generator grammar accepts ${source}`, () => {
    assert.doesNotThrow(() => new Script(source));
    const result = parse(source);
    assert.ok(result.ok, JSON.stringify(result));
    let found = false;
    rewriteModule(result.value, {
      statement(node) {
        if (node.kind === "function" && node.async && node.generator)
          found = true;
        if (node.kind === "class")
          for (const e of node.definition.elements)
            if (e.kind === "method" && e.async && e.generator) found = true;
        return node;
      },
      expression(node) {
        if (node.kind === "function-expression" && node.async && node.generator)
          found = true;
        return node;
      },
    });
    assert.ok(found);
  });
for (const source of [
  '"use strict";async function* f(a,a){}',
  "async function* f(a=await 1){}",
  "async function* f(a=yield 1){}",
  "const f=async function* await(){};",
  "const f=async function* yield(){};",
  "class C{async *constructor(){}}",
])
  test(`async generator grammar rejects ${source}`, () => {
    assert.throws(() => new Script(source), SyntaxError);
    const result = parse(source);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "SYNTAX_ERROR");
  });

test("sloppy generator declarations and expressions allow duplicate simple parameters", () => {
  for (const text of [
    "function* g(a,a){}",
    "(function* g(a,a){})",
    "(async function* g(a,a){})",
  ]) {
    assert.doesNotThrow(() => new Script(text));
    const result = parse(text);
    assert.ok(result.ok, JSON.stringify(result));
  }
});

for (const text of [
  "async function f(){for await(const x of xs){}}",
  "async function* f(){for await(let [x] of xs){yield x;}}",
  "async function f(){for await(var {x} of xs){}}",
  "async function f(){let x;for await(x of xs){}}",
  "async function f(){let async;for await(async of xs){}}",
  "async function f(){for\nawait(const x of xs){}}",
])
  test(`for-await grammar preserves its marker: ${text}`, () => {
    assert.doesNotThrow(() => new Script(text));
    const result = parse(text);
    assert.ok(result.ok, JSON.stringify(result));
    let found = false;
    rewriteModule(result.value, {
      statement(node) {
        if (node.kind === "for-of" || node.kind === "for-of-assignment") {
          assert.equal(node.await, true);
          found = true;
        }
        return node;
      },
    });
    assert.ok(found);
  });
for (const text of [
  "for await(const x of xs){}",
  "function f(){for await(const x of xs){}}",
  "async function f(){for await(const x in xs){}}",
  "async function f(){for await(;;){}}",
  "async function f(){for await(let x=1; x; x++){}}",
  "async function f(){for await(let x=1 of xs){}}",
  "async function f(){for aw\\u0061it(const x of xs){}}",
  "async function f(){for await(let of xs){}}",
])
  test(`for-await rejects invalid heads/contexts: ${text}`, () => {
    // Node 24 accepts an escaped await modifier; Tint requires the literal keyword.
    if (!text.includes("\\u"))
      assert.throws(() => new Script(text), SyntaxError);
    const result = parse(text);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "SYNTAX_ERROR");
  });

for (const source of [
  "async function f(){g('await');}",
  'async function f(){return "await";}',
  "async function f(){return `await`;}",
  "async function f(x='await'){}",
  "async function f(x=`await`){}",
  "class C{static{g('await');}}",
  "class C{static{g(`await`);}}",
])
  test(`await literal text is not a keyword: ${source}`, () => {
    assert.doesNotThrow(() => new Script(source));
    const result = parse(source);
    assert.ok(result.ok, JSON.stringify(result));
  });

test("module bodies admit top-level await without leaking into functions or fields", () => {
  function module(text: string) {
    const bytes = new TextEncoder().encode(text);
    const source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    return parseModule(source.value, "javascript");
  }
  for (const text of [
    "await task;",
    "{await task;}",
    "for await(const x of await source) { await x; }",
    "class C extends (await base) {}",
  ]) {
    const result = module(text);
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(
      rewriteModule(result.value, {}).statements,
      result.value.statements,
    );
  }
  for (const text of [
    "function f(){await task;}",
    "(()=>await task);",
    "class C { field = await task; }",
    "class C { static { await task; } }",
    "function f(){for await(const x of source){}}",
    "for await(const x in source){}",
  ])
    assert.equal(module(text).ok, false, text);
});

test("module exports accept async function and async generator declarations without a line break", () => {
  for (const [text, generator] of [
    ["export async function f(){await 1;}", false],
    ["export async function* f(){yield await 1;}", true],
  ] as const) {
    const bytes = new TextEncoder().encode(text),
      source = createSourceText(bytes, bytes.length);
    assert.ok(source.ok);
    const parsed = parseModule(source.value);
    assert.ok(parsed.ok, JSON.stringify(parsed));
    const declaration = parsed.value.statements[0];
    assert.ok(declaration?.kind === "function");
    assert.equal(declaration.exported, true);
    assert.equal(declaration.async, true);
    assert.equal(declaration.generator === true, generator);
  }
  const bytes = new TextEncoder().encode("export async\nfunction f(){}"),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  assert.equal(parseModule(source.value).ok, false);
});
