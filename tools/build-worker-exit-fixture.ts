import { nativeFixtureTarget } from "./native-host-target.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The worker exit fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";

const target = nativeFixtureTarget();
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const objects = "packages/js-runtime/src/objects/index.ts";
const bindings = [
  [clock, "monotonicMilliseconds", "monotonic-time"],
  [memory, "mapMemory", "memory-map"],
  [memory, "unmapMemory", "memory-unmap"],
  [shared, "readSharedWord64", "shared-read-word64"],
  [shared, "writeSharedWord64", "shared-write-word64"],
  [shared, "readSharedUnsigned", "shared-read-unsigned"],
  [shared, "writeSharedUnsigned", "shared-write-unsigned"],
  [shared, "compareExchangeSharedWord64", "shared-compare-exchange-word64"],
  [shared, "compareExchangeSharedUnsigned", "shared-compare-exchange-unsigned"],
  [memory, "parkNativeWord", "word-park"],
  [memory, "wakeNativeWord", "word-wake"],
  [memory, "startNativeThread", "thread-start"],
  [memory, "hostedThreadEntry", "hosted-thread-entry"],
] as const;

verifyHostedFixture(
  `
import {monotonicMilliseconds} from 'clock';
import {write} from 'fs';
import {createReactor} from 'reactor';
import {createNativeWorkerThreadHost} from 'thread';
import {createReactorEventLoop} from 'loop';
import {attachNativeSharedBlockService,createNativeSharedBlockService,nativeSharedMemoryHost,nativeSharedAtomicMemoryHost,nativeWaiterParkingHost} from 'blocks';
import {createNativeWaitRegistry,type NativeWaiterParkingHost} from 'waiters';
import {startNativeWorker,runNativeWorker,type NativeWorkerTurnControl} from 'workers';
import {callObjectValue,constructObject,createErrorRealm,createObject,createScriptAgent,createSymbolRegistry,getProperty,installAtomicsIntrinsics,installSharedArrayBufferIntrinsics,installTypedArrayIntrinsics,rejectEngineAbort,viewObjectValue,type ObjectHooks,type ScriptPropertyKey} from 'objects';

export function run(argument:number):number {
  const memory=nativeSharedMemoryHost(),kernel=nativeWaiterParkingHost();
  let observedWait=0,observedAt=0;
  const parking:NativeWaiterParkingHost={
    park:(address:number,expected:number,timeout:number):number=>{
      if(observedWait!==0&&timeout===0&&memory.writeSharedWord64(observedWait,16384,observedAt,1,1,0)!==0)
        throw "worker wait ready signal failed";
      return kernel.park(address,expected,timeout);
    },
    wake:(address:number,all?:boolean):number=>kernel.wake(address,all),
  };
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
    if(id===4){
      const active=control.waiters;
      if(active===undefined)throw "missing worker waiter registry";
      const registered=active.register({engineId:moduleId,blockId:1,address:moduleId,
        byteLength:16384,byteOffset:16,width:4},0,0,false);
      if(!registered.ok||registered.value.state!=="waiting")throw "worker waiter enrollment failed";
      const ticket=registered.value.ticket;
      observedWait=moduleId;
      observedAt=8;
      try{
        while(true){
          const parked=control.parkWait(ticket,0);
          if(parked===undefined)return 0;
          if(!parked.ok)throw "worker waiter did not park";
          const state=active.poll(ticket);
          if(!state.ok||state.value!=="waiting")throw "worker waiter woke without stop";
        }
      }finally{
        active.expire(ticket);
        const retired=active.take(ticket);
        if(!retired.ok||retired.value==="waiting")throw "worker waiter release failed";
      }
    }
    if(id===5){
      const active=control.waiters;
      if(active===undefined)throw "missing guest waiter registry";
      const scratch=new Uint32Array(2);
      function readReady(offset:number):number{
        if(memory.readSharedWord64(moduleId,16384,offset,1,scratch)!==0)throw "guest grant read failed";
        return (scratch[0]??0)+(scratch[1]??0)*4294967296;
      }
      const base=readReady(32);
      const attached=attachNativeSharedBlockService(memory,{base,byteLength:readReady(40),engineId:base},nativeSharedAtomicMemoryHost(),{
        parking,now:()=>monotonicMilliseconds(),registry:active.registry,
        wrapWaiting:control.interruptibleWaiting,
      });
      if(!attached.ok)throw "guest shared service attachment failed";
      const global=createObject<ScriptPropertyKey,unknown>(undefined);
      const hooks:ObjectHooks<unknown>={undefinedValue:undefined,sameValue:(a,b):boolean=>a===b,
        call:(target,receiver,args):unknown=>{
          const result=callObjectValue(target,receiver,args,global);
          if(result.error!=="none")throw "guest call failed";
          return result.value;
        }};
      const realm=createErrorRealm(global,hooks,createSymbolRegistry(),createScriptAgent(true));
      installSharedArrayBufferIntrinsics(global,realm,hooks,attached.value);
      installTypedArrayIntrinsics(global,realm,hooks,"little");
      installAtomicsIntrinsics(global,realm,hooks,{lockFree1:true,lockFree2:true,lockFree8:true});
      function construct(name:string,args:unknown[]):unknown{
        const raw=getProperty<ScriptPropertyKey,unknown>(global,name,global,hooks);
        const ctor=viewObjectValue(raw,global);
        if(ctor===undefined)throw "guest constructor missing";
        const result=constructObject<ScriptPropertyKey,unknown>(ctor,args,{object:ctor,value:ctor},undefined);
        if(result.error!=="none")throw "guest construction failed";
        return result.value;
      }
      const sab=construct("SharedArrayBuffer",[4]);
      const view=construct("Int32Array",[sab]);
      const atomics=viewObjectValue(getProperty<ScriptPropertyKey,unknown>(global,"Atomics",global,hooks),global);
      if(atomics===undefined)throw "guest Atomics missing";
      const wait=getProperty<ScriptPropertyKey,unknown>(atomics,"wait",atomics,hooks);
      observedWait=moduleId;
      observedAt=24;
      try{
        callObjectValue(wait,atomics,[view,0,0,Infinity],global);
      }catch(error){
        rejectEngineAbort(realm,error);
        throw typeof error==="string"?error:"guest caught an ordinary exception";
      }
      throw "guest wait resumed";
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
  const created=createNativeWaitRegistry(memory,parking,ready,1);
  if(!created.ok){memory.unmapMemory(ready,16384);return 7;}
  const waiters=created.value;
  try{
    const blocks=createNativeSharedBlockService(memory,{pageSize:16384,maxBlocks:1,maxReservedBytes:16384},nativeSharedAtomicMemoryHost(),{
      parking, now:()=>monotonicMilliseconds(),maxWaiters:1,
    });
    if(!blocks.ok)return 9;
    const guestWaiters=blocks.value.waitEvents;
    const guestWaiting=blocks.value.waiting;
    if(guestWaiters===undefined||guestWaiting===undefined)return 10;
    function writeReady(offset:number,value:number):void{
      if(memory.writeSharedWord64(ready,16384,offset,1,value%4294967296,Math.floor(value/4294967296))!==0)
        throw "guest grant write failed";
    }
    writeReady(32,blocks.value.registry.base);
    writeReady(40,blocks.value.registry.byteLength);
    let first=0,second=0,third=0,fourth=0,fifth=0,events="";
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
    const atomic=startNativeWorker(memory,parking,threads,runtime,{
      threadId:4,moduleId:ready,waiters,
      onError:(message:string):void=>{throw message;},
      onExit:(status:number):void=>{fourth=status;},
    });
    const guest=startNativeWorker(memory,parking,threads,runtime,{
      threadId:5,moduleId:ready,waiters:guestWaiters,
      onError:(message:string):void=>{throw message;},
      onExit:(status:number):void=>{fifth=status;},
    });
    const scratch=new Uint32Array(2);
    let stopReactor=false,stopAtomic=false,stopGuest=false;
    const request:{close():void}=runtime.loop.setInterval(():void=>{
      if(memory.readSharedWord64(ready,16384,0,1,scratch)!==0)throw "worker ready read failed";
      if(scratch[0]!==0&&!stopReactor){blocked.requestStop();blocked.requestStop();stopReactor=true;}
      if(memory.readSharedWord64(ready,16384,8,1,scratch)!==0)throw "worker wait ready read failed";
      if(scratch[0]!==0&&!stopAtomic){atomic.requestStop();stopAtomic=true;}
      if(memory.readSharedWord64(ready,16384,24,1,scratch)!==0)throw "guest wait ready read failed";
      if(scratch[0]!==0&&!stopGuest){guest.requestStop();stopGuest=true;}
      if(stopReactor&&stopAtomic&&stopGuest)request.close();
    },5);
    worker.unref();if(worker.hasRef())return 2;
    worker.ref();if(!worker.hasRef()||worker.threadId!==1||failure.threadId!==2)return 3;
    const deadline=runtime.loop.setTimeout(():void=>{throw "workers did not exit";},1000);
    deadline.unref();
    runtime.loop.run("callback");
    blocked.requestStop();
    if(worker.hasRef()||failure.hasRef()||blocked.hasRef()||atomic.hasRef()||guest.hasRef())return 4;
    const reused=waiters.register({engineId:ready,blockId:1,address:ready,
      byteLength:16384,byteOffset:16,width:4},0,0,false);
    if(!reused.ok||reused.value.state!=="waiting")return 8;
    const guestReused=guestWaiting.register(1,0,4,0,0,false);
    if(!guestReused.ok||guestReused.value.state!=="waiting")return 11;
    return first===7&&second===1&&third===1&&fourth===1&&fifth===1&&events==="module failed=exit"?42:5;
  }catch(error){
    const message=typeof error==="string"?error:"unexpected worker fixture exception";
    write(2,new TextEncoder().encode(message+"\\n"));
    throw error;
  }finally{
    runtime.close();memory.unmapMemory(ready,16384);
    memory.unmapMemory(waiters.registry.base,waiters.registry.byteLength);
  }
}
`,
  "worker-lifecycle-v7",
  [
    ["clock", clock],
    ["fs", "packages/native-runtime/src/intrinsics/fs.ts"],
    ["reactor", "packages/platform/src/" + target.os + "/reactor.ts"],
    ["thread", "packages/platform/src/workers.ts"],
    ["loop", "packages/native-runtime/src/event-loop-reactor.ts"],
    ["blocks", "packages/native-runtime/src/shared-blocks.ts"],
    ["waiters", "packages/native-runtime/src/shared-waiters.ts"],
    ["workers", "packages/native-runtime/src/worker-lifecycle.ts"],
    ["objects", objects],
  ],
  [],
  [
    { module: objects, name: "viewObjectValue", operation: "view" },
    { module: objects, name: "viewSymbolValue", operation: "view" },
    { module: objects, name: "viewBigIntValue", operation: "view" },
  ],
  [
    ...[memory, shared, clock].map((module, index) => ({
      module,
      namespace: "worker-exit-" + index,
      retainedExports: bindings
        .filter((binding) => binding[0] === module)
        .map((binding) => binding[1]),
    })),
    {
      module: objects,
      namespace: "ordinary-object",
      retainedExports: [
        "viewObjectValue",
        "viewSymbolValue",
        "viewBigIntValue",
      ],
    },
  ],
  {
    threaded: true,
    threadExitPipe: true,
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
