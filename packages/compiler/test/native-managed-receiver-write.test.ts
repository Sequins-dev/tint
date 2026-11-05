import assert from "node:assert/strict";
import test from "node:test";
import { parseDynamicFunction } from "@tint/typescript/syntax";
import * as compiler from "@tint/compiler/native";

test("managed receiver writes compile explicit callback operations with a distinct contract", () => {
  assert.equal(
    typeof compiler.compileManagedReceiverWriteDynamicFunction,
    "function",
  );
  for (const [body, returns] of [
    ["this.touched=true;return this;", "receiver"],
    ['"use strict";this["touched"]=true;', "undefined"],
  ] as const) {
    const syntax = parseDynamicFunction("normal", [], body);
    assert.ok(syntax.ok);
    const result = compiler.compileManagedReceiverWriteDynamicFunction(
      syntax.value,
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.property, "touched");
    assert.equal(result.value.returns, returns);
    assert.equal(result.value.readerContract, "tint.receiver-write.v1");
    assert.equal(result.value.native.managedImports.length, 2);
    assert.deepEqual(result.value.parameters, ["reference"]);
  }
});
test("receiver write admission does not erase extra effects or loosen borrowed compilation", () => {
  assert.equal(
    typeof compiler.compileManagedReceiverWriteDynamicFunction,
    "function",
  );
  for (const body of [
    "this.touched=false;return this;",
    "this[key]=true;return this;",
    "this.touched=true;sideEffect();return this;",
    "this.touched+=true;return this;",
    "this.child.touched=true;return this;",
    "return this;",
  ]) {
    const syntax = parseDynamicFunction("normal", [], body);
    assert.ok(syntax.ok);
    assert.equal(
      compiler.compileManagedReceiverWriteDynamicFunction(syntax.value).ok,
      false,
      body,
    );
  }
  const syntax = parseDynamicFunction(
    "normal",
    [],
    "this.touched=true;return this;",
  );
  assert.ok(syntax.ok);
  assert.equal(compiler.compileClosedDynamicFunction(syntax.value).ok, false);
  assert.equal(
    compiler.compileManagedGlobalAccessDynamicFunction(syntax.value).ok,
    false,
  );
});
