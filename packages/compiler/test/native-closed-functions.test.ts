import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { compileClosedFunction } from "@tint/compiler/native";
function module(text: string) {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}

test("closed compilation exposes a checked scalar ABI without module startup", () => {
  const input = module(
      "export function identity(value:unknown):unknown{return value;}",
    ),
    before = structuredClone(input);
  const result = compileClosedFunction(input, "identity");
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.value.parameters, ["general"]);
  assert.equal(result.value.returnType, "general");
  assert.equal(result.value.native.imports.length, 0);
  assert.equal(result.value.native.records.length, 0);
  assert.equal(result.value.native.strings.length, 0);
  assert.equal(result.value.entry.signature.parameters.length, 1);
  assert.ok(result.value.native.code.length > 0);
  assert.deepEqual(input, before);
  const numeric = compileClosedFunction(
    module(
      "export function run():number{let sum=0;for(let i=0;i<6;i++)sum+=i;return sum+27;}",
    ),
    "run",
  );
  assert.ok(numeric.ok, JSON.stringify(numeric));
  assert.equal(numeric.value.returnType, "number");
  assert.deepEqual(numeric.value.parameters, []);
});

test("closed compilation rejects initialization, owned values and opaque effects", () => {
  for (const text of [
    "let value=42;export function run():number{return value;}",
    "export function run():unknown{return {value:42};}",
    "export function run():string{return 'owned code literal';}",
    "export function run():unknown{throw 42;}",
    "export function run(fn:()=>unknown):unknown{return fn();}",
    "export function run(this:unknown):unknown{return this;}",
  ]) {
    const result = compileClosedFunction(module(text), "run");
    assert.equal(result.ok, false, JSON.stringify({ text, result }));
  }
  const missing = compileClosedFunction(
    module("export function run():number{return 42;}"),
    "missing",
  );
  assert.equal(missing.ok, false);
});

test("discarded directive text does not create an escaping code-backed value", () => {
  const compiled = compileClosedFunction(
    module(
      "export function run(receiver:unknown):unknown{'use strict';return receiver;}",
    ),
    "run",
  );
  assert.ok(compiled.ok, JSON.stringify(compiled));
  assert.equal(compiled.value.native.strings.length, 0);
});

test("closed dynamic functions lower their receiver and implicit return through checked IR", async () => {
  const { parseDynamicFunction } = await import("@tint/typescript/syntax");
  const { compileClosedDynamicFunction } =
    await import("@tint/compiler/native");
  for (const body of [
    "return this;",
    "'use strict';return this;",
    "return 42;",
    "return true;",
    "return null;",
    "",
    "return;",
  ]) {
    const parsed = parseDynamicFunction("normal", [], body);
    assert.ok(parsed.ok);
    const compiled = compileClosedDynamicFunction(parsed.value);
    assert.ok(compiled.ok, JSON.stringify({ body, compiled }));
    assert.deepEqual(compiled.value.parameters, ["general"]);
    assert.equal(compiled.value.returnType, "general");
  }
  for (const [kind, parameters, body] of [
    ["normal", [], "return function(){return this;}();"],
    ["normal", [], "return new.target;"],
    ["normal", [], "var value=1;return value;"],
    ["normal", [], "return $tint$receiver;"],
  ] as const) {
    const parsed = parseDynamicFunction(kind, parameters, body);
    assert.ok(parsed.ok);
    assert.equal(
      compileClosedDynamicFunction(parsed.value).ok,
      false,
      JSON.stringify({ kind, parameters, body }),
    );
  }
});

test("closed dynamic ABI removes unused simple formals and selects one borrowed input", async () => {
  const { parseDynamicFunction } = await import("@tint/typescript/syntax");
  const { compileClosedDynamicFunction } =
    await import("@tint/compiler/native");
  for (const [parameters, body, input] of [
    [["unused"], "return this;", -1],
    [["unused", "value"], "return value;", 1],
    [["value", "value"], "return value;", 1],
    [["$tint$receiver"], "return $tint$receiver;", 0],
    [["a", "b"], "return 42;", -2],
  ] as const) {
    const parsed = parseDynamicFunction("normal", parameters, body);
    assert.ok(parsed.ok);
    const result = compileClosedDynamicFunction(parsed.value);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.input, input);
    assert.equal(result.value.minimumArguments, 0);
    assert.equal(result.value.length, parameters.length);
  }
  for (const [parameters, body] of [
    [["a"], "if(a)return this;return a;"],
    [["a", "b"], "return a===b;"],
    [["a=42"], "return this;"],
    [["{a}"], "return this;"],
    [["...rest"], "return this;"],
    [["a"], "return external;"],
  ] as const) {
    const parsed = parseDynamicFunction("normal", parameters, body);
    assert.ok(parsed.ok);
    assert.equal(
      compileClosedDynamicFunction(parsed.value).ok,
      false,
      JSON.stringify({ parameters, body }),
    );
  }
});

test("closed dynamic globals fold only immutable constants, after formal binding resolution", async () => {
  const { parseDynamicFunction } = await import("@tint/typescript/syntax");
  const { compileClosedDynamicFunction } =
    await import("@tint/compiler/native");
  for (const name of ["undefined", "NaN", "Infinity"]) {
    for (const parameters of [[], [name]]) {
      const parsed = parseDynamicFunction(
        "normal",
        parameters,
        "return " + name + ";",
      );
      assert.ok(parsed.ok);
      const compiled = compileClosedDynamicFunction(parsed.value);
      assert.ok(compiled.ok, JSON.stringify({ name, parameters, compiled }));
      assert.equal(compiled.value.input, parameters.length === 0 ? -2 : 0);
    }
  }
});

test("closed bodies for async and generator functions reject actual suspension", async () => {
  const { parseDynamicFunction } = await import("@tint/typescript/syntax");
  const { compileClosedDynamicFunction } =
    await import("@tint/compiler/native");
  for (const kind of ["async", "generator"] as const) {
    const parsed = parseDynamicFunction(kind, ["value"], "return value;");
    assert.ok(parsed.ok);
    const result = compileClosedDynamicFunction(parsed.value);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.input, 0);
    assert.equal(result.value.returnType, "general");
  }
  for (const [kind, body] of [
    ["async", "return await 42;"],
    ["generator", "yield 42;"],
    ["async-generator", "return await 42;"],
  ] as const) {
    const parsed = parseDynamicFunction(kind, [], body);
    assert.ok(parsed.ok);
    assert.equal(compileClosedDynamicFunction(parsed.value).ok, false);
  }
});

test("closed dynamic bodies reject unbound JavaScript coercion on borrowed values", async () => {
  const { parseDynamicFunction } = await import("@tint/typescript/syntax");
  const { compileClosedDynamicFunction } =
    await import("@tint/compiler/native");
  for (const body of [
    "return !value;",
    "if(value)return true;return false;",
    "return value&&42;",
    "return value||42;",
    "return value?19:23;",
    "while(value)return 42;",
    "return typeof value;",
  ]) {
    const parsed = parseDynamicFunction("normal", ["value"], body);
    assert.ok(parsed.ok);
    assert.equal(compileClosedDynamicFunction(parsed.value).ok, false, body);
  }
  for (const body of [
    "return value===value;",
    "if(value===null)return true;return false;",
    "return !(value===null);",
    "return (value===null)&&true;",
  ]) {
    const parsed = parseDynamicFunction("normal", ["value"], body);
    assert.ok(parsed.ok);
    const result = compileClosedDynamicFunction(parsed.value);
    assert.ok(result.ok, JSON.stringify({ body, result }));
  }
});

test("async-generator native results distinguish implicit completion from return Await", async () => {
  const { parseDynamicFunction } = await import("@tint/typescript/syntax");
  const { compileClosedDynamicFunction } =
    await import("@tint/compiler/native");
  for (const [body, completion] of [
    ["", "async-generator-direct"],
    ["void 0;", "async-generator-direct"],
    ["return;", "async-generator-direct"],
    ["return value;", "async-generator-await-return"],
    ["if(value===null)return 19;return value;", "async-generator-await-return"],
  ] as const) {
    const parsed = parseDynamicFunction("async-generator", ["value"], body);
    assert.ok(parsed.ok);
    const result = compileClosedDynamicFunction(parsed.value);
    assert.ok(result.ok, JSON.stringify({ body, result }));
    assert.equal(result.value.completion, completion);
  }
  for (const body of [
    "if(value===null)return;return value;",
    "if(value===null)return 42;",
    "yield value;",
    "await value;",
  ]) {
    const parsed = parseDynamicFunction("async-generator", ["value"], body);
    assert.ok(parsed.ok);
    assert.equal(compileClosedDynamicFunction(parsed.value).ok, false, body);
  }
});

test("bare async-generator return does not require an Await", async () => {
  const { parseDynamicFunction } = await import("@tint/typescript/syntax");
  const { compileClosedDynamicFunction } =
    await import("@tint/compiler/native");
  const parsed = parseDynamicFunction("async-generator", [], "return;");
  assert.ok(parsed.ok);
  const result = compileClosedDynamicFunction(parsed.value);
  assert.ok(result.ok);
  assert.equal(result.value.completion, "async-generator-direct");
});

test("code-owned literals require an explicit permanent storage contract", async () => {
  const { parseDynamicFunction } = await import("@tint/typescript/syntax");
  const { compileClosedDynamicFunction } =
    await import("@tint/compiler/native");
  const input = module("export function run():string{return 'permanent';}");
  assert.equal(compileClosedFunction(input, "run").ok, false);
  const compiled = compileClosedFunction(input, "run", 65536, {
    literals: "permanent",
  });
  assert.ok(compiled.ok, JSON.stringify(compiled));
  assert.equal(compiled.value.requiresPermanentLiterals, true);
  assert.ok(
    compiled.value.native.strings.some((value) => value.value === "permanent"),
  );
  const parsed = parseDynamicFunction("normal", [], "return 'a\\0\\ud800';");
  assert.ok(parsed.ok);
  const dynamic = compileClosedDynamicFunction(parsed.value, 65536, {
    literals: "permanent",
  });
  assert.ok(dynamic.ok, JSON.stringify(dynamic));
  assert.equal(dynamic.value.returnType, "general");
  assert.equal(dynamic.value.requiresPermanentLiterals, true);
  assert.ok(
    dynamic.value.native.strings.some((value) => value.value === "a\0\ud800"),
  );
});

test("closed dynamic indexed arguments borrow actual values without materializing an arguments object", async () => {
  const { parseDynamicFunction } = await import("@tint/typescript/syntax");
  const { compileClosedDynamicFunction } =
    await import("@tint/compiler/native");
  for (const [parameters, body, input] of [
    [[], "return arguments[0];", 0],
    [["a"], "return arguments[2];", 2],
    [["a", "a"], "return arguments[0];", 0],
    [["a"], "return arguments[0]===a;", 0],
    [[], "'use strict';return arguments[1];", 1],
  ] as const) {
    const parsed = parseDynamicFunction("normal", parameters, body);
    assert.ok(parsed.ok);
    const result = compileClosedDynamicFunction(parsed.value);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.input, input);
    assert.equal(result.value.minimumArguments, input + 1);
    assert.equal(result.value.length, parameters.length);
  }
  for (const [parameters, body] of [
    [[], "return arguments;"],
    [[], "return arguments[0]===arguments;"],
    [[], "return arguments[0.5];"],
    [[], "return arguments[4294967295];"],
    [[], "return arguments[0]===arguments[1];"],
    [[], "arguments[0]=42;return arguments[0];"],
    [[], "return arguments['00'];"],
    [[], "return arguments[-1];"],
    [[], "return arguments.callee;"],
    [[], "return arguments.length;"],
    [["arguments"], "return arguments[0];"],
  ] as const) {
    const parsed = parseDynamicFunction("normal", parameters, body);
    assert.ok(parsed.ok);
    assert.equal(compileClosedDynamicFunction(parsed.value).ok, false, body);
  }
});
