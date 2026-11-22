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
  ["class C{static*#m(){return arguments}}", 1],
  ["class C{static async*#m(){return arguments}}", 1],
  ["var C=class{static async #m(){return arguments}};", 1],
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

/** Slot-backed declarations bypass the named body environment. */
for (const [source, expected] of [
  ["function f(a){return a+1}", 0],
  ["function f(a=1){return a}", 0],
  ["function f(){var x=1;return x}", 0],
  ["function f(){let x=1;return x}", 0],
  ["function f(){function g(){}return g}", 0],
  ["function f(){eval('var x=1');return x}", 0],
  ["function f(){return function(){return 1}}", 0],
] as const)
  test(
    "slot-backed function bodies skip named instantiation: " + source,
    () => {
      assert.equal(bodyInstantiations(source), expected);
    },
  );

/** Count OrdinaryCallBindThis conversions (sloppyCallReceiver) in AOT Script
 * output. A sloppy function needs one only when its receiver can be read:
 * `this` or `super` in its body or nested arrows, or a direct eval in its
 * parameters, body or nested arrows. */
function receiverConversions(source: string): number {
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
        (node.callee.name === "sloppyCallReceiver" ||
          node.callee.name === "sloppyCallReceiverOrThrow")
      )
        count++;
      return node;
    },
  });
  return count;
}

for (const [source, expected] of [
  ["function f(a){return a+1}", 0],
  ["function f(){function g(a){return a}return g}", 0],
  ["var o={m(){return 1}};", 0],
  ["function f(){return ()=>1}", 0],
  ['function f(){"use strict";return this}', 0],
  ["function f(){return this}", 1],
  ["function f(){return ()=>this}", 1],
  ["function f(){return ()=>()=>this}", 1],
  ["function f(a=this){return a}", 1],
  ["var o={m(){return super.x}};", 1],
  ["function f(){eval('')}", 1],
  ["function f(a=eval('this')){return a}", 1],
  ["function f(){return ()=>eval('this')}", 1],
  ["function f(){return ()=>()=>eval('this')}", 1],
  ["function f(a=()=>eval('this')){return a()}", 1],
  ["function f(){return function(){return this}}", 1],
  ["function f(){with({})g()}", 0],
  ["function* g(){yield 1}", 1],
  ["async function f(){return 1}", 1],
] as const)
  test(
    "AOT receiver conversion only where the receiver is observable: " + source,
    () => {
      assert.equal(receiverConversions(source), expected);
    },
  );

/** Count function environments (createDeclarativeEnvironment) in AOT Script
 * output. A function with no parameters, declarations, annex B copies,
 * arguments object or direct eval binds nothing in its own environments, so
 * they are not created; class, block and function-name scopes stay. */
function environmentCreations(source: string): number {
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
        node.callee.name === "createDeclarativeEnvironment"
      )
        count++;
      return node;
    },
  });
  return count;
}

for (const [source, expected] of [
  ["1;", 0],
  ["function f(){return 1}", 0],
  ["var o={get v(){return this.x}};", 0],
  ["var g=()=>{return 1};", 0],
  ["var o={m(){return 1}};", 0],
  ["function f(a){return a}", 0],
  ["function f(){var v=1;return v}", 0],
  ["function f(){return arguments}", 1],
  ["function f(){let x=1;return x}", 0],
  ["function f(){function g(){}return g}", 0],
  ["var f=function n(){return n};", 0],
  ["var g=()=>1;", 0],
  ["function f(){return ()=>1}", 0],
  ["class C{m(){return 1}}", 1],
  ["function f(){{let y=1;}return 2}", 0],
  ["function* g(){yield 1}", 1],
  ["function f(){if(true)function h(){}}", 0],
  ['function f(){eval("")}', 2],
] as const)
  test(
    "AOT function environments are allocated for observable records: " + source,
    () => {
      assert.equal(environmentCreations(source), expected);
    },
  );
