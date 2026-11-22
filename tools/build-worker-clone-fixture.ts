import type { NativeHostBinding } from "@tint/compiler/native";
import { verifyHostedFixture } from "./hosted-fixture.ts";

// The binary structured-clone codec over a raw mapping, as Worker packets
// use it: aliases and cycles, -0, BigInt, bulk strings, binary64 and packed
// number arrays.
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The worker clone fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";

const object = "packages/js-runtime/src/objects/index.ts";
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const views = ["viewObjectValue", "viewSymbolValue", "viewBigIntValue"];
const bindings: readonly NativeHostBinding[] = [
  { module: memory, name: "mapMemory", operation: "memory-map" },
  { module: memory, name: "unmapMemory", operation: "memory-unmap" },
  {
    module: memory,
    name: "readMemoryFloat64",
    operation: "memory-read-float64",
  },
  {
    module: memory,
    name: "writeMemoryFloat64",
    operation: "memory-write-float64",
  },
  { module: memory, name: "readMemoryString", operation: "memory-read-string" },
  {
    module: memory,
    name: "writeMemoryString",
    operation: "memory-write-string",
  },
];
verifyHostedFixture(
  `
import {createObject,createErrorRealm,createDataProperty,createArrayObject,getOwnProperty,viewObjectValue,callObjectValue,bigIntFromString,bigIntToString,viewBigIntValue,serializeWorkerValue,deserializeWorkerValue,type ScriptPropertyKey,type ObjectHooks,type WorkerCloneSink,type WorkerCloneSource} from 'object';
import {mapMemory,unmapMemory} from 'memory';
import {nativePacketMemory} from 'packets';
export function run():number {
  const first=createObject<ScriptPropertyKey,unknown>(undefined);
  const second=createObject<ScriptPropertyKey,unknown>(undefined);
  const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>{const result=callObjectValue(fn,receiver,args,first);if(result.error!=="none")throw "CALL";return result.value;}};
  const from=createErrorRealm(first,hooks),to=createErrorRealm(second,hooks);
  const root=createObject<ScriptPropertyKey,unknown>(first);
  const child=createObject<ScriptPropertyKey,unknown>(first);
  createDataProperty<ScriptPropertyKey,unknown>(root,"left",child,hooks);
  createDataProperty<ScriptPropertyKey,unknown>(root,"right",child,hooks);
  createDataProperty<ScriptPropertyKey,unknown>(child,"parent",root,hooks);
  createDataProperty<ScriptPropertyKey,unknown>(child,"zero",-0,hooks);
  createDataProperty<ScriptPropertyKey,unknown>(child,"large",bigIntFromString("9007199254740993"),hooks);
  createDataProperty<ScriptPropertyKey,unknown>(child,"half",0.5,hooks);
  const text="units \\ud800 ".repeat(1000);
  createDataProperty<ScriptPropertyKey,unknown>(child,"text",text,hooks);
  const numbers=createArrayObject<ScriptPropertyKey,unknown>(0,from.arrayPrototype,from.arrayHooks,hooks);
  for(let index=0;index<3000;index++)
    createDataProperty<ScriptPropertyKey,unknown>(numbers,String(index),index*1.25,hooks);
  createDataProperty<ScriptPropertyKey,unknown>(root,"numbers",numbers,hooks);
  // The packet starts as one small mapping and grows by remapping.
  const packets=nativePacketMemory();
  let base=mapMemory(4096),length=4096;
  if(base<=0)return 6;
  const sink:WorkerCloneSink={
    bytes:packets.view(base,length),
    grow:(used:number,needed:number):void=>{
      const size=Math.max(length*2,Math.ceil((used+needed)/4096)*4096);
      const next=mapMemory(size);
      if(next<=0)throw "clone fixture map";
      const bytes=packets.view(next,size);
      bytes.set(sink.bytes.subarray(0,used));
      if(unmapMemory(base,length)!==0)throw "clone fixture unmap";
      base=next;length=size;sink.bytes=bytes;
    },
    writeFloat64:(offset:number,value:number):void=>{
      if(packets.writeFloat64(base,length,offset,value)!==0)throw "clone fixture float";
    },
    writeString:(offset:number,value:string):void=>{
      if(packets.writeString(base,length,offset,value)!==0)throw "clone fixture string";
    },
  };
  const end=serializeWorkerValue(root,from,sink,0);
  const source:WorkerCloneSource={
    bytes:sink.bytes,
    readFloat64:(offset:number):number=>packets.readFloat64(base,length,offset),
    readString:(offset:number,units:number):string=>packets.readString(base,length,offset,units),
  };
  const result=viewObjectValue(deserializeWorkerValue(source,0,end,to),second);
  if(unmapMemory(base,length)!==0)return 7;
  if(result===undefined||result===root||result.prototype!==second)return 1;
  const copy=viewObjectValue(getOwnProperty<ScriptPropertyKey,unknown>(result,"left")?.value,second);
  if(copy===undefined||copy===child||copy!==getOwnProperty<ScriptPropertyKey,unknown>(result,"right")?.value)return 2;
  if(getOwnProperty<ScriptPropertyKey,unknown>(copy,"parent")?.value!==result)return 3;
  const zero=getOwnProperty<ScriptPropertyKey,unknown>(copy,"zero")?.value;
  if(typeof zero!=="number"||1/zero!==-Infinity)return 4;
  const big=viewBigIntValue(getOwnProperty<ScriptPropertyKey,unknown>(copy,"large")?.value);
  if(big===undefined||bigIntToString(big,10)!=="9007199254740993")return 5;
  if(getOwnProperty<ScriptPropertyKey,unknown>(copy,"half")?.value!==0.5)return 8;
  if(getOwnProperty<ScriptPropertyKey,unknown>(copy,"text")?.value!==text)return 9;
  const cloned=viewObjectValue(getOwnProperty<ScriptPropertyKey,unknown>(result,"numbers")?.value,second);
  if(cloned===undefined||getOwnProperty<ScriptPropertyKey,unknown>(cloned,"length")?.value!==3000)return 10;
  for(let index=0;index<3000;index++)
    if(getOwnProperty<ScriptPropertyKey,unknown>(cloned,String(index))?.value!==index*1.25)return 11;
  return 42;
}
`,
  "worker-clone",
  [
    ["object", object],
    ["memory", memory],
    ["packets", "packages/native-runtime/src/packet-memory.ts"],
  ],
  [],
  views.map((name) => ({ module: object, name, operation: "view" })),
  [{ module: object, namespace: "ordinary-object", retainedExports: views }],
  {
    managedBytes: 16777216,
    allocationCapacity: 262144,
    stackBytes: 16777216,
    requireTyped: true,
    hostBindings: bindings,
  },
);
