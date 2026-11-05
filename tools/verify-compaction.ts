import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { workspaceModules } from "./workspace-sources.ts";
import { projectRoots, projectBuildRequest } from "@tint/compiler/cli";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { buildMacOSProgram } from "@tint/compiler/build";
const bytes = new TextEncoder()
  .encode(`import {mapMemory,unmapMemory,readMemoryWord,writeMemoryWord,moveMemory} from "native-memory";
import {createCollectingRegion} from "native-heap";
function check(capacity:number):number {
 const base=mapMemory(4096);if(base<=0)return 1;
 writeMemoryWord(base,4096,1024,32);writeMemoryWord(base,4096,1032,1);writeMemoryWord(base,4096,1040,16);
 writeMemoryWord(base,4096,1088,1);writeMemoryWord(base,4096,1096,16);
 writeMemoryWord(base,4096,2056,base+1088);writeMemoryWord(base,4096,2064,base+32);
 const heap=createCollectingRegion({base,byteLength:128,metadata:new Uint32Array(192),offsets:new Uint32Array(16),sizes:new Uint32Array(16),starts:new Float64Array(32),marks:new Uint8Array(16),pending:new Uint32Array(16),roots:new Float64Array(8),
 readWord:(address:number):number|undefined=>{const value=readMemoryWord(base,4096,address-base);return value<0?undefined:value;},rootHead:()=>base+2048,isExternal:(address:number):boolean=>false,
 compaction:{offsets:new Uint32Array(16),live:new Uint8Array(16),pinned:new Uint8Array(16),destinations:new Uint32Array(16),summary:new Uint32Array(4),slots:new Float64Array(capacity),values:new Float64Array(capacity),publishedOffsets:new Uint32Array(16),publishedSizes:new Uint32Array(16),
 canWrite:(slot:number):boolean=>(slot>=base&&slot<base+128)||slot===base+2064,
 write:(slot:number,value:number):boolean=>writeMemoryWord(base,4096,slot-base,value)===0,
 move:(destination:number,source:number,size:number):boolean=>moveMemory(base,128,destination,source,size)===0}});
 if(heap===undefined)return 2;
 for(let i=0;i<4;i++) {
  if(heap.allocate(32)!==i*32)return 3;
  writeMemoryWord(base,4096,i*32,base+1024);
  writeMemoryWord(base,4096,i*32+16,i===1?base+96:i===3?base+32:0);
 }
 if(capacity===1) {
  if(heap.collect()!=="relocation"||heap.usedBytes()!==128||readMemoryWord(base,4096,2064)!==base+32||readMemoryWord(base,4096,48)!==base+96)return 4;
 } else {
  if(heap.collect()!=="complete"||heap.usedBytes()!==64)return 5;
  if(readMemoryWord(base,4096,2064)!==base||readMemoryWord(base,4096,16)!==base+32||readMemoryWord(base,4096,48)!==base)return 6;
  if(heap.allocate(64)!==64)return 7;
 }
 return unmapMemory(base,4096)===0?0:8;
}
export function run():number {const failed=check(1);if(failed!==0)return failed;const moved=check(32);return moved===0?42:moved;}
`);
const source = createSourceText(bytes, bytes.length);
assert.ok(source.ok);
const parsed = parseModule(source.value);
assert.ok(parsed.ok, JSON.stringify(parsed));
const modules = [
  ...workspaceModules(projectRoots()),
  {
    id: "fixture",
    module: parsed.value,
    dependencies: new Map([
      ["native-memory", "packages/native-runtime/src/intrinsics/memory.ts"],
      ["native-heap", "packages/native-runtime/src/heap/index.ts"],
    ]),
  },
];
const request = projectBuildRequest(modules, () => {});
const memoryModule = "packages/native-runtime/src/intrinsics/memory.ts";
const built = buildMacOSProgram({
  ...request,
  entry: "fixture",
  start: "run",
  managedBytes: 4194304,
  allocationCapacity: 65536,
  rootCapacity: 4096,
  stackBytes: 1048576,
  identifier: "tint-compaction",
  runtimes: [
    ...request.runtimes,
    { module: memoryModule, namespace: "native-memory" },
  ],
  hostBindings: [
    ...request.hostBindings,
    { module: memoryModule, name: "mapMemory", operation: "memory-map" },
    { module: memoryModule, name: "unmapMemory", operation: "memory-unmap" },
    {
      module: memoryModule,
      name: "readMemoryWord",
      operation: "memory-read-word",
    },
    {
      module: memoryModule,
      name: "writeMemoryWord",
      operation: "memory-write-word",
    },
    { module: memoryModule, name: "moveMemory", operation: "memory-move" },
  ],
});
assert.ok(built.ok, JSON.stringify(built));
const directory = mkdtempSync(join(tmpdir(), "tint-compaction-")),
  path = join(directory, "compaction");
writeFileSync(path, built.value, { mode: 0o755 });
console.log(path);
for (let attempt = 0; attempt < 2; attempt++) {
  const result = spawnSync("lldb", ["--batch", "-o", "run", path], {
    encoding: "utf8",
    timeout: 60000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /exited with status = 42 /);
}
console.log("Verified mapped-memory compaction and failure atomicity twice.");
