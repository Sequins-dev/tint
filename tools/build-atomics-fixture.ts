import { verifyHostedFixture } from "./hosted-fixture.ts";
import type { NativeHostBinding } from "@tint/compiler/native";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("shared buffer fixture requires TINT_BUILD_ONLY=1");
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const object = "packages/js-runtime/src/objects/index.ts";
const spin = "packages/native-runtime/src/intrinsics/spin-hint.ts";
const hostBindings: readonly NativeHostBinding[] = [
  {
    module: shared,
    name: "compareExchangeSharedUnsigned",
    operation: "shared-compare-exchange-unsigned",
  },
  { module: spin, name: "cpuPause", operation: "cpu-pause" },
  { module: memory, name: "mapMemory", operation: "memory-map" },
  { module: memory, name: "unmapMemory", operation: "memory-unmap" },
  {
    module: shared,
    name: "readSharedUnsigned",
    operation: "shared-read-unsigned",
  },
  {
    module: shared,
    name: "writeSharedUnsigned",
    operation: "shared-write-unsigned",
  },
  { module: shared, name: "readSharedWord64", operation: "shared-read-word64" },
  {
    module: shared,
    name: "writeSharedWord64",
    operation: "shared-write-word64",
  },
  {
    module: shared,
    name: "compareExchangeSharedWord64",
    operation: "shared-compare-exchange-word64",
  },
];
verifyHostedFixture(
  `
import {cpuPause} from 'spin';
import {createNativeSharedBlockService,nativeSharedMemoryHost,nativeSharedAtomicMemoryHost} from 'service';
import {createObject,createCallableObject,createErrorRealm,installAtomicsIntrinsics,installTypedArrayIntrinsics,setProperty,bigIntFromString,bigIntToString,viewBigIntValue,installSharedArrayBufferIntrinsics,installDataViewIntrinsics,installArrayBufferIntrinsics,createDataProperty,viewObjectValue,callObjectValue,constructObject,getProperty,detachArrayBuffer,type OrdinaryObject,type ScriptPropertyKey,type ObjectHooks} from 'object';
export function run():number {
  const created=createNativeSharedBlockService(nativeSharedMemoryHost(),{pageSize:16384,maxBlocks:16,maxReservedBytes:262144},nativeSharedAtomicMemoryHost());
  if(!created.ok)return 1;
  const global=createObject<ScriptPropertyKey,unknown>(undefined);
  const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>{const result=callObjectValue(fn,receiver,args,global);if(result.error!=='none')throw 'CALL';return result.value;}};
  const realm=createErrorRealm(global,hooks);
  installSharedArrayBufferIntrinsics(global,realm,hooks,created.value);
  installDataViewIntrinsics(global,realm,hooks);
  installTypedArrayIntrinsics(global,realm,hooks,"little");
  installArrayBufferIntrinsics(global,realm,hooks);
  installAtomicsIntrinsics(global,realm,hooks,{lockFree1:true,lockFree2:true,lockFree8:true},():void=>{cpuPause();});
  const constructor=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(global,'SharedArrayBuffer',global,hooks),global);
  if(constructor===undefined)return 2;
  const options=createObject<ScriptPropertyKey,unknown>(undefined);
  createDataProperty<ScriptPropertyKey,unknown>(options,'maxByteLength',32,hooks);
  const made=constructObject<ScriptPropertyKey,unknown>(constructor,[8,options],{object:constructor,value:constructor},undefined);
  if(made.error!=='none')return 3;
  const buffer=viewObjectValue(made.value,global);
  if(buffer===undefined)return 4;
  const dataView=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(global,'DataView',global,hooks),global);
  if(dataView===undefined)return 5;
  const trackingMade=constructObject<ScriptPropertyKey,unknown>(dataView,[buffer,1],{object:dataView,value:dataView},undefined);
  const tracking=viewObjectValue(trackingMade.value,global);
  if(tracking===undefined)return 6;
  function invoke(value:OrdinaryObject<ScriptPropertyKey,unknown>,name:string,args:unknown[]):unknown {
    const fn=getProperty<ScriptPropertyKey,unknown>(value,name,value,hooks);
    const result=callObjectValue(fn,value,args,global);
    if(result.error!=='none')throw 'METHOD';
    return result.value;
  }
  invoke(tracking,'setUint32',[1,4294967295,true]);
  if(invoke(tracking,'getUint32',[1,false])!==4294967295)return 7;
  invoke(tracking,'setUint16',[1,4660,false]);
  if(invoke(tracking,'getUint16',[1,true])!==13330)return 8;
  invoke(buffer,'grow',[24]);
  if(getProperty<ScriptPropertyKey,unknown>(buffer,'byteLength',buffer,hooks)!==24)return 9;
  if(getProperty<ScriptPropertyKey,unknown>(tracking,'byteLength',tracking,hooks)!==23)return 10;
  if(invoke(tracking,'getUint8',[22])!==0)return 11;
  const copy=viewObjectValue(invoke(buffer,'slice',[1,5]),global);
  if(copy===undefined||getProperty<ScriptPropertyKey,unknown>(copy,'byteLength',copy,hooks)!==4)return 12;
  let caught=false;
  try{detachArrayBuffer(buffer,realm);}catch(error){const e=viewObjectValue(error,global);caught=e!==undefined&&e.prototype===realm.prototypes.get('type');}
  if(!caught)return 13;
  const uint32=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(global,'Uint32Array',global,hooks),global);
  if(uint32===undefined)return 14;
  const typed=viewObjectValue(constructObject<ScriptPropertyKey,unknown>(uint32,[buffer],{object:uint32,value:uint32},undefined).value,global);
  if(typed===undefined||getProperty<ScriptPropertyKey,unknown>(typed,'length',typed,hooks)!==6)return 15;
  for(let i=0;i<6;i++)setProperty<ScriptPropertyKey,unknown>(typed,String(i),i+1,{object:typed,value:typed},hooks);
  invoke(typed,'reverse',[]);
  if(getProperty<ScriptPropertyKey,unknown>(typed,'0',typed,hooks)!==6)return 16;
  invoke(typed,'copyWithin',[1,0,3]);
  if(getProperty<ScriptPropertyKey,unknown>(typed,'3',typed,hooks)!==4)return 17;
  const uint64=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(global,'BigUint64Array',global,hooks),global);
  if(uint64===undefined)return 18;
  const big=viewObjectValue(constructObject<ScriptPropertyKey,unknown>(uint64,[buffer],{object:uint64,value:uint64},undefined).value,global);
  const allOnes=bigIntFromString('18446744073709551615');
  if(big===undefined||allOnes===undefined)return 19;
  setProperty<ScriptPropertyKey,unknown>(big,'0',allOnes,{object:big,value:big},hooks);
  const observed=viewBigIntValue(getProperty<ScriptPropertyKey,unknown>(big,'0',big,hooks));
  if(observed===undefined||bigIntToString(observed,10)!=='18446744073709551615')return 20;
  const atomics=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(global,'Atomics',global,hooks),global);
  if(atomics===undefined)return 21;
  if(invoke(atomics,'store',[typed,0,4294967295])!==4294967295)return 22;
  if(invoke(atomics,'load',[typed,0])!==4294967295)return 23;
  if(invoke(atomics,'store',[big,0,allOnes])!==allOnes)return 24;
  const loaded=viewBigIntValue(invoke(atomics,'load',[big,0]));
  if(loaded===undefined||bigIntToString(loaded,10)!=='18446744073709551615')return 25;
  if(invoke(atomics,'pause',[])!==undefined)return 26;
  if(invoke(atomics,'compareExchange',[typed,0,4294967295,42])!==4294967295)return 27;
  if(invoke(atomics,'load',[typed,0])!==42)return 28;
  if(invoke(atomics,'compareExchange',[typed,0,19,99])!==42)return 29;
  if(invoke(atomics,'load',[typed,0])!==42)return 30;
  invoke(atomics,'store',[big,0,allOnes]);
  const exchanged=viewBigIntValue(invoke(atomics,'compareExchange',[big,0,allOnes,'9223372036854775808']));
  if(exchanged===undefined||bigIntToString(exchanged,10)!=='18446744073709551615')return 31;
  const after=viewBigIntValue(invoke(atomics,'load',[big,0]));
  if(after===undefined||bigIntToString(after,10)!=='9223372036854775808')return 32;
  if(invoke(atomics,'exchange',[typed,0,7])!==0)return 33;
  if(invoke(atomics,'add',[typed,0,3])!==7)return 34;
  if(invoke(atomics,'sub',[typed,0,11])!==10)return 35;
  if(invoke(atomics,'and',[typed,0,15])!==4294967295)return 36;
  if(invoke(atomics,'xor',[typed,0,3])!==15)return 37;
  if(invoke(atomics,'or',[typed,0,16])!==12)return 38;
  if(invoke(atomics,'load',[typed,0])!==28)return 39;
  invoke(atomics,'store',[big,0,allOnes]);
  const beforeAdd=viewBigIntValue(invoke(atomics,'add',[big,0,'2']));
  if(beforeAdd===undefined||bigIntToString(beforeAdd,10)!=='18446744073709551615')return 40;
  const wrapped=viewBigIntValue(invoke(atomics,'load',[big,0]));
  if(wrapped===undefined||bigIntToString(wrapped,10)!=='1')return 41;
  invoke(atomics,'sub',[big,0,'2']);
  invoke(atomics,'and',[big,0,'9223372036854775808']);
  invoke(atomics,'xor',[big,0,allOnes]);
  invoke(atomics,'or',[big,0,'9223372036854775808']);
  const final=viewBigIntValue(invoke(atomics,'exchange',[big,0,'0']));
  if(final===undefined||bigIntToString(final,10)!=='18446744073709551615')return 43;
  function checkNarrow(name:string,atomics:OrdinaryObject<ScriptPropertyKey,unknown>):number {
    const ctor=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(global,name,global,hooks),global);
    if(ctor===undefined)return 44;
    const view=viewObjectValue(constructObject<ScriptPropertyKey,unknown>(ctor,[buffer],{object:ctor,value:ctor},undefined).value,global);
    if(view===undefined)return 45;
    invoke(atomics,'store',[view,0,255]);
    if(invoke(atomics,'exchange',[view,0,7])!==(name==='Int8Array'?-1:255))return 46;
    invoke(atomics,'store',[view,0,65535]);
    if(invoke(atomics,'add',[view,0,2])!==(name==='Int8Array'?-1:65535))return 47;
    if(invoke(atomics,'load',[view,0])!==1)return 48;
    if(invoke(atomics,'compareExchange',[view,0,1,65535])!==1)return 49;
    if(invoke(atomics,'load',[view,0])!==(name==='Int8Array'?-1:65535))return 50;
    return 0;
  }
  const int8Result=checkNarrow('Int8Array',atomics);if(int8Result!==0)return int8Result;
  const uint16Result=checkNarrow('Uint16Array',atomics);if(uint16Result!==0)return uint16Result;
  const ordinaryCtor=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(global,'ArrayBuffer',global,hooks),global);
  const int32Ctor=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(global,'Int32Array',global,hooks),global);
  if(ordinaryCtor===undefined||int32Ctor===undefined)return 51;
  const ordinary=viewObjectValue(constructObject<ScriptPropertyKey,unknown>(ordinaryCtor,[8],{object:ordinaryCtor,value:ordinaryCtor},undefined).value,global);
  if(ordinary===undefined)return 52;
  const ordinaryView=viewObjectValue(constructObject<ScriptPropertyKey,unknown>(int32Ctor,[ordinary],{object:int32Ctor,value:int32Ctor},undefined).value,global);
  if(ordinaryView===undefined)return 53;
  if(invoke(atomics,'notify',[ordinaryView,0])!==0)return 54;
  const count=createObject<ScriptPropertyKey,unknown>(realm.objectPrototype);
  createDataProperty<ScriptPropertyKey,unknown>(count,'valueOf',createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{detachArrayBuffer(ordinary,realm);return 3;}),hooks);
  if(invoke(atomics,'notify',[ordinaryView,0,count])!==0)return 55;
  const sharedWaitable=viewObjectValue(constructObject<ScriptPropertyKey,unknown>(int32Ctor,[buffer],{object:int32Ctor,value:int32Ctor},undefined).value,global);
  if(sharedWaitable===undefined)return 56;
  let unsupported=false;
  try{invoke(atomics,'notify',[sharedWaitable,0,0]);}catch(error){unsupported=error===undefined&&realm.unsupported;}
  if(!unsupported)return 57;
  realm.unsupported=false;
  let order=0;
  function numericHook(step:number,value:number):OrdinaryObject<ScriptPropertyKey,unknown>{
    const hook=createObject<ScriptPropertyKey,unknown>(realm.objectPrototype);
    createDataProperty<ScriptPropertyKey,unknown>(hook,'valueOf',createCallableObject<ScriptPropertyKey,unknown>(realm.functionPrototype,(receiver,args):unknown=>{order=order*10+step;return value;}),hooks);
    return hook;
  }
  let waitTypeError=false;
  try{invoke(atomics,'wait',[sharedWaitable,numericHook(1,0),numericHook(2,7),numericHook(3,0)]);}catch(error){const typedError=viewObjectValue(error,global);waitTypeError=typedError!==undefined&&typedError.prototype===realm.prototypes.get('type');}
  if(!waitTypeError||order!==123||realm.unsupported)return 58;
  let asyncUnsupported=false;
  try{invoke(atomics,'waitAsync',[sharedWaitable,0,0,0]);}catch(error){asyncUnsupported=error===undefined&&realm.unsupported;}
  if(!asyncUnsupported)return 59;
  return 42;
}
`,
  "atomics-v3",
  [
    ["service", "packages/native-runtime/src/shared-blocks.ts"],
    ["object", object],
    ["spin", spin],
  ],
  [],
  [
    { module: object, name: "viewObjectValue", operation: "view" },
    { module: object, name: "viewSymbolValue", operation: "view" },
    { module: object, name: "viewBigIntValue", operation: "view" },
  ],
  [
    {
      module: spin,
      namespace: "native-spin-hint",
      retainedExports: ["cpuPause"],
    },
    {
      module: memory,
      namespace: "native-memory",
      retainedExports: ["mapMemory", "unmapMemory"],
    },
    {
      module: shared,
      namespace: "shared-primitives-fixture",
      retainedExports: hostBindings
        .filter((binding) => binding.module === shared)
        .map((binding) => binding.name),
    },
    {
      module: object,
      namespace: "ordinary-object",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
      ],
    },
  ],
  {
    managedBytes: 16777216,
    allocationCapacity: 262144,
    runtimeEntry: "initializeGenerationalRuntime",
    hostBindings,
  },
);
