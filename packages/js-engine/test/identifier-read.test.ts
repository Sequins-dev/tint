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

test("AOT reads use local slots and fused global lookup", () => {
  const source = "function f(a){return a+b}var b=1;f(2);";
  // The callback parameter is a slot. Both globals still use the fused helper.
  assert.equal(calls(source, "getIdentifierValue"), 2);
  assert.equal(calls(source, "getBindingReference"), 0);
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

/** Without any `with` in the unit, identifier callees read like plain
 * identifiers and pass an undefined receiver; `with` keeps the reference. */
for (const [source, thisValues, fused] of [
  ["function f(a){return a}f(1);", 0, 1],
  ["function f(){}with({}){}f();", 1, 0],
  ["var o={m(){return this}};with(o){m()}", 1, 0],
] as const)
  test("identifier callee receiver lowering: " + source, () => {
    assert.equal(calls(source, "getBindingThisValue"), thisValues);
    assert.ok(calls(source, "getIdentifierValue") >= fused);
  });

for (const [source, printed, completion] of [
  ["function g(){return this}print(g()===this);", ["true"], "none"],
  ['"use strict";function g(){return this}print(g());', ["undefined"], "none"],
  ["var o={m(){return this}};with(o){print(m()===o)}", ["true"], "none"],
  ["undeclaredFunction();", [], "ReferenceError"],
  [
    "var f=function(){print('first')};f(f=function(){print('second')});",
    ["first"],
    "none",
  ],
] as const)
  test("identifier callee semantics: " + source, () => {
    const realm = createLoweredRealm();
    assert.equal(realm.run(source), completion);
    assert.deepEqual(realm.printed, printed);
  });

/** Global reads walk an all-ordinary prototype chain once; an exotic object on
 * the chain keeps the specified HasProperty, HasProperty, Get sequence. */
for (const [source, printed, completion] of [
  [
    "Object.defineProperty(this,'acc',{get(){return this===globalThis},configurable:true});print(acc);",
    ["true"],
    "none",
  ],
  [
    "print(typeof toString);print(hasOwnProperty===Object.prototype.hasOwnProperty);",
    ["function", "true"],
    "none",
  ],
  ["print(typeof tdz);let tdz=1;", [], "ReferenceError"],
  ["var gv=5;gv=gv+1;print(gv);", ["6"], "none"],
  [
    "var log=[];var p=new Proxy(Object.prototype,{has(t,k){if(k==='zz')log.push('has');return Reflect.has(t,k)||k==='zz'},get(t,k,r){if(k==='zz'){log.push('get');return 7}return Reflect.get(t,k,r)}});Object.setPrototypeOf(globalThis,p);var r=zz;Object.setPrototypeOf(globalThis,Object.prototype);print(r);print(log.join());",
    ["7", "has,has,get"],
    "none",
  ],
] as const)
  test("global identifier read semantics: " + source.slice(0, 60), () => {
    const realm = createLoweredRealm();
    assert.equal(realm.run(source), completion);
    assert.deepEqual(realm.printed, printed);
  });

/** Reference-based global reads (read-modify-write) use one walk on an
 * ordinary chain; a Proxy prototype still sees HasProperty, HasProperty, Get. */
for (const [source, printed, completion] of [
  ["var c=1;c+=2;c++;print(c);", ["4"], "none"],
  [
    "Object.defineProperty(this,'acc2',{get(){return this===globalThis?10:0},set(v){print('set '+v)},configurable:true});acc2+=1;",
    ["set 11"],
    "none",
  ],
  ['"use strict";missingGlobal+=1;', [], "ReferenceError"],
  [
    "var log=[];var p=new Proxy(Object.prototype,{has(t,k){if(k==='zz')log.push('has');return Reflect.has(t,k)||k==='zz'},get(t,k,r){if(k==='zz'){log.push('get');return 7}return Reflect.get(t,k,r)},set(t,k,v,r){return true}});Object.setPrototypeOf(globalThis,p);zz+=1;Object.setPrototypeOf(globalThis,Object.prototype);print(log.join());",
    ["has,has,get"],
    "none",
  ],
] as const)
  test("global reference read semantics: " + source.slice(0, 60), () => {
    const realm = createLoweredRealm();
    assert.equal(realm.run(source), completion);
    assert.deepEqual(realm.printed, printed);
  });
