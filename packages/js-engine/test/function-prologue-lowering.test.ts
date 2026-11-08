import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseScript, rewriteModule } from "@tint/typescript/syntax";
import { lowerScript } from "../src/lowering/index.ts";

/** Count arguments-object instantiations emitted for a Script. An ordinary
 * function needs one only when its own `arguments` binding can be observed:
 * a syntactic reference (including through arrows and class computed keys)
 * or a direct eval in its parameters, body or nested arrows. */
function argumentsInstantiations(source: string): number {
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
        node.callee.name === "instantiateScriptArguments"
      )
        count++;
      return node;
    },
  });
  return count;
}

for (const [source, expected] of [
  ["function f(a){return a+1}", 0],
  ['function f(a){"use strict";return a}', 0],
  ["function f(){function g(){return arguments}return g}", 1],
  ["var o={m(){return 1}};", 0],
  ["class C{constructor(){this.x=1}m(){}}", 0],
  ["function* g(a){yield a}", 0],
  ["async function f(a){return a}", 0],
  ["function f(){var arguments;}", 0],
] as const)
  test("unobservable arguments object is not instantiated: " + source, () => {
    assert.equal(argumentsInstantiations(source), expected);
  });

for (const [source, expected] of [
  ["function f(){return arguments}", 1],
  ["function f(){return argument\\u0073}", 1],
  ["function f(){return ()=>arguments}", 1],
  ["function f(){return ()=>()=>arguments[0]}", 1],
  ["function f(a=arguments){return a}", 1],
  ["function f(){return typeof arguments}", 1],
  ["function f(){arguments=1}", 1],
  ["function f(){return {arguments}}", 1],
  ["function f(){with({})arguments}", 1],
  ["function f(){eval('')}", 1],
  ["function f(){return ()=>eval('arguments')}", 1],
  ["function f(a=eval('arguments')){return a}", 1],
  ["function f(){return class{[arguments[0]](){}}}", 1],
  ["function f(){return class extends arguments[0]{}}", 1],
  ["function* g(){yield arguments}", 1],
  ["async function f(){return arguments}", 1],
  ["var o={m(){return arguments}};", 1],
  ["class C{m(){return arguments}}", 1],
  ["class C{constructor(){this.a=arguments}}", 1],
  ["function f(){return arguments}function g(){return arguments}", 2],
  ["function f(){return function(){return ()=>arguments}}", 1],
  // Method spans exclude modifiers such as `static` in retained source text.
  ["class C{static async*m(){return arguments}}", 1],
  ["class C{static*m(){return arguments}}", 1],
  ["class C{static async m(){return arguments}}", 1],
  ["class C{static m(){return arguments}}", 1],
  ["class C{static get g(){return arguments}}", 1],
  ["class C{static set s(v){arguments}}", 1],
  ["class C{async*m(){return arguments}}", 1],
  ["var o={async*m(){return arguments},get g(){return arguments}};", 2],
] as const)
  test("observable arguments object is instantiated: " + source, () => {
    assert.equal(argumentsInstantiations(source), expected);
  });

function bodyInstantiations(source: string): number {
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
        node.callee.name === "instantiateFunctionBody"
      )
        count++;
      return node;
    },
  });
  return count;
}

/** A body with no var, function or lexical declarations and no separate
 * parameter environment shares the parameter scope; no plan is allocated. */
for (const [source, expected] of [
  ["function f(a){return a+1}", 0],
  ["function f(a=1){return a}", 1],
  ["function f(){var x=1;return x}", 1],
  ["function f(){let x=1;return x}", 1],
  ["function f(){function g(){}return g}", 1],
  ["function f(){eval('var x=1');return x}", 0],
  ["function f(){return function(){return 1}}", 0],
] as const)
  test("body instantiation only for declaring bodies: " + source, () => {
    assert.equal(bodyInstantiations(source), expected);
  });
