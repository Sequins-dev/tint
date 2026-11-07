import { verifyHostedFixture } from "./hosted-fixture.ts";
if (process.env.TINT_BUILD_ONLY !== "1") throw Error("build-only fixture");
const memory = "packages/native-runtime/src/intrinsics/memory.ts",
  shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts",
  service = "packages/native-runtime/src/shared-blocks.ts",
  messages = "packages/native-runtime/src/agent-messages.ts",
  agents = "packages/native-runtime/src/agent-lifecycle.ts",
  clock = "packages/native-runtime/src/intrinsics/clock.ts";
const bindings = [
  [clock, "monotonicMilliseconds", "monotonic-time"],
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
import {startNativeThread,joinNativeThread,hostedThreadEntry} from 'memory';
import {monotonicMilliseconds} from 'clock';
import {nativeSharedMemoryHost,nativeWaiterParkingHost} from 'service';
import {createNativeAgentCluster,attachNativeAgentWorker} from 'agents';
export function run(argument:number):number {
 const host=nativeSharedMemoryHost(),parking=nativeWaiterParkingHost();
 if(argument!==0){
  const attached=attachNativeAgentWorker(host,parking,argument);if(!attached.ok)return 11;
  const worker=attached.value,text=worker.source();worker.running();
  if(text!=="worker"+String.fromCharCode(0,0xd800))return 12;
  const sent=worker.report(text);if(!sent.ok)return 13;
  worker.leaving();return 0;
 }
 const created=createNativeAgentCluster(host,parking,{entry:hostedThreadEntry(),start:(entry:number,arg:number):number=>startNativeThread(entry,arg),join:(thread:number):number=>joinNativeThread(thread),now:():number=>monotonicMilliseconds()},91,4,10000);
 if(!created.ok)return 1;const cluster=created.value;
 for(let i=0;i<4;i++)if(!cluster.start("worker"+String.fromCharCode(0,0xd800)).ok)return 2;
 cluster.joinAll();let count=0;
 while(true){const report=cluster.getReport();if(report===undefined)break;if(report!=="worker"+String.fromCharCode(0,0xd800))return 3;count++;}
 return count===4?42:4;
}

`,
  "native-agent-lifecycle-v1",
  [
    ["memory", memory],
    ["service", service],
    ["messages", messages],
    ["agents", agents],
    ["clock", clock],
  ],
  [],
  [],
  [memory, shared, clock].map((module, index) => ({
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
