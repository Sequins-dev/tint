import { verifyHostedFixture } from "./hosted-fixture.ts";
if (process.env.TINT_BUILD_ONLY !== "1") throw Error("build-only fixture");
const memory = "packages/native-runtime/src/intrinsics/memory.ts",
  shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts",
  clock = "packages/native-runtime/src/intrinsics/clock.ts";
const bindings = [
  { module: memory, name: "mapMemory", operation: "memory-map" },
  { module: memory, name: "unmapMemory", operation: "memory-unmap" },
  { module: memory, name: "startNativeThread", operation: "thread-start" },
  { module: memory, name: "joinNativeThread", operation: "thread-join" },
  {
    module: memory,
    name: "hostedThreadEntry",
    operation: "hosted-thread-entry",
  },
  { module: memory, name: "parkNativeWord", operation: "word-park" },
  { module: memory, name: "wakeNativeWord", operation: "word-wake" },
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
  { module: clock, name: "monotonicMilliseconds", operation: "monotonic-time" },
] as const;
verifyHostedFixture(
  `
import {mapMemory,unmapMemory,startNativeThread,joinNativeThread,hostedThreadEntry,parkNativeWord,wakeNativeWord} from 'memory';
import {readSharedUnsigned,writeSharedUnsigned} from 'shared';
import {monotonicMilliseconds} from 'clock';
export function run(argument:number):number {
 if(argument!==0){
  writeSharedUnsigned(argument,16,4,4,1,1);
  while(readSharedUnsigned(argument,16,0,4,1)===0){
   const result=parkNativeWord(argument,0,1000000000);
   if(result<0&&result!==-4)return 11;
  }
  writeSharedUnsigned(argument,16,8,4,42,1);
  return 7;
 }
 const mailbox=mapMemory(16384);if(mailbox<=0)return 1;
 const before=monotonicMilliseconds();
 if(parkNativeWord(mailbox,1,1000000000)<0)return 2;
 if(parkNativeWord(mailbox,0,1000000)!==-60)return 3;
 if(wakeNativeWord(mailbox,0)!==-2)return 4;
 for(let i=0;i<16;i++){
  const cell=mailbox+i*16;
  writeSharedUnsigned(cell,16,0,4,0,1);
  const thread=startNativeThread(hostedThreadEntry(),cell);if(thread<=0)return 5;
  while(readSharedUnsigned(cell,16,4,4,1)!==1){}
  writeSharedUnsigned(cell,16,0,4,1,1);
  const wake=wakeNativeWord(cell,i%2);
  if(wake<0&&wake!==-2)return 6;
  if(joinNativeThread(thread)!==7)return 7;
  if(readSharedUnsigned(cell,16,8,4,1)!==42)return 8;
 }
 if(monotonicMilliseconds()<before)return 9;
 if(unmapMemory(mailbox,16384)!==0)return 10;
 return 42;
}`,
  "native-word-parking-v1",
  [
    ["memory", memory],
    ["shared", shared],
    ["clock", clock],
  ],
  [],
  [],
  [memory, shared, clock].map((module, index) => ({
    module,
    namespace: "parking-fixture-" + index,
    retainedExports: bindings
      .filter((b) => b.module === module)
      .map((b) => b.name),
  })),
  {
    threaded: true,
    managedBytes: 1048576,
    allocationCapacity: 65536,
    runtimeEntry: "initializeCopyingRuntime",
    hostBindings: bindings,
  },
);
