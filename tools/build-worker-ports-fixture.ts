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
    name: "readMemoryString",
    operation: "memory-read-string",
  },
  {
    module: memory,
    name: "writeMemoryString",
    operation: "memory-write-string",
  },
  {
    module: memory,
    name: "readMemoryFloat64",
    operation: "memory-read-float64",
  },
  {
    module: memory,
    name: "writeMemoryFloat64",
    operation: "memory-write-float64",
  },
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
import {nativeAgentPacketHeader,type NativeAgentPacketEntry} from 'mailbox';
import {nativePacketMemory} from 'packets';

// Text packets: the payload is the message's UTF-16 units.
const packets=nativePacketMemory();
function send(port:NativeMessagePort,text:string):boolean{
  const packet=port.allocate(text.length*2);
  if(packets.writeString(packet.base,packet.byteLength,nativeAgentPacketHeader,text)!==0)throw "text packet write";
  const sent=port.send(packet,text.length*2);
  if(!sent)port.release(packet);
  return sent;
}
function text(entry:NativeAgentPacketEntry):string{
  return packets.readString(entry.packet.base,entry.packet.byteLength,nativeAgentPacketHeader,entry.used/2);
}
/** The text of a delivered packet, which returns to its port. */
function receive(port:NativeMessagePort,entry:NativeAgentPacketEntry):string{
  const message=text(entry);
  port.release(entry.packet);
  return message;
}

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
    (entry:NativeAgentPacketEntry):void=>{discarded+=text(entry);},
  );
  if(argument!==0)return runNativeWorker(memory,parking,argument,
    (moduleId:number,id:number,control:NativeWorkerTurnControl):number=>{
      if(moduleId!==17||id!==1)return 9;
      const port=control.claimParentPort(ports);
      if(port===undefined)return 11;
      const endpoint:NativeMessagePort=port;
      endpoint.watch((entry:NativeAgentPacketEntry):void=>{
        send(endpoint,receive(endpoint,entry)+"!");
        endpoint.close();
      },():void=>{endpoint.close();});
      try{loop.loop.run("callback");}finally{endpoint.close();loop.close();}
      return 0;
    },
  );
  const pair=ports.create();
  let sequence="";
  if(!send(pair.first,"before"))return 1;
  const grant=pair.second.transfer();
  if(!send(pair.first,"during"))return 2;
  const receiver=ports.adopt(grant);
  if(send(pair.second,"bad"))return 3;
  receiver.watch((entry:NativeAgentPacketEntry):void=>{
    sequence+=receive(receiver,entry)+";";
    loop.loop.nextTick(():void=>{sequence+="tick;";});
  },():void=>{sequence+="closed";receiver.close();});
  if(!send(pair.first,"after"))return 4;
  pair.first.close();
  loop.loop.run("callback");
  if(sequence!=="before;tick;during;tick;after;tick;closed")return 5;
  const abandoned=ports.create();
  const inFlight=abandoned.second.transfer();
  if(!send(abandoned.first,"discarded"))return 6;
  ports.discard(inFlight);
  if(discarded!=="discarded"||send(abandoned.first,"lost"))return 7;
  abandoned.first.close();
  const background=ports.create();
  const workerGrant=background.second.transfer();
  if(!send(background.first,"hello"))return 8;
  let reply="",exit=-1;
  let peerClosed=false;
  background.first.watch((entry:NativeAgentPacketEntry):void=>{reply=receive(background.first,entry);},
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
    ["mailbox", "packages/native-runtime/src/agent-messages.ts"],
    ["packets", "packages/native-runtime/src/packet-memory.ts"],
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
    // Packet views bring tint:ffi, whose runtimes include the memory
    // intrinsics.
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
