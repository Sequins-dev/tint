import { verifyHostedFixture } from "./hosted-fixture.ts";
if (process.env.TINT_BUILD_ONLY !== "1") throw Error("build-only fixture");
const memory = "packages/native-runtime/src/intrinsics/memory.ts",
  shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts",
  service = "packages/native-runtime/src/shared-blocks.ts";
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
] as const;
verifyHostedFixture(
  `
import {mapMemory,unmapMemory,readMemoryWord,writeMemoryWord,startNativeThread,joinNativeThread,hostedThreadEntry} from 'memory';
import {readSharedUnsigned,writeSharedUnsigned} from 'shared';
import {nativeSharedMemoryHost,nativeWaiterParkingHost,createNativeWaitRegistry,attachNativeWaitRegistry} from 'service';
export function run(argument:number):number {
 const host=nativeSharedMemoryHost(),parking=nativeWaiterParkingHost();
 if(argument!==0){
  const descriptor={base:readMemoryWord(argument,128,0),byteLength:readMemoryWord(argument,128,8),engineId:99};
  const attached=attachNativeWaitRegistry(host,parking,descriptor);if(!attached.ok)return 11;
  const r=attached.value,payload=readMemoryWord(argument,128,24),width=readMemoryWord(argument,128,32)===8?8:4;
  const registered=r.register({engineId:99,blockId:1,address:payload,byteLength:16,byteOffset:0,width},7,0,false);
  if(!registered.ok||registered.value.state!=="waiting")return 12;
  const ticket=registered.value.ticket;
  writeMemoryWord(argument,128,48,ticket);writeSharedUnsigned(argument,128,40,4,1,1);
  while(true){
   const observed=r.poll(ticket);if(!observed.ok)return 13;
   if(observed.value!=="waiting")break;
   const parked=r.park(ticket,1000000);if(!parked.ok)return 14;
  }
  const taken=r.take(ticket);if(!taken.ok||taken.value!=="notified")return 15;
  writeSharedUnsigned(argument,128,56,4,1,1);return 7;
 }
 const created=createNativeWaitRegistry(host,parking,99,4);if(!created.ok)return 1;
 const owner=created.value,payload=mapMemory(16384),mailbox=mapMemory(16384);
 if(payload<=0||mailbox<=0)return 2;
 writeSharedUnsigned(payload,16,0,4,7,1);
 const handles=new Float64Array(2);
 for(let i=0;i<2;i++){
  const record=mailbox+i*128;
  writeMemoryWord(record,128,0,owner.registry.base);writeMemoryWord(record,128,8,owner.registry.byteLength);
  writeMemoryWord(record,128,24,payload);writeMemoryWord(record,128,32,i===0?4:8);
  const thread=startNativeThread(hostedThreadEntry(),record);if(thread<=0)return 3;handles[i]=thread;
 }
 for(let i=0;i<2;i++)while(readSharedUnsigned(mailbox+i*128,128,40,4,1)!==1){}
 const first=readMemoryWord(mailbox,16384,48)<readMemoryWord(mailbox,16384,176)?0:1;
 const one=owner.notify(1,0,8,1);if(!one.ok||one.value!==1)return 4;
 while(readSharedUnsigned(mailbox+first*128,128,56,4,1)!==1){}
 if(readSharedUnsigned(mailbox+(1-first)*128,128,56,4,1)!==0)return 5;
 const rest=owner.notify(1,0,4,Infinity);if(!rest.ok||rest.value!==1)return 6;
 for(let i=0;i<2;i++)if(joinNativeThread(handles[i]??0)!==7)return 7;
 const timeout=owner.register({engineId:99,blockId:1,address:payload,byteLength:16,byteOffset:0,width:4},7,0,false);
 if(!timeout.ok)return 8;
 const expired=owner.expire(timeout.value.ticket);if(!expired.ok||!expired.value)return 9;
 const result=owner.take(timeout.value.ticket);if(!result.ok||result.value!=="timed-out")return 10;
 if(unmapMemory(payload,16384)!==0||unmapMemory(mailbox,16384)!==0)return 16;
 return 42;
}
`,
  "native-wait-registry-v1",
  [
    ["memory", memory],
    ["shared", shared],
    ["service", service],
  ],
  [],
  [],
  [
    ...[memory, shared].map((module, index) => ({
      module,
      namespace: "wait-fixture-" + index,
      retainedExports: bindings.filter((b) => b[0] === module).map((b) => b[1]),
    })),
  ],
  {
    threaded: true,
    managedBytes: 4194304,
    allocationCapacity: 65536,
    runtimeEntry: "initializeCopyingRuntime",
    hostBindings: bindings.map(([module, name, operation]) => ({
      module,
      name,
      operation,
    })),
  },
);
