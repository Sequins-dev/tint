import type { NativeHostBinding } from "@tint/compiler/native";
import { verifyHostedFixture } from "./hosted-fixture.ts";

// Store-buffering and message-passing litmus tests on the shared access leaves
// that every Atomics and SharedArrayBuffer access reaches. Two native threads
// race on words in separate cache lines with nothing but the leaf between the
// racing accesses. Ordered (seq-cst) phases must never show the outcome that
// sequential consistency forbids. The unordered phases show the hardware's own
// reordering, which proves that the test can observe it.
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The shared ordering litmus fixture must run under LLDB");
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const fs = "packages/native-runtime/src/intrinsics/fs.ts";
const hostBindings: readonly NativeHostBinding[] = [
  { module: memory, name: "mapMemory", operation: "memory-map" },
  { module: memory, name: "unmapMemory", operation: "memory-unmap" },
  { module: memory, name: "startNativeThread", operation: "thread-start" },
  { module: memory, name: "joinNativeThread", operation: "thread-join" },
  {
    module: memory,
    name: "hostedThreadEntry",
    operation: "hosted-thread-entry",
  },
  { module: memory, name: "spinPause", operation: "cpu-pause" },
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
import {mapMemory,unmapMemory,startNativeThread,joinNativeThread,hostedThreadEntry,spinPause} from 'memory';
import {readSharedUnsigned,writeSharedUnsigned} from 'shared';
import {write} from 'fs';

const rounds=200000,spinLimit=100000000,bytes=1024;
// Each word sits on its own 128-byte line.
const start=0,x=128,y=256,seen=384,done=512,data=640,flag=768;

function load(base:number,offset:number,order:number):number{
 return readSharedUnsigned(base,bytes,offset,4,order);
}
function store(base:number,offset:number,value:number,order:number):void{
 writeSharedUnsigned(base,bytes,offset,4,value,order);
}
function awaitValue(base:number,offset:number,value:number):boolean{
 let spins=0;
 while(load(base,offset,1)!==value)if(++spins>spinLimit)return false;
 return true;
}
function pause(count:number):void{
 for(let i=0;i<count;i++)spinPause();
}
function print(text:string):void{
 const out=new Uint8Array(text.length);
 for(let i=0;i<text.length;i++)out[i]=text.charCodeAt(i);
 write(1,out);
}

function partner(base:number):number{
 for(let phase=0;phase<2;phase++){
  const order=1-phase;
  for(let round=1+phase*rounds;round<=(phase+1)*rounds;round++){
   if(!awaitValue(base,start,round))return 3;
   pause((round*13)&63);
   store(base,y,1,order);
   const observed=load(base,x,order);
   store(base,seen,observed,1);
   store(base,done,round,1);
  }
 }
 for(let phase=0;phase<2;phase++){
  const order=1-phase;
  if(!awaitValue(base,start,2*rounds+1+phase))return 4;
  for(let value=1+phase*rounds;value<=(phase+1)*rounds;value++){
   store(base,data,value,0);
   store(base,flag,value,order);
  }
 }
 return 7;
}

export function run(argument:number):number{
 if(argument!==0)return partner(argument);
 const base=mapMemory(bytes);
 if(base<=0)return 1;
 const thread=startNativeThread(hostedThreadEntry(),base);
 if(thread<=0)return 2;
 const storeBuffering=new Float64Array(2),messagePassing=new Float64Array(2);
 for(let phase=0;phase<2;phase++){
  const order=1-phase;
  let both=0;
  for(let round=1+phase*rounds;round<=(phase+1)*rounds;round++){
   store(base,x,0,1);
   store(base,y,0,1);
   store(base,start,round,1);
   pause((round*37)&511);
   store(base,x,1,order);
   const observed=load(base,y,order);
   if(!awaitValue(base,done,round))return 5;
   if(observed===0&&load(base,seen,1)===0)both++;
  }
  storeBuffering[phase]=both;
 }
 for(let phase=0;phase<2;phase++){
  const order=1-phase,last=(phase+1)*rounds;
  store(base,start,2*rounds+1+phase,1);
  let stale=0,spins=0;
  for(;;){
   const published=load(base,flag,order);
   const value=load(base,data,0);
   if(value<published)stale++;
   if(published===last)break;
   if(++spins>spinLimit)return 6;
  }
  messagePassing[phase]=stale;
 }
 if(joinNativeThread(thread)!==7)return 8;
 if(unmapMemory(base,bytes)!==0)return 9;
 const orderedBoth=storeBuffering[0]??-1,unorderedBoth=storeBuffering[1]??-1;
 const orderedStale=messagePassing[0]??-1,unorderedStale=messagePassing[1]??-1;
 print("shared ordering litmus: "+rounds+" rounds per phase; store buffering both-zero seq-cst "+orderedBoth+", unordered "+unorderedBoth+"; message passing stale seq-cst "+orderedStale+", unordered "+unorderedStale+"\\n");
 return orderedBoth===0&&orderedStale===0?42:10;
}
`,
  "shared-ordering-litmus",
  [
    ["memory", memory],
    ["shared", shared],
    ["fs", fs],
  ],
  [],
  [],
  [
    {
      module: memory,
      namespace: "ordering-litmus-memory",
      retainedExports: hostBindings
        .filter((binding) => binding.module === memory)
        .map((binding) => binding.name),
    },
    {
      module: shared,
      namespace: "ordering-litmus-shared",
      retainedExports: ["readSharedUnsigned", "writeSharedUnsigned"],
    },
  ],
  {
    threaded: true,
    managedBytes: 4194304,
    allocationCapacity: 65536,
    runtimeEntry: "initializeGenerationalRuntime",
    hostBindings,
  },
);
