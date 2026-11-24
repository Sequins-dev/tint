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

test("constant property keys skip ToPropertyKey and reads return values", () => {
  const source = "function f(o){o.x=1;var a=o.x;o.m(a);o.y+=1;return a}";
  assert.equal(calls(source, "objectPropertyKey"), 0);
  assert.equal(calls(source, "getObjectValueProperty"), 0);
  assert.equal(calls(source, "readCachedObjectValueProperty"), 3);
});

for (const [source, printed, completion] of [
  ["var o=null;o.x;", [], "TypeError"],
  ["var o;o.x;", [], "TypeError"],
  [
    "var o=null;function f(){print('rhs');return 1}o.x=f();",
    ["rhs"],
    "TypeError",
  ],
  ["var o=null;o.x+=1;", [], "TypeError"],
  ["print('ab'.length+','+(1.25).toFixed(1));", ["2,1.3"], "none"],
  [
    "Object.defineProperty(Number.prototype,'me',{get(){'use strict';return typeof this},configurable:true});print((1).me);",
    ["number"],
    "none",
  ],
  [
    "var o={k:3,m(){return this.k}};print(o.m()+','+o['m']());",
    ["3,3"],
    "none",
  ],
  ["var o={y:1};o.y+=2;o.y++;print(o.y);", ["4"], "none"],
  [
    "class A{get v(){return this.n}}class B extends A{constructor(){super();this.n=5}r(){return super.v}}print(new B().r());",
    ["5"],
    "none",
  ],
  [
    "var log=[];var k={toString(){log.push('key');return 'z'}};var o={z:7};print(o[k]+','+log.join());",
    ["7,key"],
    "none",
  ],
] as const)
  test("property access semantics: " + source.slice(0, 60), () => {
    const realm = createLoweredRealm();
    assert.equal(realm.run(source), completion);
    assert.deepEqual(realm.printed, printed);
  });

test("plain computed reads convert inside the fused read", () => {
  assert.equal(calls("function f(o,k){return o[k]}", "objectPropertyKey"), 0);
  assert.equal(
    calls("function f(o,k){return o[k]}", "readObjectValuePropertyKey"),
    1,
  );
  assert.equal(calls("function f(o,k){return o[k]}", "packedNumberElement"), 1);
  // Compound assignment reads a Number key's element directly; any other key
  // converts once and is retained for PutValue.
  const compound = "function f(o,k){o[k]+=1}";
  assert.equal(calls(compound, "packedNumberElement"), 1);
  assert.equal(calls(compound, "readObjectValuePropertyKey"), 1);
  assert.equal(calls(compound, "readObjectValueProperty"), 1);
  assert.equal(calls(compound, "objectPropertyKey"), 1);
  assert.equal(calls(compound, "writeObjectValuePropertyKey"), 1);
});

for (const [source, printed, completion] of [
  [
    "var log=[];var k={toString(){log.push('key');return 'z'}};var o=null;try{o[k]}catch(e){print(e.constructor.name+','+log.join())}",
    ["TypeError,"],
    "none",
  ],
  [
    "var s=Symbol('s');var o={[s]:1,'1':2};print(o[s]+','+o[1]+','+o['1']);",
    ["1,2,2"],
    "none",
  ],
  [
    "var log=[];var k={toString(){log.push('key');return 'z'}};var o={z:1};o[k]+=1;print(o.z+','+log.join());",
    ["2,key"],
    "none",
  ],
  [
    "var k={toString(){throw new RangeError('k')}};var o={};o[k];",
    [],
    "RangeError: k",
  ],
] as const)
  test("computed read semantics: " + source.slice(0, 60), () => {
    const realm = createLoweredRealm();
    assert.equal(realm.run(source), completion);
    assert.deepEqual(realm.printed, printed);
  });

test("number keys use Number::toString in computed reads and writes", () => {
  const realm = createLoweredRealm();
  assert.equal(
    realm.run(
      "var o={'1':'a','0':'z','1.5':'h','NaN':'n','1e+21':'e'};var w={};w[2]=1;w[-0]=2;print(o[1]+o[-0]+o[1.5]+o[NaN]+o[1e21]+','+Object.keys(w).join());",
    ),
    "none",
  );
  assert.deepEqual(realm.printed, ["azhne,0,2"]);
});
