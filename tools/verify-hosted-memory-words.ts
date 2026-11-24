import { verifyHostedFixture } from "./hosted-fixture.ts";

// Inline memory word accesses (packages/codegen/src/aarch64/scalar/index.ts,
// memory-read-word / memory-write-word) validate every argument: exact safe
// integer addresses, offsets and lengths, a nonzero aligned effective
// address within MAX_SAFE_INTEGER - 7, an eight-byte access inside the
// caller's window, and safe-integer values. Each rejection yields -1. Constant
// windows (zero and nonzero offsets) skip the window checks at compile time;
// dynamic windows check them at run time. Addresses arrive through an array
// so they stay dynamic after inlining.
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
verifyHostedFixture(
  `
import {mapMemory,unmapMemory,readMemoryWord,writeMemoryWord} from "memory";
function readAt(address:number):number{ return readMemoryWord(address,64,0); }
function readAfter(address:number):number{ return readMemoryWord(address,64,16); }
function readWindow(address:number,length:number,offset:number):number{ return readMemoryWord(address,length,offset); }
function writeAt(address:number,value:number):number{ return writeMemoryWord(address,64,0,value); }
function writeAfter(address:number,value:number):number{ return writeMemoryWord(address,64,16,value); }
function pick(a:number[],i:number):number{ return a[i]??0; }
function writeWindow(address:number,length:number,offset:number,value:number):number{ return writeMemoryWord(address,length,offset,value); }
export function run():number {
 const base=mapMemory(4096);
 if(base<=0)return 1;
 const a:number[]=[base,base+8,base+3,0,-8,-16,9007199254740992,base+0.5,NaN,9007199254740991,base+4088];
 // Valid writes and their reads, at fixed and dynamic windows.
 if(writeAt(pick(a,0),12345)!==0)return 2;
 if(readAt(pick(a,0))!==12345)return 3;
 if(writeAfter(pick(a,0),9007199254740991)!==0)return 4;
 if(readAt(pick(a,0)+16)!==9007199254740991)return 5;
 if(readAfter(pick(a,0))!==9007199254740991)return 6;
 if(writeWindow(pick(a,1),16,8,77)!==0)return 7;
 if(readWindow(pick(a,0),24,16)!==77)return 8;
 if(readAt(pick(a,10))!==0)return 9;
 // Misaligned, null, negative (with and without offsets), unsafe and
 // fractional addresses.
 for(let i=2;i<=9;i++){
  if(readAt(pick(a,i))!==-1)return 10+i;
  if(readAfter(pick(a,i))!==-1)return 20+i;
  if(writeAt(pick(a,i),1)!==-1)return 30+i;
  if(writeAfter(pick(a,i),1)!==-1)return 40+i;
  if(readWindow(pick(a,i),64,8)!==-1)return 50+i;
 }
 // -16 + 16 is the null address; -8 + 16 would wrap to 8.
 if(readWindow(pick(a,5),64,16)!==-1)return 60;
 if(readWindow(pick(a,4),64,16)!==-1)return 61;
 // Windows: access past the end, short windows, fractional and unsafe
 // lengths and offsets.
 if(readWindow(pick(a,0),64,57)!==-1)return 62;
 if(readWindow(pick(a,0),7,0)!==-1)return 63;
 if(readWindow(pick(a,0),64,0.5)!==-1)return 64;
 if(readWindow(pick(a,0),9007199254740992,0)!==-1)return 65;
 if(readWindow(pick(a,0),64,-8)!==-1)return 66;
 if(writeWindow(pick(a,0),64,57,1)!==-1)return 67;
 // Values must be safe integers.
 if(writeAt(pick(a,0),9007199254740992)!==-1)return 68;
 if(writeAt(pick(a,0),-1)!==-1)return 69;
 if(writeAt(pick(a,0),1.5)!==-1)return 70;
 if(readAt(pick(a,0))!==12345)return 71;
 if(unmapMemory(base,4096)!==0)return 72;
 return 42;
}
`,
  "memory-words",
  [["memory", memory]],
  [],
  [],
  [{ module: memory, namespace: "memory-words-memory" }],
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
    ],
  },
);
