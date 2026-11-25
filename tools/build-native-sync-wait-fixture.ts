import { verifyHostedFixture } from "./hosted-fixture.ts";
if (process.env.TINT_BUILD_ONLY !== "1") throw Error("build-only fixture");
const memory = "packages/native-runtime/src/intrinsics/memory.ts",
  shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts",
  service = "packages/native-runtime/src/shared-blocks.ts",
  clock = "packages/native-runtime/src/intrinsics/clock.ts",
  object = "packages/js-runtime/src/objects/index.ts";
const bindings = [
  [memory, "mapMemory", "memory-map"],
  [memory, "unmapMemory", "memory-unmap"],
  [memory, "readMemoryWord", "memory-read-word"],
  [memory, "writeMemoryWord", "memory-write-word"],
  [memory, "startNativeThread", "thread-start"],
  [memory, "joinNativeThread", "thread-join"],
  [memory, "hostedThreadEntry", "hosted-thread-entry"],
  [memory, "parkNativeWord", "word-park"],
  [memory, "wakeNativeWord", "word-wake"],
  [shared, "readSharedUnsigned", "shared-read-unsigned"],
  [shared, "writeSharedUnsigned", "shared-write-unsigned"],
  [shared, "readSharedWord64", "shared-read-word64"],
  [shared, "writeSharedWord64", "shared-write-word64"],
  [shared, "compareExchangeSharedWord64", "shared-compare-exchange-word64"],
  [shared, "compareExchangeSharedUnsigned", "shared-compare-exchange-unsigned"],
  [clock, "monotonicMilliseconds", "monotonic-time"],
] as const;
verifyHostedFixture(
  `
import {mapMemory,unmapMemory,readMemoryWord,writeMemoryWord,startNativeThread,joinNativeThread,hostedThreadEntry,parkNativeWord,wakeNativeWord} from 'memory';
import {readSharedUnsigned,writeSharedUnsigned} from 'shared';
import {monotonicMilliseconds} from 'clock';
import {nativeSharedMemoryHost,nativeSharedAtomicMemoryHost,nativeWaiterParkingHost,createNativeSharedBlockService,attachNativeSharedBlockService} from 'service';
import {createObject,createErrorRealm,createScriptAgent,installArrayIntrinsics,installAtomicsIntrinsics,installTypedArrayIntrinsics,installSharedArrayBufferIntrinsics,installArrayBufferIntrinsics,viewObjectValue,callObjectValue,constructObject,getProperty,exoticSlots,type OrdinaryObject,type ScriptPropertyKey,type ObjectHooks} from 'object';
export function run(argument:number):number {
 const host=nativeSharedMemoryHost(),atomic=nativeSharedAtomicMemoryHost(),parking=nativeWaiterParkingHost();
 if(argument!==0){
  const descriptor={base:readMemoryWord(argument,128,0),byteLength:readMemoryWord(argument,128,8),engineId:readMemoryWord(argument,128,16)};
  const waitDescriptor={base:readMemoryWord(argument,128,24),byteLength:readMemoryWord(argument,128,32),engineId:descriptor.engineId};
  const attached=attachNativeSharedBlockService(host,descriptor,atomic,{parking,now:():number=>monotonicMilliseconds(),registry:waitDescriptor});
  if(!attached.ok)return 11;
  const notifications=attached.value.notifications;if(notifications===undefined)return 12;
  while(readSharedUnsigned(argument,128,48,4,1)!==1)parkNativeWord(argument+48,0,1000000);
  const notified=notifications.notify(readMemoryWord(argument,128,40),0,8,1);
  if(!notified.ok||notified.value!==1)return 13;
  writeSharedUnsigned(argument,128,56,4,1,1);return 7;
 }
 const mailbox=mapMemory(16384);if(mailbox<=0)return 1;
 let requested=false;
 const created=createNativeSharedBlockService(host,{pageSize:16384,maxBlocks:8,maxReservedBytes:262144},atomic,{parking,now:():number=>{
  if(requested){writeSharedUnsigned(mailbox,128,48,4,1,1);wakeNativeWord(mailbox+48,1);}
  return monotonicMilliseconds();
 },maxWaiters:8});if(!created.ok)return 2;
 const backing=created.value,waitDescriptor=backing.waitRegistry;if(waitDescriptor===undefined)return 3;
 const global=createObject<ScriptPropertyKey,unknown>(undefined);
 const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>{const called=callObjectValue(fn,receiver,args,global);if(called.error!=="none")throw "CALL";return called.value;}};
 const realm=createErrorRealm(global,hooks,undefined,createScriptAgent(true));
 installArrayBufferIntrinsics(global,realm,hooks);installArrayIntrinsics(global,realm,hooks);
 installSharedArrayBufferIntrinsics(global,realm,hooks,backing);installTypedArrayIntrinsics(global,realm,hooks,"little");
 installAtomicsIntrinsics(global,realm,hooks,{lockFree1:true,lockFree2:true,lockFree8:true});
 function make(name:string,args:unknown[]):OrdinaryObject<ScriptPropertyKey,unknown>{
  const constructor=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(global,name,global,hooks),global);if(constructor===undefined)throw "CONSTRUCTOR";
  const result=constructObject<ScriptPropertyKey,unknown>(constructor,args,{object:constructor,value:constructor},undefined);if(result.error!=="none")throw "CONSTRUCT";
  const value=viewObjectValue(result.value,global);if(value===undefined)throw "OBJECT";return value;
 }
 function invoke(receiver:OrdinaryObject<ScriptPropertyKey,unknown>,name:string,args:unknown[]):unknown{
  const called=callObjectValue(getProperty<ScriptPropertyKey,unknown>(receiver,name,receiver,hooks),receiver,args,global);if(called.error!=="none")throw "INVOKE";return called.value;
 }
 const buffer=make("SharedArrayBuffer",[16]),view=make("Int32Array",[buffer]);
 const atomics=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(global,"Atomics",global,hooks),global);if(atomics===undefined)return 4;
 writeMemoryWord(mailbox,128,0,backing.registry.base);writeMemoryWord(mailbox,128,8,backing.registry.byteLength);writeMemoryWord(mailbox,128,16,backing.registry.engineId);
 writeMemoryWord(mailbox,128,24,waitDescriptor.base);writeMemoryWord(mailbox,128,32,waitDescriptor.byteLength);
 const data=exoticSlots(buffer).internalSharedArrayBufferData;if(data===undefined)return 5;
 writeMemoryWord(mailbox,128,40,data.handle);
 const worker=startNativeThread(hostedThreadEntry(),mailbox);if(worker<=0)return 6;
 requested=true;
 if(invoke(atomics,"wait",[view,0,0,10000])!=="ok")return 7;
 requested=false;
 if(joinNativeThread(worker)!==7||readSharedUnsigned(mailbox,128,56,4,1)!==1)return 8;
 if(invoke(atomics,"wait",[view,0,0,0.5])!=="timed-out")return 9;
 const big=make("BigInt64Array",[buffer]);
 if(invoke(atomics,"wait",[big,0,"18446744073709551616",0.1])!=="timed-out")return 10;
 if(invoke(atomics,"wait",[view,0,1,Infinity])!=="not-equal"||realm.unsupported)return 14;
 if(unmapMemory(mailbox,16384)!==0)return 15;
 return 42;
}
`,
  "native-script-sync-wait-v1",
  [
    ["memory", memory],
    ["shared", shared],
    ["clock", clock],
    ["service", service],
    ["object", object],
  ],
  [],
  [
    { module: object, name: "viewObjectValue", operation: "view" },
    { module: object, name: "viewSymbolValue", operation: "view" },
    { module: object, name: "viewBigIntValue", operation: "view" },
  ],
  [
    ...[memory, shared, clock].map((module, index) => ({
      module,
      namespace: "sync-wait-fixture-" + index,
      retainedExports: bindings.filter((b) => b[0] === module).map((b) => b[1]),
    })),
    {
      module: object,
      namespace: "sync-wait-object",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
      ],
    },
  ],
  {
    threaded: true,
    managedBytes: 16777216,
    allocationCapacity: 262144,
    runtimeEntry: "initializeRuntime",
    hostBindings: bindings.map(([module, name, operation]) => ({
      module,
      name,
      operation,
    })),
  },
);
