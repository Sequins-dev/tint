import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseScript, rewriteModule } from "@tint/typescript/syntax";
import { lowerScript } from "../src/lowering/index.ts";
function names(source: string): string[] {
  const parsed = parseScript(createSourceTextView(source));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const result = lowerScript(parsed.value, source);
  assert.ok(result.ok, JSON.stringify(result));
  const names: string[] = [];
  rewriteModule(result.value, {
    expression(node) {
      if (
        node.kind === "call" &&
        node.callee.kind === "identifier" &&
        node.callee.name === "propertyFunctionName"
      ) {
        const value = node.arguments[0];
        if (value?.kind === "string") names.push(value.value);
      }
      return node;
    },
  });
  return names;
}
test("parenthesized assignment targets do not infer anonymous function names", () => {
  for (const source of [
    "let fn;(fn)=function(){};",
    "let fn;((fn))=()=>{};",
    "let fn;(fn)||=function(){};",
    "let fn=true;(fn)&&=()=>{};",
    "let fn;(fn)??=function(){};",
    "let fn;[(fn)=function(){}]=[];",
    "let fn;({x:(fn)=function(){}}={});",
  ]) {
    assert.deepEqual(names(source), [""], source);
  }
});
test("bare identifiers infer through parenthesized anonymous right-hand sides", () => {
  for (const source of [
    "let fn;fn=(function(){});",
    "let fn;fn||=(()=>{});",
    "let fn;[fn=(function(){})]=[];",
  ]) {
    assert.deepEqual(names(source), ["fn"], source);
  }
});
