import assert from "node:assert/strict";
import test from "node:test";
import { createLoweredRealm } from "./lowered-node-host.ts";

/** [[Set]] semantics around the own-writable-data fast path: exotic targets,
 * arguments aliases, other receivers and attribute checks keep the general
 * OrdinarySet path. */
for (const [source, printed, completion] of [
  ["var o={a:1};o.a=2;print(o.a);", ["2"], "none"],
  [
    "var o={a:1};Object.defineProperty(o,'a',{enumerable:false});o.a=3;var d=Object.getOwnPropertyDescriptor(o,'a');print(d.value+','+d.writable+','+d.enumerable+','+d.configurable);",
    ["3,true,false,true"],
    "none",
  ],
  ["var o=Object.freeze({a:1});o.a=2;print(o.a);", ["1"], "none"],
  ['"use strict";var o=Object.freeze({a:1});o.a=2;', [], "TypeError"],
  [
    "var p={set a(v){print('set '+v)}};var o=Object.create(p);o.a=4;print(Object.prototype.hasOwnProperty.call(o,'a'));",
    ["set 4", "false"],
    "none",
  ],
  [
    "var p=Object.defineProperty({},'a',{value:1,writable:false});var o=Object.create(p);o.a=2;print(o.a);",
    ["1"],
    "none",
  ],
  ["var a=[1,2];a[1]=5;a[3]=7;print(a.length+','+a[1]);", ["4,5"], "none"],
  [
    "var a=[1,2,3];a.length=1;a.length=a.length;print(a.length+','+a[1]+','+(1 in a));",
    ["1,undefined,false"],
    "none",
  ],
  [
    '"use strict";var a=[1];Object.defineProperty(a,"length",{writable:false});a.length=5;',
    [],
    "TypeError",
  ],
  ["function f(x){arguments[0]=9;return x}print(f(1));", ["9"], "none"],
  ["function f(x){x=8;return arguments[0]}print(f(1));", ["8"], "none"],
  [
    "var t={a:1},r={a:2};Reflect.set(t,'a',3,r);print(t.a+','+r.a);",
    ["1,3"],
    "none",
  ],
  ["var g=1;g=2;print(g+','+globalThis.g);", ["2,2"], "none"],
  [
    "var log=[];var p=new Proxy({a:1},{defineProperty(t,k,d){log.push('define '+String(k));return Reflect.defineProperty(t,k,d)}});p.a=2;print(log.join()+';'+p.a);",
    ["define a;2"],
    "none",
  ],
] as const)
  test("property write semantics: " + source.slice(0, 60), () => {
    const realm = createLoweredRealm();
    assert.equal(realm.run(source), completion);
    assert.deepEqual(realm.printed, printed);
  });
