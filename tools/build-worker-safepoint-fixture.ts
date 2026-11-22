import { nativeFixtureTarget } from "./native-host-target.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { parseModule } from "@tint/typescript/syntax";
import { createSourceText } from "@tint/source/text";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The worker safepoint fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";

const target = nativeFixtureTarget();
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const bindings = [
  [clock, "monotonicMilliseconds", "monotonic-time"],
  [memory, "mapMemory", "memory-map"],
  [memory, "unmapMemory", "memory-unmap"],
  [memory, "parkNativeWord", "word-park"],
  [memory, "wakeNativeWord", "word-wake"],
  [memory, "startNativeThread", "thread-start"],
  [memory, "hostedThreadEntry", "hosted-thread-entry"],
  [shared, "readSharedWord64", "shared-read-word64"],
  [shared, "writeSharedWord64", "shared-write-word64"],
  [shared, "readSharedUnsigned", "shared-read-unsigned"],
  [shared, "writeSharedUnsigned", "shared-write-unsigned"],
  [shared, "compareExchangeSharedWord64", "shared-compare-exchange-word64"],
] as const;

const workerSource = `
import {parkNativeWord,wakeNativeWord} from 'memory';
import {readSharedUnsigned,writeSharedUnsigned} from 'shared';
import type {NativeWorkerTurnControl} from 'workers';

function read(base:number,offset:number):number {
  return readSharedUnsigned(base,16384,offset,4,1);
}
function write(base:number,offset:number,value:number):void {
  if(writeSharedUnsigned(base,16384,offset,4,value,1)!==0)throw "shared fixture write failed";
}
function callHit(base:number):number {
  write(base,12,9);
  return 9;
}
function allocateWork(base:number):void {
  write(base,0,1);
  let checksum=0;
  for(let index=0;index<2000000;index++){
    const bytes=new Uint8Array(32+(index%2));
    bytes[31]=8;
    checksum+=(bytes[31]??0)+bytes.length;
  }
  write(base,8,checksum);
}
// Neither allocates nor calls inside its loop: only the loop poll stops it.
function spinWork(base:number):void {
  write(base,32,1);
  let checksum=0;
  for(let index=0;index<4000000000;index++)checksum=(checksum*31+index)|0;
  write(base,40,checksum|1);
}
export function evaluate(base:number,id:number,_control:NativeWorkerTurnControl):number {
  const offset=id===1?0:id===2?16:32;
  try{
    if(id===1)allocateWork(base);
    else if(id===3)spinWork(base);
    else{
      write(base,offset,1);
      while(read(base,offset+4)===0)parkNativeWord(base+offset+4,0,0);
      write(base,offset+8,callHit(base));
    }
  }catch(error){
    write(base,offset+12,7);
  }
  return 0;
}
`;
const bytes = new TextEncoder().encode(workerSource);
const source = createSourceText(bytes, bytes.length);
if (!source.ok) throw Error("invalid worker fixture source");
const parsed = parseModule(source.value);
if (!parsed.ok) throw Error(JSON.stringify(parsed.error));
const worker = "fixture:worker-module";
const workers = "packages/native-runtime/src/worker-lifecycle.ts";

verifyHostedFixture(
  `
import {monotonicMilliseconds} from 'clock';
import {wakeNativeWord} from 'memory';
import {readSharedUnsigned,writeSharedUnsigned} from 'shared';
import {createReactor} from 'reactor';
import {createNativeWorkerThreadHost} from 'thread';
import {createReactorEventLoop} from 'loop';
import {nativeSharedMemoryHost,nativeWaiterParkingHost} from 'blocks';
import {startNativeWorker,runNativeWorker} from 'workers';
import {evaluate} from 'guest';

function read(base:number,offset:number):number {
  return readSharedUnsigned(base,16384,offset,4,1);
}
function write(base:number,offset:number,value:number):void {
  if(writeSharedUnsigned(base,16384,offset,4,value,1)!==0)throw "shared fixture write failed";
}
export function run(argument:number):number {
  const memory=nativeSharedMemoryHost(),parking=nativeWaiterParkingHost();
  if(argument!==0)return runNativeWorker(memory,parking,argument,evaluate);
  const runtime=createReactorEventLoop({
    createReactor:()=>createReactor(),
    now:()=>monotonicMilliseconds(),
    drainMicrotasks:():void=>{},
    onWake:():void=>{},
  });
  const threads=createNativeWorkerThreadHost();
  const base=memory.mapMemory(16384);
  if(base<=0)return 2;
  try{
    let allocationExit=-1,callExit=-1,spinExit=-1;
    const allocating=startNativeWorker(memory,parking,threads,runtime,{
      threadId:1,moduleId:base,stackBytes:8388608,heapBytes:8388608,
      onError:(message:string):void=>{throw message;},
      onExit:(status:number):void=>{allocationExit=status;},
    });
    const calling=startNativeWorker(memory,parking,threads,runtime,{
      threadId:2,moduleId:base,stackBytes:8388608,heapBytes:8388608,
      onError:(message:string):void=>{throw message;},
      onExit:(status:number):void=>{callExit=status;},
    });
    const spinning=startNativeWorker(memory,parking,threads,runtime,{
      threadId:3,moduleId:base,stackBytes:8388608,heapBytes:8388608,
      onError:(message:string):void=>{throw message;},
      onExit:(status:number):void=>{spinExit=status;},
    });
    const request:{close():void}=runtime.loop.setInterval(():void=>{
      if(read(base,0)!==1||read(base,16)!==1||read(base,32)!==1)return;
      request.close();
      allocating.requestStop();
      calling.requestStop();
      spinning.requestStop();
      write(base,20,1);
      wakeNativeWord(base+20,1);
    },1);
    runtime.loop.setTimeout(():void=>{throw "worker safepoint fixture stalled";},2000).unref();
    runtime.loop.run("callback");
    if(allocationExit!==1||callExit!==1||spinExit!==1)return 3;
    if(read(base,8)!==0)return 4;
    if(read(base,24)!==0||read(base,40)!==0)return 5;
    if(read(base,12)!==0||read(base,28)!==0||read(base,44)!==0)return 6;
    return 42;
  }finally{
    runtime.close();
    memory.unmapMemory(base,16384);
  }
}
`,
  "worker-safepoints",
  [
    ["clock", clock],
    ["memory", memory],
    ["shared", shared],
    ["reactor", "packages/platform/src/" + target.os + "/reactor.ts"],
    ["thread", "packages/platform/src/workers.ts"],
    ["loop", "packages/native-runtime/src/event-loop-reactor.ts"],
    ["blocks", "packages/native-runtime/src/shared-blocks.ts"],
    ["workers", workers],
    ["guest", worker],
  ],
  [
    {
      id: worker,
      module: parsed.value,
      dependencies: new Map([
        ["memory", memory],
        ["shared", shared],
        ["workers", workers],
      ]),
    },
  ],
  [],
  [memory, shared, clock].map((module, index) => ({
    module,
    namespace: "worker-safepoint-" + index,
    retainedExports: bindings
      .filter((binding) => binding[0] === module)
      .map((binding) => binding[1]),
  })),
  {
    threaded: true,
    threadExitPipe: true,
    workerModules: [worker],
    stackBytes: 16777216,
    managedBytes: 16777216,
    allocationCapacity: 262144,
    runtimeEntry:
      target.arch === "x86_64"
        ? "initializeGenerationalRuntime"
        : "initializeCopyingRuntime",
    hostBindings: bindings.map(([module, name, operation]) => ({
      module,
      name,
      operation,
    })),
  },
);
