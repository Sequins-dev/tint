import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import {
  parseScript,
  parseModule,
  rewriteModule,
} from "../src/syntax/index.ts";
function parse(text: string, module = false) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  return module
    ? parseModule(source.value, "javascript")
    : parseScript(source.value);
}
test("resource declarations retain disposal intent through rewriting", () => {
  for (const text of [
    "using x = resource, y = other;",
    "await using x = resource;",
  ]) {
    const result = parse(text, true);
    assert.ok(result.ok, JSON.stringify(result));
    const declaration = result.value.statements[0];
    assert.equal(declaration?.kind, "variable");
    if (declaration?.kind !== "variable") return;
    assert.equal(
      declaration.disposal,
      text.startsWith("await") ? "async" : "sync",
    );
    assert.deepEqual(
      rewriteModule(result.value, {}).statements,
      result.value.statements,
    );
  }
  assert.ok(parse("{ using x = resource; }").ok);
  assert.ok(parse("async function f(){ await using x = resource; }").ok);
});
test("resource declarations enforce binding and context restrictions", () => {
  for (const text of [
    "using x = resource;",
    "{ using x; }",
    "{ using {x} = resource; }",
    "function f(){ await using x = resource; }",
    "if (true) using x = resource;",
    "{ await using x = resource; }",
  ])
    assert.equal(parse(text).ok, false, text);
  assert.ok(parse("using\nx = resource;").ok);
  assert.ok(parse("{ using [x] = resource; }").ok);
});

test("switch clauses require a nested block for resource declarations", () => {
  for (const declaration of [
    "using x = resource;",
    "await using x = resource;",
  ]) {
    for (const clause of ["case 0:", "default:"]) {
      assert.equal(
        parse(`switch (0) { ${clause} ${declaration} }`, true).ok,
        false,
      );
      assert.equal(
        parse(`switch (0) { ${clause} { ${declaration} } }`, true).ok,
        true,
      );
    }
  }
});

test("for-of resource bindings retain independent iteration and disposal modes", () => {
  for (const [text, disposal, asynchronous] of [
    ["for (using x of source) {}", "sync", false],
    ["for (await using x of source) {}", "async", false],
    ["for await (using x of source) {}", "sync", true],
    ["for await (await using x of source) {}", "async", true],
  ] as const) {
    const result = parse(text, true);
    assert.ok(result.ok, JSON.stringify(result));
    const loop = result.value.statements[0];
    assert.equal(loop?.kind, "for-of");
    if (loop?.kind !== "for-of") return;
    assert.equal(loop.disposal, disposal);
    assert.equal(loop.await, asynchronous);
    assert.deepEqual(
      rewriteModule(result.value, {}).statements,
      result.value.statements,
    );
  }
  for (const text of [
    "for (using of of source) {}",
    "for (using x in source) {}",
  ])
    assert.equal(parse(text, true).ok, false, text);
  assert.equal(parse("for (await using x of source) {}").ok, false);
  assert.ok(parse("for (using [x] of source) {}", true).ok);
});

test("classic for initializers preserve resource declarations", () => {
  for (const head of ["using x = resource", "await using x = resource"]) {
    const result = parse(`for (${head}; condition; advance()) {}`, true);
    assert.ok(result.ok, JSON.stringify(result));
    const loop = result.value.statements[0];
    assert.equal(loop?.kind, "for");
    if (loop?.kind !== "for") return;
    assert.equal(loop.initializer?.kind, "variable");
    if (loop.initializer?.kind !== "variable") return;
    assert.equal(
      loop.initializer.disposal,
      head.startsWith("await") ? "async" : "sync",
    );
  }
});

test("of disambiguation differs for sync and awaited resource heads", () => {
  const ordinary = parse("for (using of of[0, 1, 2]) {}", true);
  assert.ok(ordinary.ok, JSON.stringify(ordinary));
  assert.equal(ordinary.value.statements[0]?.kind, "for-of-assignment");
  const resource = parse("for (await using of of []) {}", true);
  assert.ok(resource.ok, JSON.stringify(resource));
  const loop = resource.value.statements[0];
  assert.equal(loop?.kind, "for-of");
  if (loop?.kind === "for-of") assert.equal(loop.disposal, "async");
});

test("classic resource declarations may bind of", () => {
  assert.ok(parse("for (using of = null;;) break;", true).ok);
});
