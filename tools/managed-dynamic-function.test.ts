import test from "node:test";
import assert from "node:assert/strict";
import { parseDynamicFunction } from "@tint/typescript/syntax";
import { lowerDynamicFunctionImplementation } from "@tint/js-engine/lowering";
import { prepareManagedSurfaceEntry } from "@tint/compiler/native";
import { createManagedScriptFixture } from "./managed-script-fixture.ts";

test("ordinary dynamic bodies compile through the existing Script frame and callback contracts", () => {
  const fixture = createManagedScriptFixture();
  for (const [params, body] of [
    [["a", "b=1", "...rest"], "return a+b+rest.length;"],
    [["a"], "arguments[0]=42;return a;"],
    [[], "this.value=1;return new.target;"],
    [[], "return function inner(){return 7;};"],
  ] as [string[], string][]) {
    const parsed = parseDynamicFunction("normal", params, body);
    assert.ok(parsed.ok);
    const lowered = lowerDynamicFunctionImplementation(parsed.value);
    assert.ok(lowered.ok, JSON.stringify(lowered));
    const prepared = prepareManagedSurfaceEntry({
      ...fixture,
      module: lowered.value,
      entry: "execute",
    });
    assert.ok(
      prepared.ok,
      body + ": " + JSON.stringify(prepared.ok ? undefined : prepared.error),
    );
    assert.ok(
      prepared.value.counts.memberOnly > 0,
      "callback must have an issued surface contract",
    );
  }
});

test("ordinary dynamic bodies can expose suspending function constructors", () => {
  const fixture = createManagedScriptFixture();
  for (const body of [
    "return (async function(){}).constructor",
    "return (async function*(){}).constructor",
  ]) {
    const parsed = parseDynamicFunction("normal", [], body);
    assert.ok(parsed.ok);
    const lowered = lowerDynamicFunctionImplementation(parsed.value);
    assert.ok(lowered.ok, JSON.stringify(lowered));
    const prepared = prepareManagedSurfaceEntry({
      ...fixture,
      module: lowered.value,
      entry: "execute",
    });
    assert.ok(prepared.ok, JSON.stringify({ body, prepared }));
  }
});

test("general async dynamic bodies retain exact managed callback contracts", () => {
  const fixture = createManagedScriptFixture();
  for (const [params, body] of [
    [[], "return await 7"],
    [["a=1", "...rest"], "try{return await a+rest.length}catch(e){return e}"],
    [[], "return async()=>await this"],
  ] as [string[], string][]) {
    const parsed = parseDynamicFunction("async", params, body);
    assert.ok(parsed.ok);
    const lowered = lowerDynamicFunctionImplementation(parsed.value);
    assert.ok(lowered.ok, JSON.stringify(lowered));
    const prepared = prepareManagedSurfaceEntry({
      ...fixture,
      module: lowered.value,
      entry: "execute",
    });
    assert.ok(prepared.ok, JSON.stringify(prepared));
  }
});

test("async dynamic finally cleanup keeps the exact managed boundary", () => {
  const fixture = createManagedScriptFixture(),
    parsed = parseDynamicFunction(
      "async",
      [],
      "try{return await 7}finally{await 1}",
    );
  assert.ok(parsed.ok);
  const lowered = lowerDynamicFunctionImplementation(parsed.value);
  assert.ok(lowered.ok, JSON.stringify(lowered));
  const prepared = prepareManagedSurfaceEntry({
    ...fixture,
    module: lowered.value,
    entry: "execute",
  });
  assert.ok(prepared.ok, JSON.stringify(prepared));
});

test("general generator bodies prepare with exact step classes and private finally cleanup", () => {
  const fixture = createManagedScriptFixture();
  for (const [params, body] of [
    [["a=1", "...rest"], "yield a;yield* rest;return arguments.length"],
    [[], "try{yield 1}finally{yield 2}"],
    [[], "yield eval('1');return new.target"],
  ] as [string[], string][]) {
    const parsed = parseDynamicFunction("generator", params, body);
    assert.ok(parsed.ok);
    const lowered = lowerDynamicFunctionImplementation(parsed.value);
    assert.ok(lowered.ok, JSON.stringify(lowered));
    const prepared = prepareManagedSurfaceEntry({
      ...fixture,
      module: lowered.value,
      entry: "execute",
    });
    assert.ok(prepared.ok, JSON.stringify(prepared));
  }
});

test("general async generator bodies preserve exact managed callback classes", () => {
  const fixture = createManagedScriptFixture();
  for (const [params, body] of [
    [["a=1", "...rest"], "yield await a;yield* rest;return arguments.length"],
    [[], "try{await 1;yield 2}finally{yield 3}"],
    [[], "for await(const v of [1,Promise.resolve(2)])yield v"],
  ] as [string[], string][]) {
    const parsed = parseDynamicFunction("async-generator", params, body);
    assert.ok(parsed.ok);
    const lowered = lowerDynamicFunctionImplementation(parsed.value);
    assert.ok(lowered.ok, JSON.stringify(lowered));
    const prepared = prepareManagedSurfaceEntry({
      ...fixture,
      module: lowered.value,
      entry: "execute",
    });
    assert.ok(prepared.ok, JSON.stringify(prepared));
  }
});
