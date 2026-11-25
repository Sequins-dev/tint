import { nativeFixtureTarget } from "./native-host-target.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The blocking pool fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";

const target = nativeFixtureTarget();
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const bindings = [
  [clock, "monotonicMilliseconds", "monotonic-time"],
  [memory, "mapMemory", "memory-map"],
  [memory, "unmapMemory", "memory-unmap"],
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
import {createNativeBlockingPool,runNativeBlockingHelper,type NativeBlockingPool} from 'pool';
import {createReactorEventLoop,type ReactorEventLoop} from 'loop';
import {createReactor,signalReactor} from 'reactor';
import {nativeSharedMemoryHost,nativeWaiterParkingHost} from 'blocks';
import {startNativeThread,joinNativeThread,hostedThreadEntry} from 'memory';
import {monotonicMilliseconds} from 'clock';
import {openRead,read,close} from 'fs';
import type {EventLoopHandle} from 'loop-core';

function perform(path:string):string {
  const fd=openRead(new TextEncoder().encode(path+String.fromCharCode(0)));
  if(fd<0)throw "open failed";
  try{
    const bytes=new Uint8Array(1);
    if(read(fd,bytes)!==1)throw "read failed";
    return String(bytes[0]??255);
  }finally{close(fd);}
}

export function run(argument:number):number {
  const host=nativeSharedMemoryHost(),parking=nativeWaiterParkingHost();
  if(argument!==0)return runNativeBlockingHelper(host,parking,argument,perform,signalReactor);

  let pool:NativeBlockingPool|undefined=undefined;
  let reference:EventLoopHandle|undefined=undefined;
  let good=false,failed=false,count=0;
  const runtime:ReactorEventLoop=createReactorEventLoop({
    createReactor:()=>createReactor(),
    now:()=>monotonicMilliseconds(),
    drainMicrotasks:():void=>{},
    onWake:():void=>{
      const workerPool=pool;
      if(workerPool===undefined)throw "missing pool";
      for(;;){
        const reply=workerPool.receive();
        if(reply===undefined)break;
        runtime.loop.enqueuePending(():void=>{
          if(reply.id===1&&reply.result==="0"&&!reply.failed)good=true;
          if(reply.id===2&&reply.result==="open failed"&&reply.failed)failed=true;
          count++;
          const hold=reference;
          if(count===2&&hold!==undefined)hold.close();
        });
      }
    }
  });
  try{
    const created=createNativeBlockingPool(host,parking,{
      wakeTarget:()=>runtime.wakeTarget(),
      entry:hostedThreadEntry(),
      start:(entry:number,argument:number):number=>startNativeThread(entry,argument),
      join:(thread:number):number=>joinNativeThread(thread),
    },2,2);
    pool=created;
    reference=runtime.loop.retain();
    if(!created.submit("/dev/zero").ok)return 1;
    if(!created.submit("/dev/tint-event-loop-missing-fixture-file").ok)return 2;
    const over=created.submit("/dev/zero");
    if(over.ok||over.error!=="allocation-limit")return 3;
    const deadline=runtime.loop.setTimeout(():void=>{throw "helpers did not complete";},1000);
    deadline.unref();
    runtime.loop.run("callback");
    return good&&failed&&count===2?42:4;
  }finally{
    const workerPool=pool;
    if(workerPool!==undefined)workerPool.close();
    runtime.close();
  }
}
`,
  "event-loop-blocking-pool-v1",
  [
    ["pool", "packages/native-runtime/src/blocking-pool.ts"],
    ["loop", "packages/native-runtime/src/event-loop-reactor.ts"],
    ["loop-core", "packages/native-runtime/src/event-loop.ts"],
    ["reactor", "packages/platform/src/" + target.os + "/reactor.ts"],
    ["blocks", "packages/native-runtime/src/shared-blocks.ts"],
    ["clock", clock],
    ["memory", memory],
    ["fs", "packages/native-runtime/src/intrinsics/fs.ts"],
  ],
  [],
  [],
  [memory, shared, clock].map((module, index) => ({
    module,
    namespace: "blocking-pool-" + index,
    retainedExports: bindings
      .filter((binding) => binding[0] === module)
      .map((binding) => binding[1]),
  })),
  {
    threaded: true,
    managedBytes: 4194304,
    allocationCapacity: 65536,
    runtimeEntry:
      target.arch === "x86_64"
        ? "initializeGenerationalRuntime"
        : "initializeGenerationalRuntime",
    hostBindings: bindings.map(([module, name, operation]) => ({
      module,
      name,
      operation,
    })),
  },
);
