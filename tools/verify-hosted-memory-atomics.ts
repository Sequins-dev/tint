import { verifyHostedFixture } from "./hosted-fixture.ts";

// Raw-word atomics (memory-compare-exchange-word, memory-fetch-add-word,
// memory-load-acquire-word, memory-store-release-word) share the
// memory-read-word window contract and return the word observed before the
// operation, or -1 for invalid input or an observed word outside the exact
// integer domain. The collector worker thunk runs a closure on pool threads:
// four threads each add 1 to a shared counter 100000 times and return 7.
// The closure is created before any thread starts and nothing allocates
// until every thread is joined, so its object cannot move meanwhile.
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
verifyHostedFixture(
  `
import {mapMemory,unmapMemory,readMemoryWord,writeMemoryWord,compareExchangeMemoryWord,fetchAddMemoryWord,loadAcquireMemoryWord,storeReleaseMemoryWord,collectorWorkerEntry,permanentFunctionAddress,startNativeThread,joinNativeThread} from "memory";
function pick(a:number[],i:number):number{ return a[i]??0; }
function cas(address:number,expected:number,replacement:number):number{ return compareExchangeMemoryWord(address,64,8,expected,replacement); }
function add(address:number,delta:number):number{ return fetchAddMemoryWord(address,64,8,delta); }
export function run():number {
 const base=mapMemory(4096);
 if(base<=0)return 1;
 const a:number[]=[base,base+3,0,9007199254740991];
 const at=pick(a,0);
 if(writeMemoryWord(at,64,8,5)!==0)return 2;
 // Compare-exchange: a match stores, a mismatch observes and keeps.
 if(cas(at,5,9)!==5)return 3;
 if(readMemoryWord(at,64,8)!==9)return 4;
 if(cas(at,5,11)!==9)return 5;
 if(readMemoryWord(at,64,8)!==9)return 6;
 // Fetch-add returns the previous word; deltas may be negative.
 if(add(at,3)!==9)return 7;
 if(add(at,-12)!==12)return 8;
 if(readMemoryWord(at,64,8)!==0)return 9;
 // Acquire loads and release stores.
 if(storeReleaseMemoryWord(at,64,16,77)!==0)return 10;
 if(loadAcquireMemoryWord(at,64,16)!==77)return 11;
 // A word past the exact integer domain is observed as -1.
 if(writeMemoryWord(at,64,8,9007199254740991)!==0)return 12;
 if(add(at,1)!==9007199254740991)return 13;
 if(loadAcquireMemoryWord(at,64,8)!==-1)return 14;
 if(writeMemoryWord(at,64,8,0)!==0)return 15;
 // Invalid addresses, windows and arguments.
 if(cas(pick(a,1),0,1)!==-1)return 16;
 if(add(pick(a,2),1)!==-1)return 17;
 if(loadAcquireMemoryWord(at,8,8)!==-1)return 18;
 if(storeReleaseMemoryWord(at,64,8,-1)!==-1)return 19;
 if(cas(at,0,0.5)!==-1)return 20;
 if(add(at,0.5)!==-1)return 21;
 if(readMemoryWord(at,64,8)!==0)return 22;
 // Pool threads through the collector worker thunk.
 const worker=(record:number):number=>{
  for(let i=0;i<100000;i++)fetchAddMemoryWord(record,64,8,1);
  return 7;
 };
 if(writeMemoryWord(at,64,0,permanentFunctionAddress(worker))!==0)return 23;
 const entry=collectorWorkerEntry();
 const threads:number[]=[];
 for(let i=0;i<4;i++){const t=startNativeThread(entry,at);if(t<=0)return 24;threads.push(t);}
 for(const t of threads){if(t===undefined)return 25;if(joinNativeThread(t)!==7)return 26;}
 if(readMemoryWord(at,64,8)!==400000)return 27;
 if(unmapMemory(base,4096)!==0)return 28;
 return 42;
}
`,
  "memory-atomics",
  [["memory", memory]],
  [],
  [],
  [{ module: memory, namespace: "memory-atomics-memory" }],
  {
    runtimeEntry: "initializeRuntime",
    managedBytes: 4194304,
    allocationCapacity: 65536,
    rootCapacity: 4096,
    stackBytes: 1048576,
    hostBindings: [
      { module: memory, name: "mapMemory", operation: "memory-map" },
      { module: memory, name: "unmapMemory", operation: "memory-unmap" },
      { module: memory, name: "readMemoryWord", operation: "memory-read-word" },
      {
        module: memory,
        name: "writeMemoryWord",
        operation: "memory-write-word",
      },
      {
        module: memory,
        name: "compareExchangeMemoryWord",
        operation: "memory-compare-exchange-word",
      },
      {
        module: memory,
        name: "fetchAddMemoryWord",
        operation: "memory-fetch-add-word",
      },
      {
        module: memory,
        name: "loadAcquireMemoryWord",
        operation: "memory-load-acquire-word",
      },
      {
        module: memory,
        name: "storeReleaseMemoryWord",
        operation: "memory-store-release-word",
      },
      {
        module: memory,
        name: "collectorWorkerEntry",
        operation: "collector-worker-entry",
      },
      {
        module: memory,
        name: "permanentFunctionAddress",
        operation: "permanent-function-address",
      },
      { module: memory, name: "startNativeThread", operation: "thread-start" },
      { module: memory, name: "joinNativeThread", operation: "thread-join" },
    ],
  },
);
