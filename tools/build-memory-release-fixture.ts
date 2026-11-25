// memory-release's defensive range check (IR host.ts): on both backends a
// collector runtime may return pages only inside the context's managed
// mapping or inside the releasable window its identity page records (the
// shared string arena). The fixture's runtime checks, before starting the
// generational runtime:
// - a range in an unregistered mapping is rejected and stays intact;
// - a range in the registered window is released (it reads as zero), while
//   ranges that straddle the window's end or start below it, and misaligned
//   ones, are rejected;
// - after unregistering, the window is rejected again.
// (Startup publishes the managed mapping to the context after the runtime
// initializes; every major collection releases pages inside it.)
// A failed check throws from runtime startup (exit 70); the program then
// returns 42. Build with TINT_BUILD_ONLY=1 and run the image under LLDB.
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { parsedNativeHost } from "./test262-native.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The memory-release fixture must run under LLDB");

const runtime = parsedNativeHost(
  "memory-release-runtime",
  `
import {initializeGenerationalRuntime as start} from "generational";
import {mapMemory,memoryPageBytes,readMemoryWord,releaseMemory,writeMemoryWord,currentContextDomain} from "memory";
// The collector runtime has no number formatting: the code is the throw.
function require(condition:boolean,code:number):void { if(!condition)throw code; }
export function initializeGenerationalRuntime(managedBase:number,managedLength:number,controlBase:number,controlLength:number,imageBase:number,imageLength:number,stackBase:number,stackLength:number,metadata:Uint32Array,offsets:Uint32Array,sizes:Uint32Array,starts:Float64Array,marks:Uint8Array,pending:Uint32Array,roots:Float64Array):(bytes:number)=>number|undefined {
 const page=memoryPageBytes(),identity=currentContextDomain();
 require(page>=4096&&identity>0,1);
 // An unregistered mapping: rejected, and its contents stay.
 const other=mapMemory(page*4);
 require(other>0,2);
 require(writeMemoryWord(other,page*4,page,7)===0,3);
 require(releaseMemory(other+page,page)!==0,4);
 require(readMemoryWord(other,page*4,page)===7,5);
 // The registered window: released inside, rejected across its bounds.
 const window=mapMemory(page*4);
 require(window>0,6);
 require(writeMemoryWord(identity,40,32,page*4)===0&&writeMemoryWord(identity,40,24,window)===0,7);
 require(writeMemoryWord(window,page*4,page,9)===0,8);
 require(releaseMemory(window+page,page)===0,9);
 require(readMemoryWord(window,page*4,page)===0,10);
 require(releaseMemory(window+page*3,page*2)!==0,11);
 require(releaseMemory(window-page,page)!==0,12);
 require(releaseMemory(window+8,page)!==0,13);
 // Unregister: the window is no longer releasable.
 require(writeMemoryWord(identity,40,24,0)===0&&writeMemoryWord(identity,40,32,0)===0,15);
 require(releaseMemory(window,page)!==0,16);
 return start(managedBase,managedLength,controlBase,controlLength,imageBase,imageLength,stackBase,stackLength,metadata,offsets,sizes,starts,marks,pending,roots);
}`,
  new Map([
    ["generational", "packages/native-runtime/src/generational.ts"],
    ["memory", "packages/native-runtime/src/intrinsics/memory.ts"],
  ]),
);

verifyHostedFixture(
  `export function run(): number { return 42; }`,
  "memory-release",
  [],
  [runtime],
  [],
  [],
  {
    runtimeModule: runtime.id,
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 16777216,
    allocationCapacity: 262144,
    stackBytes: 8388608,
  },
);
