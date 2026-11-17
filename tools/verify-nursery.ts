import { nativeFixtureTarget } from "./native-host-target.ts";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { workspaceModules } from "./workspace-sources.ts";
import { projectRoots, projectBuildRequest } from "@tint/compiler/cli";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { buildMacOSProgram } from "@tint/compiler/build";
const bytes = new TextEncoder()
  .encode(`import {mapMemory,unmapMemory,readMemoryWord,writeMemoryWord,moveMemory,configureLinearAllocation,configureGenerationalAllocation} from "native-memory";
import {createNurseryEvacuator} from "native-tracing";
export function run():number {
 const base=mapMemory(4096);if(base<=0)return 1;
 const rejected=new Uint32Array(8),bits=new Uint32Array(1);
 if(configureLinearAllocation(new Uint32Array(7),bits)!==-1||configureLinearAllocation(rejected,bits)!==-1)return 15;
 rejected[1]=16;rejected[0]=1;if(configureLinearAllocation(rejected,bits)!==-1)return 16;
 rejected[0]=0;rejected[2]=16;if(configureLinearAllocation(rejected,bits)!==-1)return 17;
 rejected[2]=0;rejected[1]=18;if(configureLinearAllocation(rejected,bits)!==-1)return 18;
 rejected[1]=16;if(configureLinearAllocation(rejected,new Uint32Array(0))!==-1)return 19;
 const generation=new Uint32Array(16),dirty=new Uint8Array(4),queue=new Float64Array(1);
 if(configureGenerationalAllocation(rejected,bits,dirty,queue)!==-1)return 23;
 generation[1]=512;
 if(configureGenerationalAllocation(generation,bits,dirty,queue)!==-1)return 24;
 generation[7]=512;
 if(configureGenerationalAllocation(generation,bits,dirty,queue)!==-1)return 25;
 generation[2]=512;generation[0]=1;
 if(configureGenerationalAllocation(generation,bits,dirty,queue)!==-1)return 26;
 generation[0]=0;generation[3]=1;
 if(configureGenerationalAllocation(generation,bits,dirty,queue)!==-1)return 27;
 generation[3]=0;generation[1]=513;
 if(configureGenerationalAllocation(generation,bits,dirty,queue)!==-1)return 28;
 generation[1]=512;
 if(configureGenerationalAllocation(generation,bits,new Uint8Array(3),queue)!==-1||configureGenerationalAllocation(generation,bits,dirty,new Float64Array(0))!==-1||configureGenerationalAllocation(generation,new Uint32Array(0),dirty,queue)!==-1)return 29;
 generation[2]=2147483648;generation[7]=2147483648;
 if(configureGenerationalAllocation(generation,bits,dirty,queue)!==-1)return 30;
 if(readMemoryWord(base,8,0)!==0||readMemoryWord(base,8,-0)!==0)return 9;
 if(readMemoryWord(base,7,0)!==-1||readMemoryWord(base,8,8)!==-1||readMemoryWord(base,8,0.5)!==-1||readMemoryWord(base,0/0,0)!==-1||readMemoryWord(base,1/0,0)!==-1)return 10;
 if(readMemoryWord(0,8,0)!==-1||readMemoryWord(base+1,8,0)!==-1||writeMemoryWord(base,8,0,-1)!==-1)return 11;
 if(writeMemoryWord(base,8,0,9007199254740991)!==0||readMemoryWord(base,8,0)!==9007199254740991)return 12;
 if(writeMemoryWord(base,8,0,4294967304)!==0||readMemoryWord(base,8,0)!==4294967304)return 13;
 if(writeMemoryWord(base,8,0,9007199254740992)!==-1||readMemoryWord(base,8,0)!==4294967304)return 14;
 writeMemoryWord(base,8,0,0);
 writeMemoryWord(base,4096,1024,32);writeMemoryWord(base,4096,1032,1);writeMemoryWord(base,4096,1040,16);
 writeMemoryWord(base,4096,1088,1);writeMemoryWord(base,4096,1096,16);
 writeMemoryWord(base,4096,2056,base+1088);writeMemoryWord(base,4096,2064,base+32);
 writeMemoryWord(base,4096,3000,base+96);
 for(let i=0;i<4;i++) {
  writeMemoryWord(base,4096,i*32,i%2===1?base+1024:0);
  writeMemoryWord(base,4096,i*32+16,i===1?base+96:i===3?base+32:0);
 }
 const starts=new Uint32Array(1);starts[0]=85;
 const summary=new Uint32Array(3);
 let published=0,promoting=false;
 const collector=createNurseryEvacuator({base,byteLength:128,targetBase:base+512,targetLength:128,
 starts,forwarding:new Uint32Array(8),sources:new Uint32Array(8),sizes:new Uint32Array(8),destinations:new Uint32Array(8),slots:new Float64Array(32),values:new Float64Array(32),summary,
 read:(address:number):number|undefined=>{const value=readMemoryWord(base,4096,address-base);return value<0?undefined:value;},
 isExternal:(address:number):boolean=>(promoting&&address===base+32)||(address>=base+1024&&address<base+4096),
 scanRemembered:(visit:(address:number,slot:number)=>boolean):boolean=>promoting?visit(readMemoryWord(base,4096,48),base+48):visit(readMemoryWord(base,4096,3000),base+3000),
 canWrite:(slot:number):boolean=>(slot>=base+512&&slot<base+640)||(slot>=base&&slot<base+32)||slot===base+48||slot===base+2064||slot===base+3000,
 copy:(destination:number,source:number,size:number):boolean=>moveMemory(base,4096,destination-base,source-base,size)===0,
 write:(slot:number,value:number):boolean=>writeMemoryWord(base,4096,slot-base,value)===0,
 publish:(count:number,bytes:number):boolean=>{published++;return promoting?count===1&&bytes===32:count===2&&bytes===64;}});
 if(collector===undefined)return 2;
 if(!collector.prepare(128,base+2048)||summary[0]!==2||summary[1]!==64||summary[2]!==4)return 3;
 if(readMemoryWord(base,4096,2064)!==base+32)return 4;
 if(!collector.commit()||published!==1)return 5;
 if(readMemoryWord(base,4096,2064)!==base+512||readMemoryWord(base,4096,3000)!==base+544||readMemoryWord(base,4096,528)!==base+544||readMemoryWord(base,4096,560)!==base+512)return 6;
 if(collector.commit())return 7;
 promoting=true;writeMemoryWord(base,4096,2064,base+96);
 if(!collector.prepareRange(base+64,64,base,32,64,base+2048)||summary[0]!==1||summary[1]!==32)return 20;
 if(!collector.commit())return 21;
 if(readMemoryWord(base,4096,2064)!==base||readMemoryWord(base,4096,48)!==base||readMemoryWord(base,4096,16)!==base+32)return 22;
 for(let offset=0;offset<128;offset+=8)writeMemoryWord(base,4096,offset,0);
 writeMemoryWord(base,4096,0,6);writeMemoryWord(base,4096,16,3);writeMemoryWord(base,4096,32,base+64);writeMemoryWord(base,4096,48,base);
 writeMemoryWord(base,4096,64,6);writeMemoryWord(base,4096,80,1);writeMemoryWord(base,4096,96,base);
 writeMemoryWord(base,4096,2064,base);
 const vectorStarts=new Uint32Array(1);vectorStarts[0]=17;
 const vectors=createNurseryEvacuator({base,byteLength:128,targetBase:base+512,targetLength:128,
 starts:vectorStarts,forwarding:new Uint32Array(8),sources:new Uint32Array(8),sizes:new Uint32Array(8),destinations:new Uint32Array(8),slots:new Float64Array(32),values:new Float64Array(32),summary,
 read:(address:number):number|undefined=>{const value=readMemoryWord(base,4096,address-base);return value<0?undefined:value;},
 isExternal:(address:number):boolean=>address>=base+1024&&address<base+4096,scanRemembered:(visit:(address:number,slot:number)=>boolean):boolean=>true,
 canWrite:(slot:number):boolean=>(slot>=base+512&&slot<base+640)||slot===base+2064,
 copy:(destination:number,source:number,size:number):boolean=>moveMemory(base,4096,destination-base,source-base,size)===0,
 write:(slot:number,value:number):boolean=>writeMemoryWord(base,4096,slot-base,value)===0,
 publish:(count:number,bytes:number):boolean=>count===2&&bytes===112});
 if(vectors===undefined||!vectors.prepare(112,base+2048)||!vectors.commit())return 31;
 if(readMemoryWord(base,4096,2064)!==base+512||readMemoryWord(base,4096,544)!==base+576||readMemoryWord(base,4096,560)!==base+512||readMemoryWord(base,4096,608)!==base+512)return 32;
 if(readMemoryWord(base,4096,536)!==0||readMemoryWord(base,4096,600)!==0)return 33;
 return unmapMemory(base,4096)===0?42:8;
}`);
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
      ["native-tracing", "packages/native-runtime/src/tracing/index.ts"],
    ]),
  },
];
const request = projectBuildRequest(modules, () => {});
const memoryModule = "packages/native-runtime/src/intrinsics/memory.ts";
const built = buildMacOSProgram({
  target: nativeFixtureTarget(),
  ...request,
  // The fixture deliberately manipulates an independent raw mapping. Its own
  // host runtime therefore uses the copying policy, not the restricted mutator.
  runtimeEntry: "initializeCopyingRuntime",
  entry: "fixture",
  start: "run",
  managedBytes: 4194304,
  allocationCapacity: 65536,
  rootCapacity: 4096,
  stackBytes: 1048576,
  identifier: "tint-nursery",
  debugSymbols: true,
  debugDirectory: process.cwd(),
  runtimes: [
    ...request.runtimes,
    { module: memoryModule, namespace: "native-memory" },
  ],
  hostBindings: [
    ...request.hostBindings,
    {
      module: memoryModule,
      name: "configureLinearAllocation",
      operation: "allocation-state",
    },
    {
      module: memoryModule,
      name: "configureGenerationalAllocation",
      operation: "generational-state",
    },
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
const directory = mkdtempSync(join(tmpdir(), "tint-nursery-")),
  path = join(directory, "nursery");
writeFileSync(path, built.value, { mode: 0o755 });
console.log(path);
for (let attempt = 0; attempt < 2; attempt++) {
  const result = spawnSync(
    "/usr/bin/lldb",
    ["--batch", "-o", "process launch --stop-at-entry", "-o", "continue", path],
    {
      encoding: "utf8",
      timeout: 60000,
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /exited with status = 42 /);
}
console.log(
  "Verified native survivor-only evacuation, remembered edges and cyclic reference-vector relocation twice.",
);
