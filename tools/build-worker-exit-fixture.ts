import { nativeFixtureTarget } from "./native-host-target.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The worker exit fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";

const target = nativeFixtureTarget();
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const declaration = "fixture:worker-exit-pipe";
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
import {startNativeThread,hostedThreadEntry} from 'memory';
import {monotonicMilliseconds} from 'clock';
import {read,close} from 'fs';
import {createReactor} from 'reactor';
import {pipe,dup,pthread_detach,fcntl$setFlags} from 'thread';
import {createReactorEventLoop} from 'loop';
import {nativeSharedMemoryHost,nativeWaiterParkingHost} from 'blocks';
import {startNativeWorker,runNativeWorker,type NativeWorkerThreadHost,type WorkerExitPipe} from 'workers';

function descriptor(bytes:Uint8Array,offset:number):number {
  return (bytes[offset]??0)+(bytes[offset+1]??0)*256+
    (bytes[offset+2]??0)*65536+(bytes[offset+3]??0)*16777216;
}

function exitPipe():WorkerExitPipe {
  const ends=new Uint8Array(8);
  if(pipe(ends)!==0)throw "worker pipe failed";
  const input=descriptor(ends,0),output=descriptor(ends,4);
  const flags=${target.os === "darwin" ? 4 : 2048};
  if(fcntl$setFlags(input,4,flags)!==0||fcntl$setFlags(output,4,flags)!==0){
    close(input);close(output);throw "worker pipe flags failed";
  }
  const readGuard=dup(input);
  if(readGuard<0){close(input);close(output);throw "worker pipe duplicate failed";}
  return {input,childOutput:output,childReadGuard:readGuard};
}
export function run(argument:number):number {
  const memory=nativeSharedMemoryHost(),parking=nativeWaiterParkingHost();
  if(argument!==0)return runNativeWorker(memory,parking,argument,(moduleId:number,id:number):number=>{
    if(moduleId===19&&id===1)return 7;
    if(moduleId===23&&id===2)throw "module failed";
    return 93;
  });
  const runtime=createReactorEventLoop({
    createReactor:()=>createReactor(),
    now:()=>monotonicMilliseconds(),
    drainMicrotasks:():void=>{},
    onWake:():void=>{}
  });
  const threads:NativeWorkerThreadHost={
    entry:hostedThreadEntry(),
    exitPipe:()=>exitPipe(),
    read:(fd:number,bytes:Uint8Array):number=>read(fd,bytes),
    close:(fd:number):void=>{if(close(fd)!==0)throw "worker pipe close failed";},
    start:(entry:number,arg:number):number=>startNativeThread(entry,arg),
    detach:(thread:number):number=>pthread_detach(thread),
  };
  try{
    let first=0,second=0,events="";
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
    worker.unref();if(worker.hasRef())return 2;
    worker.ref();if(!worker.hasRef()||worker.threadId!==1||failure.threadId!==2)return 3;
    const deadline=runtime.loop.setTimeout(():void=>{throw "workers did not exit";},1000);
    deadline.unref();
    runtime.loop.run("callback");
    if(worker.hasRef()||failure.hasRef())return 4;
    return first===7&&second===1&&events==="module failed=exit"?42:5;
  }finally{runtime.close();}
}
`,
  "worker-lifecycle-v1",
  [
    ["memory", memory],
    ["shared", shared],
    ["clock", clock],
    ["fs", "packages/native-runtime/src/intrinsics/fs.ts"],
    ["reactor", "packages/platform/src/" + target.os + "/reactor.ts"],
    ["thread", declaration],
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
    foreignDeclarations: [
      {
        id: declaration,
        text: `
declare module "tint:c/worker-exit-pipe" {
  import type { Address, i32, u8, Ptr, OrErrno, Variadic } from "tint:ffi";
  export function pipe(descriptors:Ptr<u8>):OrErrno<i32>;
  export function dup(fd:i32):OrErrno<i32>;
  export function pthread_detach(thread:Address<void>):i32;
  export function fcntl$setFlags(fd:i32,command:i32,flags:Variadic<i32>):OrErrno<i32>;
}
`,
        manifest: [
          {
            module: "tint:c/worker-exit-pipe",
            darwin: {
              name: "/usr/lib/libSystem.B.dylib",
              optional: false,
              currentVersion: 0x10000,
              compatibilityVersion: 0x10000,
            },
            linux: {
              name: "libc.so.6",
              optional: false,
              currentVersion: 0,
              compatibilityVersion: 0,
            },
          },
        ],
      },
    ],
  },
);
