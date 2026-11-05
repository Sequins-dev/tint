import { verifyHostedFixture } from "./hosted-fixture.ts";
import type { NativeHostBinding } from "@tint/compiler/native";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("shared buffer fixture requires TINT_BUILD_ONLY=1");
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const object = "packages/js-runtime/src/objects/index.ts";
const hostBindings: readonly NativeHostBinding[] = [
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
import {createNativeSharedBlockService,nativeSharedMemoryHost} from 'service';
import {createObject,createErrorRealm,installTypedArrayIntrinsics,setProperty,bigIntFromString,bigIntToString,viewBigIntValue,installSharedArrayBufferIntrinsics,installDataViewIntrinsics,installArrayBufferIntrinsics,createDataProperty,viewObjectValue,callObjectValue,constructObject,getProperty,detachArrayBuffer,type OrdinaryObject,type ScriptPropertyKey,type ObjectHooks} from 'object';
export function run():number {
  const created=createNativeSharedBlockService(nativeSharedMemoryHost(),{pageSize:16384,maxBlocks:16,maxReservedBytes:262144});
  if(!created.ok)return 1;
  const global=createObject<ScriptPropertyKey,unknown>(undefined);
  const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>{const result=callObjectValue(fn,receiver,args,global);if(result.error!=='none')throw 'CALL';return result.value;}};
  const realm=createErrorRealm(global,hooks);
  installSharedArrayBufferIntrinsics(global,realm,hooks,created.value);
  installDataViewIntrinsics(global,realm,hooks);
  installTypedArrayIntrinsics(global,realm,hooks,"little");
  installArrayBufferIntrinsics(global,realm,hooks);
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
  return 42;
}
`,
  "shared-array-buffer-api-v1",
  [
    ["service", "packages/native-runtime/src/shared-blocks.ts"],
    ["object", object],
  ],
  [],
  [
    { module: object, name: "viewObjectValue", operation: "view" },
    { module: object, name: "viewSymbolValue", operation: "view" },
    { module: object, name: "viewBigIntValue", operation: "view" },
  ],
  [
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
    runtimeEntry: "initializeCopyingRuntime",
    hostBindings,
  },
);
