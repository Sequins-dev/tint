import type { NativeHostBinding } from "@tint/compiler/native";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The worker messages fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";

const target = nativeFixtureTarget();
const object = "packages/js-runtime/src/objects/index.ts";
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const views = ["viewObjectValue", "viewSymbolValue", "viewBigIntValue"];
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
];

verifyHostedFixture(
  `
import {createObject,createErrorRealm,createDataProperty,getProperty,viewObjectValue,callObjectValue,type OrdinaryObject,type ScriptPropertyKey,type ObjectHooks,type ErrorRealm} from 'object';
import {byteStorageData,createByteStorage} from 'bytes';
import {createSharedStorage} from 'shared-bytes';
import {monotonicMilliseconds} from 'clock';
import {createReactor} from 'reactor';
import {createReactorEventLoop} from 'loop';
import {createNativeSharedBlockService,nativeSharedMemoryHost,nativeWaiterParkingHost} from 'blocks';
import {createNativeWorkerThreadHost} from 'thread';
import {createNativeMessagePorts,type NativeMessagePort,type NativeMessagePorts} from 'ports';
import {createNativeWorkerBacking,type NativeWorkerBacking} from 'backing';
import {createNativeWorkerMessages,type NativeWorkerMessages} from 'messages';

type Value=OrdinaryObject<ScriptPropertyKey,unknown>;
interface TestEndpoint{
  readonly global:Value;
  readonly hooks:ObjectHooks<unknown>;
  readonly realm:ErrorRealm;
  readonly backing:NativeWorkerBacking;
  readonly ports:NativeMessagePorts;
  readonly messages:NativeWorkerMessages;
  readonly wrap:(port:NativeMessagePort)=>Value;
  readonly local:Map<number,NativeMessagePort>;
}

export function run(argument:number):number {
  if(argument!==0)return 50;
  const memory=nativeSharedMemoryHost(),parking=nativeWaiterParkingHost(),threads=createNativeWorkerThreadHost();
  const loop=createReactorEventLoop({
    createReactor:()=>createReactor(),drainMicrotasks:():void=>{},
    now:():number=>monotonicMilliseconds(),onWake:():void=>{},
  });
  const owner=createNativeSharedBlockService(memory,{pageSize:16384,maxBlocks:4,maxReservedBytes:65536});
  if(!owner.ok)return 1;
  const shared=owner.value;
  function endpoint():TestEndpoint {
    const global=createObject<ScriptPropertyKey,unknown>(undefined);
    const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,call:(fn,receiver,args):unknown=>{const result=callObjectValue(fn,receiver,args,global);if(result.error!=="none")throw "CALL";return result.value;}};
    const realm=createErrorRealm(global,hooks);
    const backing=createNativeWorkerBacking(memory);
    const local=new Map<number,NativeMessagePort>();
    const ports=createNativeMessagePorts(memory,parking,threads,loop,(packet:string):void=>messages.discard(packet));
    function wrap(port:NativeMessagePort):Value {
      const object=createObject<ScriptPropertyKey,unknown>(realm.objectPrototype);
      object.internalIdentity=realm.agent.nextObjectIdentity++;
      local.set(object.internalIdentity,port);
      return object;
    }
    const messages:NativeWorkerMessages=createNativeWorkerMessages({
      realm,shared,backing,ports,portForObject:(object:Value):NativeMessagePort|undefined=>local.get(object.internalIdentity),
      objectForPort:wrap,
    });
    return {global,hooks,realm,backing,ports,messages,wrap,local};
  }
  const from=endpoint(),to=endpoint();
  const made=createByteStorage(8,8,false,8,from.backing.allocate);
  if(!made.ok)return 2;
  const bytes=byteStorageData(made.value,"write");
  const original=from.backing.inspect(made.value);
  if(bytes===undefined||original===undefined)return 3;
  bytes[7]=88;
  const transfer=createObject<ScriptPropertyKey,unknown>(from.realm.arrayBufferPrototype);
  transfer.internalArrayBufferData=made.value;
  const created=createSharedStorage(shared,4,4,false);
  if(!created.ok)return 4;
  const sab=createObject<ScriptPropertyKey,unknown>(from.realm.sharedArrayBufferPrototype);
  sab.internalSharedArrayBufferData=created.value;
  const pair=from.ports.create(),peer=to.ports.adopt(pair.second.transfer());
  const second=from.ports.create(),channel=from.wrap(second.second);
  const data=createObject<ScriptPropertyKey,unknown>(from.global);
  createDataProperty<ScriptPropertyKey,unknown>(data,"buffer",transfer,from.hooks);
  createDataProperty<ScriptPropertyKey,unknown>(data,"shared",sab,from.hooks);
  createDataProperty<ScriptPropertyKey,unknown>(data,"port",channel,from.hooks);
  const bad:unknown[]=[transfer,transfer];
  let rejected=false;
  try{from.messages.send(pair.first,data,bad);}catch(error){
    const object=viewObjectValue(error,from.global);
    rejected=object!==undefined&&getProperty<ScriptPropertyKey,unknown>(object,"name",object,from.hooks)==="DataCloneError";
  }
  if(!rejected||byteStorageData(made.value)===undefined)return 5;
  const items:unknown[]=[transfer,channel];
  from.messages.send(pair.first,data,items);
  if(byteStorageData(made.value)!==undefined||second.second.inspect()!==undefined)return 6;
  const packet=peer.take();
  if(packet===undefined)return 7;
  const cloned=viewObjectValue(to.messages.receive(packet),to.global);
  if(cloned===undefined)return 8;
  const result:Value=cloned;
  function get(name:string):Value|undefined {
    return viewObjectValue(getProperty<ScriptPropertyKey,unknown>(result,name,result,to.hooks),to.global);
  }
  const received=get("buffer")?.internalArrayBufferData;
  if(received===undefined||to.backing.inspect(received)?.address!==original.address||
     byteStorageData(received)?.[7]!==88)return 9;
  const sharedCopy=get("shared")?.internalSharedArrayBufferData;
  if(sharedCopy===undefined||sharedCopy.handle!==created.value.handle)return 10;
  const port=get("port");
  if(port===undefined)return 11;
  const adopted=to.local.get(port.internalIdentity);
  if(adopted===undefined)return 12;
  const empty:unknown[]=[];
  to.messages.send(adopted,"hello",empty);
  const reply=second.first.take();
  if(reply===undefined||from.messages.receive(reply)!=="hello")return 13;
  adopted.close();second.first.close();peer.close();pair.first.close();
  from.backing.close();to.backing.close();loop.close();
  return 42;
}
`,
  "worker-messages",
  [
    ["object", object],
    ["bytes", "packages/js-runtime/src/bytes/index.ts"],
    ["shared-bytes", "packages/js-runtime/src/bytes/shared.ts"],
    ["clock", clock],
    ["reactor", "packages/platform/src/" + target.os + "/reactor.ts"],
    ["loop", "packages/native-runtime/src/event-loop-reactor.ts"],
    ["blocks", "packages/native-runtime/src/shared-blocks.ts"],
    ["thread", "packages/platform/src/workers.ts"],
    ["ports", "packages/native-runtime/src/worker-ports.ts"],
    ["backing", "packages/native-runtime/src/worker-backing.ts"],
    ["messages", "packages/native-runtime/src/worker-messages.ts"],
  ],
  [],
  views.map((name) => ({ module: object, name, operation: "view" })),
  [
    { module: object, namespace: "ordinary-object", retainedExports: views },
    ...[clock, shared].map((module, index) => ({
      module,
      namespace: "worker-messages-" + index,
      retainedExports: bindings
        .filter((binding) => binding.module === module)
        .map((binding) => binding.name),
    })),
  ],
  {
    managedBytes: 16777216,
    allocationCapacity: 262144,
    stackBytes: 16777216,
    requireTyped: true,
    threaded: true,
    runtimeEntry:
      target.arch === "x86_64"
        ? "initializeGenerationalRuntime"
        : "initializeCopyingRuntime",
    hostBindings: bindings,
  },
);
