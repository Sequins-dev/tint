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
  .encode(`import {reserveLinear} from "linear-allocator";
import {createKeyIndex} from "key-index";
import {createTypeSystem,type Type,type Property} from "value-types";
import {snapshotRegionAllocations,createRegionAllocator} from "region-allocator";
import {planCompaction,forwardOffset,commitRelocation} from "relocation-plan";
import {nativeObjectExtent,relocateNativeArrayData,scanNativeObject,createNativeFixupPlanner} from "native-tracing";
function linearReservations():boolean {
 const state=new Uint32Array(2);state[1]=128;
 if(reserveLinear(state,17,16)!==0||reserveLinear(state,1,16)!==32||reserveLinear(state,80,16)!==48||reserveLinear(state,1,16)!==undefined||state[0]!==128)return false;
 state[0]=4294967264;state[1]=4294967295;
 return reserveLinear(state,16,16)===4294967264&&reserveLinear(state,16,16)===undefined&&state[0]===4294967280;
}
function relocationCommit():boolean {
 if(!linearReservations())return false;
 const memory=new Float64Array(16),offsets=new Uint32Array(2),sizes=new Uint32Array(2),destinations=new Uint32Array(2),slots=new Float64Array(2),values=new Float64Array(2);
 memory[6]=96;memory[14]=32;offsets[0]=32;offsets[1]=96;sizes[0]=32;sizes[1]=32;destinations[1]=32;slots[0]=48;slots[1]=112;values[0]=32;
 let events=0;
 const result=commitRelocation({byteLength:128,alignment:16,maxExtents:8,count:2,offsets,sizes,destinations,fixupCount:2,slots,values,publishedOffsets:new Uint32Array(2),publishedSizes:new Uint32Array(2),
 canWrite:(slot:number):boolean=>slot>=0&&slot<=120,
 write:(slot:number,value:number):boolean=>{memory[slot/8]=value;events++;return true;},
 move:(destination:number,source:number,size:number):boolean=>{for(let i=0;i<size;i+=8){const value=memory[(source+i)/8];if(value===undefined)return false;memory[(destination+i)/8]=value;}events++;return true;},
 publish:(out:Uint32Array,extents:Uint32Array,count:number):boolean=>{events++;return count===2&&out[0]===0&&out[1]===32&&extents[0]===32;}});
 return result&&events===5&&memory[2]===32&&memory[6]===0;
}
function relocationPlanning():boolean {
  const offsets=new Uint32Array(4),sizes=new Uint32Array(4),live=new Uint8Array(4),pinned=new Uint8Array(4),destinations=new Uint32Array(4),summary=new Uint32Array(4);
  offsets[0]=16;offsets[1]=80;offsets[2]=112;offsets[3]=208;
  sizes[0]=32;sizes[1]=16;sizes[2]=32;sizes[3]=32;
  live[0]=1;live[1]=1;live[3]=1;pinned[1]=1;
  if(!planCompaction({byteLength:256,alignment:16,count:4,offsets,sizes,live,pinned},destinations,summary))return false;
  if(destinations[0]!==0||destinations[1]!==80||destinations[2]!==4294967295||destinations[3]!==96)return false;
  if(summary[0]!==3||summary[1]!==80||summary[2]!==64||summary[3]!==128)return false;
  if(forwardOffset(offsets,destinations,4,16)!==0||forwardOffset(offsets,destinations,4,112)!==undefined||forwardOffset(offsets,destinations,4,208)!==96)return false;
  const words=new Float64Array(256);
  words[32]=4;words[33]=0;words[34]=16;words[35]=288;
  words[64]=4;words[65]=2;words[66]=8;words[67]=304;words[68]=256;
  words[96]=4;words[97]=2;words[98]=2;words[99]=312;words[100]=512;
  const read=(address:number):number|undefined=>words[address/8];
  if(nativeObjectExtent(read,256,352)!==96||nativeObjectExtent(read,512,560)!==48||nativeObjectExtent(read,256,351)!==undefined)return false;
  const forward=(address:number):number|undefined=>address===256?128:undefined;
  const fixupSlots=new Float64Array(4),fixupValues=new Float64Array(4);
  const fixupPlanner=createNativeFixupPlanner(read,forward,(slot:number):boolean=>true,fixupSlots,fixupValues);
  if(fixupPlanner===undefined)return false;
  const starts=new Float64Array(1),extents=new Uint32Array(1),marks=new Uint8Array(1);starts[0]=256;extents[0]=96;marks[0]=2;
  if(fixupPlanner.prepare(starts,extents,marks,1,0)!==1||fixupSlots[0]!==280||fixupValues[0]!==160||words[35]!==288)return false;
  if(relocateNativeArrayData(read,768,forward)!==184)return false;
  if(relocateNativeArrayData(read,768,forward,2)!==undefined)return false;
  let seen=0;
  if(scanNativeObject(read,768,48,(address:number,slot:number):boolean=>{seen=address+slot;return true;})!=="complete"||seen!==1312)return false;
  words[33]=1;words[35]=8192;words[67]=8208;words[99]=8216;
  return relocateNativeArrayData(read,768,forward)===8216;
}
function wideRelation():boolean {
  const count=128, graph:Type[]=[{kind:"number"}];
  for(let i=0;i<count*2;i++)graph.push({kind:"array",element:0,readonly:true});
  for(let side=0;side<2;side++) {
    const properties:Property[]=[];
    for(let i=0;i<count;i++)properties.push({name:"p"+i,type:1+side*count+i,readonly:true});
    graph.push({kind:"object",properties});
  }
  const system=createTypeSystem(graph);
  return system.ok && system.value.assignable(count*2+1,count*2+2) && system.value.assignable(count*2+2,count*2+1);
}
function hintCollisions(indexed:boolean):boolean {
  const count=512, metadata=new Uint32Array(8192*3+96), dead=new Uint32Array(count*2);
  const allocator=createRegionAllocator(524288,16,metadata);if(allocator===undefined)return false;
  for(let i=0;i<count;i++) {
    const first=allocator.allocate(16);if(first===undefined)return false;dead[i*2]=first;
    if(allocator.allocate(16)===undefined)return false;
    const second=allocator.allocate(48);if(second===undefined)return false;dead[i*2+1]=second;
    if(allocator.allocate(16)===undefined)return false;
  }
  if(!allocator.releaseAll(dead,dead.length))return false;
  if(indexed && !allocator.enableSearchIndex(new Uint32Array(2048),new Uint32Array(4096)))return false;
  for(let i=0;i<count;i++) {
    if(allocator.allocate(64)!==count*96+i*640)return false;
    if(allocator.allocate(576)!==count*96+i*640+64)return false;
  }
  return true;
}
function highPlacement():boolean {
  const allocator=createRegionAllocator(65536,16,new Uint32Array(128*3+96));
  if(allocator===undefined)return false;
  const descriptors=new Uint32Array(128),maxima=new Uint32Array(256);
  if(allocator.allocate(16)!==0 || allocator.allocateFromEnd(4096)!==61440 || allocator.allocate(32)!==16)return false;
  if(!allocator.enableSearchIndex(descriptors,maxima))return false;
  if(allocator.allocateFromEnd(8192)!==53248 || allocator.allocate(64)!==48)return false;
  if(!allocator.release(61440) || !allocator.enableSearchIndex(descriptors,maxima))return false;
  if(allocator.allocateFromEnd(1024)!==64512 || !allocator.release(64512))return false;
  if(!allocator.enableSearchIndex(descriptors,maxima))return false;
  return allocator.allocateFromEnd(4096)===61440;
}
function boundedPlacement():boolean {
  const allocator=createRegionAllocator(65536,16,new Uint32Array(128*3+96));
  if(allocator===undefined)return false;
  if(allocator.allocateBelow(32768,49152)!==0)return false;
  if(!allocator.enableSearchIndex(new Uint32Array(128),new Uint32Array(256)))return false;
  if(allocator.allocateBelow(16400,49152)!==undefined || allocator.allocateAbove(16400,49152)!==undefined)return false;
  if(allocator.allocateBelow(16384,49152)!==32768 || allocator.allocateAbove(16384,49152)!==49152)return false;
  if(!allocator.release(0) || !allocator.release(32768) || !allocator.release(49152))return false;
  if(allocator.allocate(65536)!==0)return false;
  const offsets=new Uint32Array(2),sizes=new Uint32Array(2);offsets[1]=8;sizes[0]=16;sizes[1]=16;
  if(allocator.replaceAllocations(offsets,sizes,2))return false;
  offsets[1]=32;
  if(!allocator.replaceAllocations(offsets,sizes,2)||allocator.usedBytes()!==32)return false;
  return allocator.allocate(16)===16 && allocator.allocationSize(32)===16;
}
function wideInventory():boolean {
  const count=65536;
  const metadata=new Uint32Array(count*3+96), offsets=new Uint32Array(count), sizes=new Uint32Array(count), scratch=new Uint32Array(count), buckets=new Float64Array(count);
  for(let i=0;i<count;i++) { metadata[i*3]=(count-1-i)*16; metadata[i*3+1]=16; metadata[i*3+2]=4294967295; }
  if(snapshotRegionAllocations(metadata,count*16,offsets,sizes,scratch,buckets)!==count)return false;
  for(let i=0;i<count;i++)if(offsets[i]!==i*16||sizes[i]!==16||scratch[i]!==count-1-i)return false;
  return true;
}
function setCopies():boolean {
  const source=new Set<number>();source.add(0/0).add(-0).add(7);source.delete(7);source.add(7);
  let calls=0;
  const read=():ReadonlySet<number> => {calls++;return source;};
  const copy=new Set(read());source.delete(0/0);
  if(calls!==1||copy.size!==3||!copy.has(0/0)||source.has(0/0))return false;
  let index=0;
  for(const value of copy){
    if(index===0&&value===value)return false;
    if(index===1&&1/value!==1/0)return false;
    if(index===2&&value!==7)return false;
    index++;
  }
  if(index!==3)return false;
  // More than the active heap budget: source and destination roots must survive
  // allocation safepoints inside repeated copies, not just an allocation-free test.
  for(let i=0;i<32768;i++){
    const transient=new Set(copy);
    if(transient.size!==3||!transient.has(0/0))return false;
  }
  if(copy.size!==3||!copy.has(7)||source.size!==2)return false;
  const strings=new Set<string>();strings.add("a").add("b");
  const text=new Set(strings);strings.clear();
  if(text.size!==2||!text.has("a")||!text.has("b"))return false;
  const item={value:9}, objects=new Set<{value:number}>();objects.add(item);
  const refs=new Set(objects);objects.clear();item.value=10;
  for(const value of refs)if(value!==item||value.value!==10)return false;
  return refs.size===1&&new Set(new Set<number>()).size===0;
}
export function run():number{
  if(!setCopies())return 33;
  if(!relocationCommit())return 32;
  if(!relocationPlanning())return 31;
  if(!highPlacement())return 29;
  if(!boundedPlacement())return 30;
  if(!wideRelation())return 28;
  if(!wideInventory())return 26;
  if(!hintCollisions(false) || !hintCollisions(true))return 27;
  const values:({value:number}|undefined)[]=[];
  for(let i=0;i<8192;i++)values.push({value:i});
  const index=createKeyIndex<{value:number},number>(key=>key.value%256);
  for(let i=0;i<1024;i++){const key=values[i];if(key===undefined)return 7;index.set(key,i);}
  if(index.has({value:7}))return 8;
  for(let i=8191;i>=0;i--){const value=values[i];if(value===undefined||value.value!==i)return 1;}
  for(let i=0;i<8192;i+=3)values[i]=undefined;
  for(let i=0;i<8192;i++){
    const value=values[i];
    if(i%3===0){if(value!==undefined)return 2;}
    else if(value===undefined||value.value!==i)return 3;
  }
  values.splice(4096);
  for(let i=4096;i<8192;i++)values.push(undefined);
  for(let i=4096;i<8192;i++){if(values[i]!==undefined)return 4;values[i]={value:i+1};}
  for(let i=0;i<24000;i++){const temporary=[{value:i},{value:i+1}];const value=temporary[1];if(value===undefined||value.value!==i+1)return 5;}
  for(let i=4096;i<8192;i++){const value=values[i];if(value===undefined||value.value!==i+1)return 6;}
  let sum=0;
  index.forEach((value,key)=>{if(value!==key.value)throw "index identity";sum+=value;index.set(key,value+1);});
  if(sum!==523776)return 9;
  index.forEach((value,key)=>{if(index.get(key)!==key.value+1)throw "index replacement";});
  let rejected=false;
  try {index.forEach((value,key)=>{index.clear();});}
  catch(error){rejected=error==="INDEX_ITERATION_MUTATION";}
  if(!rejected)return 11;
  index.clear();
  const recovery={value:42};index.set(recovery,42);
  if(index.get(recovery)!==42||!index.delete(recovery))return 12;
  let remaining=0;index.forEach((value,key)=>{remaining++;});
  if(remaining!==0)return 10;
  values.splice(0);
  const graph:Type[]=[{kind:"number"}];
  for(let i=1;i<2048;i++)graph.push({kind:"array",element:0,readonly:true});
  const checked=createTypeSystem(graph);
  if(!checked.ok||!checked.value.assignable(1,2047))return 13;
  for(let i=0;i<64;i++){
    const added=checked.value.append({kind:"array",element:0,readonly:true});
    if(!added.ok||added.value!==2048+i||!checked.value.assignable(added.value,1))return 14;
  }
  if(checked.value.append({kind:"array",element:2112,readonly:true}).ok)return 15;
  const after=checked.value.append({kind:"boolean"});
  if(!after.ok||after.value!==2112)return 16;
  const scalarGraph:Type[]=[
    {kind:"literal",value:"x"},{kind:"literal",value:"y"},{kind:"union",members:[0,1]},
    {kind:"string"},{kind:"number"},{kind:"void"},{kind:"unknown"},{kind:"never"},
    {kind:"object",properties:[{name:"next",type:8,readonly:true}]},
    {kind:"object",properties:[{name:"next",type:9,readonly:true}]},
    {kind:"union",members:[4,9]},
    {kind:"union",members:[0,10]},
    {kind:"object",properties:[{name:"kind",type:0,readonly:true},{name:"next",type:12,readonly:true}]},
    {kind:"object",properties:[{name:"kind",type:1,readonly:true},{name:"next",type:13,readonly:true}]}
  ];
  const scalars=createTypeSystem(scalarGraph);if(!scalars.ok)return 19;
  const variants=scalars.value.append({kind:"union",members:[12,13]});
  if(!variants.ok||variants.value!==14)return 24;
  for(let i=0;i<5000;i++){
    const temporary=[{value:i},{value:i+1}];
    const value=temporary[1];if(value===undefined||value.value!==i+1)return 17;
    if(!checked.value.assignable(1,2047)||checked.value.assignable(1,0))return 18;
    if(!scalars.value.assignable(0,2)||scalars.value.assignable(4,2)||
      scalars.value.assignable(5,6)||!scalars.value.assignable(7,5)||
      !scalars.value.assignable(0,3)||scalars.value.assignable(3,2))return 20;
    if(!scalars.value.assignable(8,10)||!scalars.value.assignable(8,11)||
      scalars.value.assignable(8,2)||!scalars.value.assignable(8,6))return 21;
    if(scalars.value.assignable(12,13)||scalars.value.assignable(13,12))return 22;
    if(!scalars.value.assignable(2,3)||scalars.value.assignable(2,0)||
      scalars.value.assignable(11,10)||!scalars.value.assignable(11,6))return 23;
    const property=scalars.value.property(14,"kind");
    if(!property.ok||property.value!==2)return 25;
  }
  return 42;
}`);
const source = createSourceText(bytes, bytes.length);
assert.ok(source.ok);
const parsed = parseModule(source.value);
assert.ok(parsed.ok, JSON.stringify(parsed));
const modules = [
  ...workspaceModules([
    ...projectRoots(),
    "packages/native-runtime/src/relocation/index.ts",
    "packages/native-runtime/src/allocators/linear/index.ts",
  ]),
];
modules.push({
  id: "fixture",
  module: parsed.value,
  dependencies: new Map([
    ["key-index", "packages/foundation/src/collections/key-index.ts"],
    ["value-types", "packages/typescript/src/types/index.ts"],
    [
      "region-allocator",
      "packages/native-runtime/src/allocators/region/index.ts",
    ],
    ["relocation-plan", "packages/native-runtime/src/relocation/index.ts"],
    [
      "linear-allocator",
      "packages/native-runtime/src/allocators/linear/index.ts",
    ],
    ["native-tracing", "packages/native-runtime/src/tracing/index.ts"],
  ]),
});
const built = buildMacOSProgram({
  ...projectBuildRequest(modules, () => {}),
  debugSymbols: true,
  entry: "fixture",
  start: "run",
  // Two spaces retain the original 4 MiB active allocation budget. The
  // inventory fixture alone holds just over 2 MiB of simultaneous arrays.
  managedBytes: 8388608,
  allocationCapacity: 131072,
  rootCapacity: 4096,
  stackBytes: 1048576,
  identifier: "tint-hosted-collections",
});
assert.ok(built.ok, JSON.stringify(built));
const directory = mkdtempSync(join(tmpdir(), "tint-hosted-collections-")),
  path = join(directory, "collections");
writeFileSync(path, built.value, { mode: 0o755 });
console.log(path);
if (process.env.TINT_BUILD_ONLY !== "1")
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = spawnSync(path, [], { encoding: "utf8", timeout: 60000 });
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null, result.stderr);
      assert.equal(result.status, 42, result.stderr);
    }
    console.log(
      "Verified native indexed lookup, traversal recovery, list mutation, live identity across collection pressure, and dense type graph validation twice.",
    );
  } finally {
    if (process.env.TINT_KEEP_NATIVE !== "1")
      rmSync(directory, { recursive: true, force: true });
  }
