import { nativeFixtureTarget } from "./native-host-target.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The worker exit fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";

const target = nativeFixtureTarget();
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const bindings = [
  [clock, "monotonicMilliseconds", "monotonic-time"],
  [memory, "mapMemory", "memory-map"],
  [memory, "unmapMemory", "memory-unmap"],
  [shared, "readSharedWord64", "shared-read-word64"],
  [shared, "writeSharedWord64", "shared-write-word64"],
  [shared, "readSharedUnsigned", "shared-read-unsigned"],
  [shared, "writeSharedUnsigned", "shared-write-unsigned"],
  [shared, "compareExchangeSharedWord64", "shared-compare-exchange-word64"],
  [memory, "parkNativeWord", "word-park"],
  [memory, "wakeNativeWord", "word-wake"],
  [memory, "startNativeThread", "thread-start"],
  [memory, "hostedThreadEntry", "hosted-thread-entry"],
] as const;

verifyHostedFixture(
  `
import {monotonicMilliseconds} from 'clock';
import {createReactor} from 'reactor';
import {createNativeWorkerThreadHost} from 'thread';
import {createReactorEventLoop} from 'loop';
import {nativeSharedMemoryHost,nativeWaiterParkingHost} from 'blocks';
import {startNativeWorker,runNativeWorker,type NativeWorkerTurnControl} from 'workers';

export function run(argument:number):number {
  const memory=nativeSharedMemoryHost(),parking=nativeWaiterParkingHost();
  if(argument!==0)return runNativeWorker(memory,parking,argument,(moduleId:number,id:number,control:NativeWorkerTurnControl):number=>{
    if(moduleId===19&&id===1)return 7;
    if(moduleId===23&&id===2)throw "module failed";
    if(id===3){
      const waiting=createReactorEventLoop({
        createReactor:()=>{
          const reactor=createReactor();
          return {
            control:reactor.control,
            watchReadable:(fd:number,token:number):void=>reactor.watchReadable(fd,token),
            unwatchReadable:(fd:number):void=>reactor.unwatchReadable(fd),
            poll:(timeout:number,publish:(token:number)=>void):void=>{
              if(timeout!==Infinity)throw "worker reactor did not block";
              if(memory.writeSharedWord64(moduleId,16384,0,1,1,0)!==0)throw "worker ready signal failed";
              reactor.poll(timeout,publish);
            },
            close:():void=>reactor.close(),
          };
        },
        now:()=>monotonicMilliseconds(),
        drainMicrotasks:():void=>{},
        onWake:():void=>{},
        stopRequested:():boolean=>control.stopRequested(),
      });
      try{
        waiting.watchReadable(control.input,():void=>{throw "worker dispatched the stop pipe";}).unref();
        waiting.loop.retain();
        waiting.loop.run("callback");
        return 0;
      }finally{waiting.close();}
    }
    return 93;
  });
  const runtime=createReactorEventLoop({
    createReactor:()=>createReactor(),
    now:()=>monotonicMilliseconds(),
    drainMicrotasks:():void=>{},
    onWake:():void=>{}
  });
  const threads=createNativeWorkerThreadHost();
  const ready=memory.mapMemory(16384);
  if(ready<=0)return 6;
  try{
    let first=0,second=0,third=0,events="";
    const worker=startNativeWorker(memory,parking,threads,runtime,{
      threadId:1,moduleId:19,
      onError:(message:string):void=>{throw message;},
      onExit:(status:number):void=>{first=status;},
    });
    const failure=startNativeWorker(memory,parking,threads,runtime,{
      threadId:2,moduleId:23,
      onError:(message:string):void=>{events+=message;},
      onExit:(status:number):void=>{events+="=exit";second=status;},
    });
    const blocked=startNativeWorker(memory,parking,threads,runtime,{
      threadId:3,moduleId:ready,
      onError:(message:string):void=>{throw message;},
      onExit:(status:number):void=>{third=status;},
    });
    const scratch=new Uint32Array(2);
    const request:{close():void}=runtime.loop.setInterval(():void=>{
      if(memory.readSharedWord64(ready,16384,0,1,scratch)!==0)throw "worker ready read failed";
      if(scratch[0]===0)return;
      blocked.requestStop();
      blocked.requestStop();
      request.close();
    },5);
    worker.unref();if(worker.hasRef())return 2;
    worker.ref();if(!worker.hasRef()||worker.threadId!==1||failure.threadId!==2)return 3;
    const deadline=runtime.loop.setTimeout(():void=>{throw "workers did not exit";},1000);
    deadline.unref();
    runtime.loop.run("callback");
    blocked.requestStop();
    if(worker.hasRef()||failure.hasRef()||blocked.hasRef())return 4;
    return first===7&&second===1&&third===1&&events==="module failed=exit"?42:5;
  }finally{runtime.close();memory.unmapMemory(ready,16384);}
}
`,
  "worker-lifecycle-v3",
  [
    ["clock", clock],
    ["reactor", "packages/platform/src/" + target.os + "/reactor.ts"],
    ["thread", "packages/platform/src/workers.ts"],
    ["loop", "packages/native-runtime/src/event-loop-reactor.ts"],
    ["blocks", "packages/native-runtime/src/shared-blocks.ts"],
    ["workers", "packages/native-runtime/src/worker-lifecycle.ts"],
  ],
  [],
  [],
  [memory, shared, clock].map((module, index) => ({
    module,
    namespace: "worker-exit-" + index,
    retainedExports: bindings
      .filter((binding) => binding[0] === module)
      .map((binding) => binding[1]),
  })),
  {
    threaded: true,
    threadExitPipe: true,
    managedBytes: 4194304,
    allocationCapacity: 65536,
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
