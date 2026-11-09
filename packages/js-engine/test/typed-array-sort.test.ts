import assert from "node:assert/strict";
import test from "node:test";
import { createLoweredRealm } from "./lowered-node-host.ts";

const show =
  "function show(ta){var out=[];for(var i=0;i<ta.length;i++){var v=ta[i];out.push(Object.is(v,-0)?'-0':String(v))}print(out.join(','))}";

for (const [name, script, printed] of [
  [
    "default sort orders every numeric kind",
    "show(new Int8Array([3,-128,127,0,-1]).sort());" +
      "show(new Uint8Array([255,0,7,7,1]).sort());" +
      "show(new Uint8ClampedArray([9,300,-4,2]).sort());" +
      "show(new Int16Array([-32768,32767,0,-1,5]).sort());" +
      "show(new Uint16Array([65535,0,256,255]).sort());" +
      "show(new Int32Array([2147483647,-2147483648,0,3]).sort());" +
      "show(new Uint32Array([4294967295,0,1]).sort());" +
      "show(new Float32Array([NaN,1.5,-0,0,-Infinity,Infinity,-2]).sort());" +
      "show(new Float64Array([0,NaN,-0,1e308,-1e308,0.5]).sort());",
    [
      "-128,-1,0,3,127",
      "0,1,7,7,255",
      "0,2,9,255",
      "-32768,-1,0,5,32767",
      "0,255,256,65535",
      "-2147483648,0,3,2147483647",
      "0,1,4294967295",
      "-Infinity,-2,-0,0,1.5,Infinity,NaN",
      "-1e+308,-0,0,0.5,1e+308,NaN",
    ],
  ],
  [
    "default sort orders BigInt kinds",
    "show(new BigInt64Array([5n,-9n,0n]).sort());show(new BigUint64Array([18446744073709551615n,0n,2n]).sort());",
    ["-9,0,5", "0,2,18446744073709551615"],
  ],
  [
    "a large Int16 array sorts by counting and matches a comparator sort",
    "var n=70000,a=new Int16Array(n),b;for(var i=0;i<n;i++)a[i]=(i*7919)%65536-32768;b=a.slice();a.sort();b.sort(function(x,y){return x-y});var same=true;for(var j=0;j<n;j++)if(a[j]!==b[j])same=false;for(var k=1;k<n;k++)if(a[k-1]>a[k])same=false;print(same);print(a[0]);print(a[n-1])",
    ["true", "-32768", "32767"],
  ],
  [
    "toSorted returns a new sorted array and leaves the receiver",
    "var a=new Float64Array([3,1,2]),b=a.toSorted();show(a);show(b);print(b!==a);print(b.constructor===Float64Array)",
    ["3,1,2", "1,2,3", "true", "true"],
  ],
  [
    "a comparator sees the elements read before any comparison",
    "var a=new Int32Array([3,1,2]);a.sort(function(x,y){a[0]=99;a[1]=98;return x-y});show(a)",
    ["1,2,3"],
  ],
  [
    "a comparator that detaches the buffer leaves no stores",
    "var a=new Uint8Array([3,1,2]);var r=a.sort(function(x,y){if(a.length)a.buffer.transfer();return x-y});print(r===a);print(a.length)",
    ["true", "0"],
  ],
  [
    "a comparator that shrinks a resizable buffer stores only valid indices",
    "var rab=new ArrayBuffer(4,{maxByteLength:8}),a=new Uint8Array(rab);a.set([4,3,2,1]);a.sort(function(x,y){rab.resize(2);return x-y});show(a)",
    ["1,2"],
  ],
  [
    "a length-tracking view sorts its current window",
    "var rab=new ArrayBuffer(4,{maxByteLength:8}),a=new Int16Array(rab,2);a[0]=5;rab.resize(8);a.set([9,-1,4],0);show(a.sort())",
    ["-1,4,9"],
  ],
] as const)
  test("TypedArray sort: " + name, () => {
    const realm = createLoweredRealm();
    assert.equal(realm.run(show + script), "none");
    assert.deepEqual(realm.printed, printed);
  });

for (const [name, script, printed] of [
  [
    "Number keys ignore inherited numeric properties and edge keys",
    "Object.prototype[5]='o';Int8Array.prototype[-1]='p';var a=new Int8Array([1,2,3]);var k=[0,-0,2,3,5,-1,1.5,NaN,Infinity,1e21];var out=[];for(var i=0;i<k.length;i++)out.push(String(a[k[i]]));print(out.join(','))",
    [
      "1,1,3,undefined,undefined,undefined,undefined,undefined,undefined,undefined",
    ],
  ],
  [
    "Number keys follow resize and detach",
    "var rab=new ArrayBuffer(4,{maxByteLength:8}),f=new Uint8Array(rab,0,4),t=new Uint8Array(rab);f[3]=9;var r=[f[3],t[3]];rab.resize(2);r.push(f[0],t[1],t[3]);rab.resize(8);r.push(f[3],t[7]);rab.transfer();r.push(f[0],t[0]);print(r.map(String).join(','))",
    ["9,9,undefined,0,undefined,0,0,undefined,undefined"],
  ],
  [
    "subclass instances and proxies keep their semantics",
    "class S extends Float64Array{};var s=new S([1.5,2.5]);var p=new Proxy(new Int16Array([4,5]),{get(t,k,r){print('get '+String(k));return Reflect.get(t,k,r)}});print(String(s[1]));print(String(p[1]))",
    ["2.5", "get 1", "5"],
  ],
] as const)
  test("TypedArray keyed reads: " + name, () => {
    const realm = createLoweredRealm();
    assert.equal(realm.run(script), "none");
    assert.deepEqual(realm.printed, printed);
  });
