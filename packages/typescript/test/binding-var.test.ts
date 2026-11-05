import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { bindModule, type Binding } from "@tint/typescript/binding";
function bind(text: string) {
  const bytes = new TextEncoder().encode(text),
    source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseModule(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return bindModule(parsed.value);
}
test("var declarations hoist to their function across blocks and loop headers", () => {
  const result = bind(
    "function f():number {x=1;if(true){var x:number=2;}for(var i:number=0;i<2;i++){}return x+i;}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  for (const name of ["x", "i"]) {
    const binding: Binding | undefined = result.value.bindings.find(
      (b) => b.name === name,
    );
    assert.ok(binding);
    assert.equal(binding.kind, "var");
    assert.equal(result.value.scopes[binding.scope]?.kind, "function");
  }
});
test("var redeclarations and parameter redeclarations share one binding", () => {
  const result = bind(
    "function f(x:number):number {var x:number=2;var y:number=1;{var y:number=3;}return x+y;}",
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.bindings.filter((b) => b.name === "x").length, 1);
  assert.equal(result.value.bindings.filter((b) => b.name === "y").length, 1);
});
test("var declarations conflict with lexical names along their enclosing path", () => {
  for (const text of [
    "function f():void{let x=1;{var x=2;}}",
    "function f():void{{let x=1;var x=2;}}",
    "function f():void{var x=1;let x=2;}",
  ]) {
    const result = bind(text);
    assert.ok(!result.ok, text);
    assert.equal(result.error.code, "DUPLICATE_NAME");
  }
  assert.ok(bind("function f():void{var x=1;{let x=2;}}").ok);
});

test("var/function declarations merge, while catch redeclarations stay explicitly unsupported", () => {
  const merged = bind(
    "function f():number{var g;function g():number{return 1;}return g();}",
  );
  assert.ok(merged.ok, JSON.stringify(merged));
  assert.equal(merged.value.bindings.filter((b) => b.name === "g").length, 1);
  const caught = bind("function f():void{try{}catch(e){var e=1;}}");
  assert.ok(!caught.ok);
  assert.equal(caught.error.code, "UNSUPPORTED");
});
