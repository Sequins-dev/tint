import assert from "node:assert/strict";
import test from "node:test";
import { createSourceText } from "@tint/source/text";
import { parseScript } from "@tint/typescript/syntax";
import { bindScript } from "../src/binding/index.ts";

function copies(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseScript(source.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const bound = bindScript(parsed.value);
  assert.ok(bound.ok, JSON.stringify(bound));
  return (bound.value.annexFunctionCopies ?? []).map((copy) => copy.name);
}

test("sloppy block functions identify declaration-time var copies", () => {
  assert.deepEqual(copies("{function f(){}}"), ["f"]);
  assert.deepEqual(copies("function g(){{function f(){}}}"), ["f"]);
  assert.deepEqual(copies("{function f(){} function f(){}}"), ["f", "f"]);
  assert.deepEqual(
    copies("switch(0){case 0:function f(){} case 1:function f(){}}"),
    ["f", "f"],
  );
});

test("Annex B var copies respect parameters and intervening lexical declarations", () => {
  for (const text of [
    "let f;{function f(){}}",
    "{let f;{function f(){}}}",
    "function g(f){{function f(){}}}",
    "function g(f=0){{function f(){}}}",
    "function g(){let f;{function f(){}}}",
    "try{}catch({f}){{function f(){}}}",
    "function g(){'use strict';{function f(){}}}",
  ])
    assert.deepEqual(copies(text), [], text);
  assert.deepEqual(copies("try{}catch(f){{function f(){}}}"), ["f"]);
  assert.deepEqual(copies("function g(){{function arguments(){}}}"), [
    "arguments",
  ]);
});

test("Annex B var bindings resolve outer references and closure captures", () => {
  const text = "let f;function g(){const h=()=>f;{function f(){}}return h;}";
  const bytes = new TextEncoder().encode(text);
  const source = createSourceText(bytes, bytes.length);
  assert.ok(source.ok);
  const parsed = parseScript(source.value);
  assert.ok(parsed.ok);
  const bound = bindScript(parsed.value);
  assert.ok(bound.ok);
  const reference = bound.value.references.find(
    (r) => r.node.start === text.indexOf("=>f") + 2,
  );
  assert.ok(reference?.binding !== undefined);
  const target = bound.value.bindings[reference.binding];
  assert.equal(target?.kind, "var");
  assert.ok(target?.owner !== undefined);
  assert.equal(target.captured, true);
});
