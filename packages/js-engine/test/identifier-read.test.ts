import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseScript, rewriteModule } from "@tint/typescript/syntax";
import { lowerScript } from "../src/lowering/index.ts";
import { createLoweredRealm } from "./lowered-node-host.ts";

function calls(source: string, name: string): number {
  const parsed = parseScript(createSourceTextView(source));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const lowered = lowerScript(parsed.value, source);
  assert.ok(lowered.ok, JSON.stringify(lowered));
  let count = 0;
  rewriteModule(lowered.value, {
    expression(node) {
      if (
        node.kind === "call" &&
        node.callee.kind === "identifier" &&
        node.callee.name === name
      )
        count++;
      return node;
    },
  });
  return count;
}

test("AOT identifier reads use the fused resolution and read", () => {
  const source = "function f(a){return a+b}var b=1;f(2);";
  // Reads of a, b and f; the call's callee needs its reference for `this`.
  assert.equal(calls(source, "getIdentifierValue"), 2);
  assert.equal(calls(source, "getBindingReference"), 1);
});

for (const [source, printed, completion] of [
  ["function f(a){return function(){return a+1}}print(f(1)());", ["2"], "none"],
  ["var x=1;function g(){var x=2;return x}print(g()+x);", ["3"], "none"],
  ["let g1=3;print(g1);", ["3"], "none"],
  ["this.gp=4;print(gp);", ["4"], "none"],
  ["print(typeof notDeclared);", ["undefined"], "none"],
  ["notDeclared;", [], "ReferenceError"],
  ["{print(typeof x);let x=1;}", [], "ReferenceError"],
  ["function h(){return y}h();let y=1;", [], "ReferenceError"],
  [
    "var o={get v(){print('get');return 5}};with(o){print(v)}",
    ["get", "5"],
    "none",
  ],
  [
    "var o={v:1,[Symbol.unscopables]:{v:true}};var v=2;with(o){print(v)}",
    ["2"],
    "none",
  ],
] as const)
  test("identifier read semantics: " + source, () => {
    const realm = createLoweredRealm();
    assert.equal(realm.run(source), completion);
    assert.deepEqual(realm.printed, printed);
  });
