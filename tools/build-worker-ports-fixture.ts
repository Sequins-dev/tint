import type { NativeHostBinding } from "@tint/compiler/native";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The worker ports fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";
const target = nativeFixtureTarget();
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const bindings: readonly NativeHostBinding[] = [
  { module: clock, name: "monotonicMilliseconds", operation: "monotonic-time" },
  { module: memory, name: "mapMemory", operation: "memory-map" },
  { module: memory, name: "unmapMemory", operation: "memory-unmap" },
  { module: memory, name: "parkNativeWord", operation: "word-park" },
  { module: memory, name: "wakeNativeWord", operation: "word-wake" },
  { module: memory, name: "startNativeThread", operation: "thread-start" },
  {
    module: memory,
    name: "hostedThreadEntry",
    operation: "hosted-thread-entry",
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
];
verifyHostedFixture(
  `
import {monotonicMilliseconds} from 'clock';
import {createReactor} from 'reactor';
import {createReactorEventLoop} from 'loop';
import {nativeSharedMemoryHost,nativeWaiterParkingHost} from 'blocks';
import {createNativeWorkerThreadHost} from 'thread';
import {createNativeMessagePorts,type NativeMessagePort,type NativeMessagePortGrant} from 'ports';
import {startNativeWorker,runNativeWorker,type NativeWorkerTurnControl} from 'workers';

export function run(argument:number):number {
  const loop=createReactorEventLoop({
    createReactor:()=>createReactor(),
    drainMicrotasks:():void=>{},
    now:():number=>monotonicMilliseconds(),
    onWake:():void=>{},
  });
  const memory=nativeSharedMemoryHost(),parking=nativeWaiterParkingHost(),threads=createNativeWorkerThreadHost();
  let discarded="";
  const ports=createNativeMessagePorts(
    memory,parking,threads,loop,
    (packet:string):void=>{discarded+=packet;},
  );
  if(argument!==0)return runNativeWorker(memory,parking,argument,
    (moduleId:number,id:number,control:NativeWorkerTurnControl):number=>{
      if(moduleId!==17||id!==1)return 9;
      const port=control.claimParentPort(ports);
      if(port===undefined)return 11;
      const endpoint:NativeMessagePort=port;
      endpoint.watch((message:string):void=>{
        endpoint.send(message+"!");
        endpoint.close();
      },():void=>{endpoint.close();});
      try{loop.loop.run("callback");}finally{endpoint.close();loop.close();}
      return 0;
    },
  );
  const pair=ports.create();
  let sequence="";
  if(!pair.first.send("before"))return 1;
  const grant=pair.second.transfer();
  if(!pair.first.send("during"))return 2;
  const receiver=ports.adopt(grant);
  if(pair.second.send("bad"))return 3;
  receiver.watch((message:string):void=>{
    sequence+=message+";";
    loop.loop.nextTick(():void=>{sequence+="tick;";});
  },():void=>{sequence+="closed";receiver.close();});
  if(!pair.first.send("after"))return 4;
  pair.first.close();
  loop.loop.run("callback");
  if(sequence!=="before;tick;during;tick;after;tick;closed")return 5;
  const abandoned=ports.create();
  const inFlight=abandoned.second.transfer();
  if(!abandoned.first.send("discarded"))return 6;
  ports.discard(inFlight);
  if(discarded!=="discarded"||abandoned.first.send("lost"))return 7;
  abandoned.first.close();
  const background=ports.create();
  const workerGrant=background.second.transfer();
  if(!background.first.send("hello"))return 8;
  let reply="",exit=-1;
  let peerClosed=false;
  background.first.watch((message:string):void=>{reply=message;},
    ():void=>{peerClosed=true;background.first.close();});
  startNativeWorker(memory,parking,threads,loop,{
    threadId:1,moduleId:17,parentPort:workerGrant,
    onUnclaimedParentPort:(grant:NativeMessagePortGrant):void=>ports.discard(grant),
    onError:(message:string):void=>{throw message;},
    onExit:(status:number):void=>{exit=status;},
  });
  loop.loop.setTimeout(():void=>{throw "worker port fixture stalled";},2000).unref();
  loop.loop.run("callback");
  if(reply!=="hello!"||!peerClosed||exit!==0)return 10;
  loop.close();
  return 42;
}
`,
  "worker-ports",
  [
    ["clock", clock],
    ["reactor", "packages/platform/src/" + target.os + "/reactor.ts"],
    ["loop", "packages/native-runtime/src/event-loop-reactor.ts"],
    ["blocks", "packages/native-runtime/src/shared-blocks.ts"],
    ["thread", "packages/platform/src/workers.ts"],
    ["ports", "packages/native-runtime/src/worker-ports.ts"],
    ["workers", "packages/native-runtime/src/worker-lifecycle.ts"],
  ],
  [],
  [],
  [
    {
      module: clock,
      namespace: "native-clock",
      retainedExports: ["monotonicMilliseconds"],
    },
    {
      module: memory,
      namespace: "native-memory",
      retainedExports: bindings
        .filter((binding) => binding.module === memory)
        .map((binding) => binding.name),
    },
    {
      module: shared,
      namespace: "worker-port-shared-memory",
      retainedExports: bindings
        .filter((binding) => binding.module === shared)
        .map((binding) => binding.name),
    },
  ],
  {
    managedBytes: 16777216,
    allocationCapacity: 262144,
    stackBytes: 16777216,
    requireTyped: true,
    threaded: true,
    threadExitPipe: true,
    runtimeEntry:
      target.arch === "x86_64"
        ? "initializeGenerationalRuntime"
        : "initializeCopyingRuntime",
    hostBindings: bindings,
  },
);
