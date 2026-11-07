import { verifyHostedFixture } from "./hosted-fixture.ts";
if (process.env.TINT_BUILD_ONLY !== "1") throw Error("build-only fixture");
const memory = "packages/native-runtime/src/intrinsics/memory.ts",
  shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts",
  service = "packages/native-runtime/src/shared-blocks.ts",
  messages = "packages/native-runtime/src/agent-messages.ts";
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
import {mapMemory,readMemoryWord,writeMemoryWord,startNativeThread,joinNativeThread,hostedThreadEntry} from 'memory';
import {nativeSharedMemoryHost,nativeWaiterParkingHost} from 'service';
import {createNativeAgentMailbox,attachNativeAgentMailbox} from 'messages';
export function run(argument:number):number {
 const host=nativeSharedMemoryHost(),parking=nativeWaiterParkingHost();
 if(argument!==0){
  const attached=attachNativeAgentMailbox(host,parking,{base:readMemoryWord(argument,128,0),byteLength:16384,engineId:91});
  if(!attached.ok)return 11;
  const queue=attached.value,index=readMemoryWord(argument,128,8);
  for(let i=0;i<100;i++){
   const sent=queue.send(String(index)+":"+String(i)+String.fromCharCode(0,0xd800,0xdfff));if(!sent.ok)return 12;
  }
  return 7;
 }
 const created=createNativeAgentMailbox(host,parking,91);if(!created.ok)return 1;
 const queue=created.value,records=mapMemory(16384),handles=new Float64Array(4);
 if(records<=0)return 2;
 for(let i=0;i<4;i++){
  const record=records+i*128;writeMemoryWord(record,128,0,queue.registry.base);writeMemoryWord(record,128,8,i);
  const handle=startNativeThread(hostedThreadEntry(),record);if(handle<=0)return 3;handles[i]=handle;
 }
 const next=new Uint32Array(4);let count=0;
 while(count<400){
  const message=queue.receive();if(message===undefined)continue;
  const colon=message.indexOf(":"),index=Number(message.slice(0,colon)),sequence=Number(message.slice(colon+1,-3));
  if(index<0||index>3||sequence!==(next[index]??0)||message.slice(-3)!==String.fromCharCode(0,0xd800,0xdfff))return 4;
  next[index]=sequence+1;count++;
 }
 for(let i=0;i<4;i++)if(joinNativeThread(handles[i]??0)!==7)return 5;
 if(queue.receive()!==undefined)return 6;
 return 42;
}
`,
  "native-agent-mailbox-v1",
  [
    ["memory", memory],
    ["service", service],
    ["messages", messages],
  ],
  [],
  [],
  [memory, shared].map((module, index) => ({
    module,
    namespace: "mailbox-" + index,
    retainedExports: bindings.filter((b) => b[0] === module).map((b) => b[1]),
  })),
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
