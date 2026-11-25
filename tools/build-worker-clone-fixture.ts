import type { NativeHostBinding } from "@tint/compiler/native";
import { verifyHostedFixture } from "./hosted-fixture.ts";

// The binary structured-clone codec over a raw mapping, as Worker packets
// use it: aliases and cycles, -0, BigInt, bulk strings, binary64, packed
// number arrays, and a typed program's typed array, alone and before a
// back-referenced object in the same message.
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The worker clone fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";

const object = "packages/js-runtime/src/objects/index.ts";
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const packet = "packages/native-runtime/src/intrinsics/packet-memory.ts";
const views = ["viewObjectValue", "viewSymbolValue", "viewBigIntValue"];
const bindings: readonly NativeHostBinding[] = [
  { module: memory, name: "mapMemory", operation: "memory-map" },
  { module: memory, name: "unmapMemory", operation: "memory-unmap" },
  {
    module: packet,
    name: "readMemoryFloat64",
    operation: "memory-read-float64",
  },
  {
    module: packet,
    name: "writeMemoryFloat64",
    operation: "memory-write-float64",
  },
  { module: packet, name: "readMemoryString", operation: "memory-read-string" },
  {
    module: packet,
    name: "writeMemoryString",
    operation: "memory-write-string",
  },
];
verifyHostedFixture(
  `
import {createObject,createErrorRealm,createDataProperty,createArrayObject,exoticSlots,getOwnProperty,viewObjectValue,callObjectValue,bigIntFromString,bigIntToString,viewBigIntValue,serializeWorkerValue,deserializeWorkerValue,type ScriptPropertyKey,type ObjectHooks,type WorkerCloneSink,type WorkerCloneSource} from 'object';
import {byteStorageData} from 'bytes';
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
  // A typed program's own typed array arrives as the realm typed array it
  // reads as, with its whole buffer.
  const backing=new ArrayBuffer(12);
  const all=new Uint8Array(backing);
  for(let index=0;index<12;index++)all[index]=index;
  const view=new Uint16Array(backing,4,3);
  const packet=mapMemory(4096);
  if(packet<=0)return 12;
  const viewSink:WorkerCloneSink={
    bytes:packets.view(packet,4096),
    grow:(used:number,needed:number):void=>{throw "clone fixture view grow";},
    writeFloat64:(offset:number,value:number):void=>{
      if(packets.writeFloat64(packet,4096,offset,value)!==0)throw "clone fixture view float";
    },
    writeString:(offset:number,value:string):void=>{
      if(packets.writeString(packet,4096,offset,value)!==0)throw "clone fixture view string";
    },
  };
  const viewEnd=serializeWorkerValue(view,from,viewSink,0);
  const viewSource:WorkerCloneSource={
    bytes:viewSink.bytes,
    readFloat64:(offset:number):number=>packets.readFloat64(packet,4096,offset),
    readString:(offset:number,units:number):string=>packets.readString(packet,4096,offset,units),
  };
  const realmView=viewObjectValue(deserializeWorkerValue(viewSource,0,viewEnd,to),second);
  if(unmapMemory(packet,4096)!==0)return 13;
  const data=realmView===undefined?undefined:exoticSlots(realmView).internalTypedArrayData;
  if(data===undefined||data.kind!=="Uint16"||data.byteOffset!==4||data.length!==3)return 14;
  const copied=exoticSlots(data.buffer).internalArrayBufferData;
  const copiedBytes=copied===undefined?undefined:byteStorageData(copied);
  if(copiedBytes===undefined||copiedBytes.length!==12||copiedBytes[11]!==11||copiedBytes[4]!==4)return 15;
  // A typed array, then an object named twice, in one message: the decoder
  // allocates two objects (the view and its buffer) for the typed array, so
  // the back-reference must count them.
  const message=createObject<ScriptPropertyKey,unknown>(first);
  const repeated=createObject<ScriptPropertyKey,unknown>(first);
  createDataProperty<ScriptPropertyKey,unknown>(repeated,"mark",7,hooks);
  createDataProperty<ScriptPropertyKey,unknown>(message,"view",view,hooks);
  createDataProperty<ScriptPropertyKey,unknown>(message,"first",repeated,hooks);
  createDataProperty<ScriptPropertyKey,unknown>(message,"second",repeated,hooks);
  const both=mapMemory(4096);
  if(both<=0)return 16;
  const bothSink:WorkerCloneSink={
    bytes:packets.view(both,4096),
    grow:(used:number,needed:number):void=>{throw "clone fixture message grow";},
    writeFloat64:(offset:number,value:number):void=>{
      if(packets.writeFloat64(both,4096,offset,value)!==0)throw "clone fixture message float";
    },
    writeString:(offset:number,value:string):void=>{
      if(packets.writeString(both,4096,offset,value)!==0)throw "clone fixture message string";
    },
  };
  const bothEnd=serializeWorkerValue(message,from,bothSink,0);
  const bothSource:WorkerCloneSource={
    bytes:bothSink.bytes,
    readFloat64:(offset:number):number=>packets.readFloat64(both,4096,offset),
    readString:(offset:number,units:number):string=>packets.readString(both,4096,offset,units),
  };
  const received=viewObjectValue(deserializeWorkerValue(bothSource,0,bothEnd,to),second);
  if(unmapMemory(both,4096)!==0)return 17;
  if(received===undefined)return 18;
  const firstCopy=viewObjectValue(getOwnProperty<ScriptPropertyKey,unknown>(received,"first")?.value,second);
  if(firstCopy===undefined||firstCopy!==getOwnProperty<ScriptPropertyKey,unknown>(received,"second")?.value)return 19;
  if(getOwnProperty<ScriptPropertyKey,unknown>(firstCopy,"mark")?.value!==7)return 20;
  const viewCopy=viewObjectValue(getOwnProperty<ScriptPropertyKey,unknown>(received,"view")?.value,second);
  if(viewCopy===undefined||exoticSlots(viewCopy).internalTypedArrayData?.length!==3)return 21;
  return 42;
}
`,
  "worker-clone",
  [
    ["object", object],
    ["memory", memory],
    ["packets", "packages/native-runtime/src/packet-memory.ts"],
    ["bytes", "packages/js-runtime/src/bytes/index.ts"],
  ],
  [],
  views.map((name) => ({ module: object, name, operation: "view" })),
  [
    { module: object, namespace: "ordinary-object", retainedExports: views },
    {
      module: packet,
      namespace: "worker-clone-packet-memory",
      retainedExports: bindings
        .filter((binding) => binding.module === packet)
        .map((binding) => binding.name),
    },
  ],
  {
    managedBytes: 16777216,
    allocationCapacity: 262144,
    stackBytes: 16777216,
    requireTyped: true,
    hostBindings: bindings,
  },
);
