import { verifyHostedFixture } from "./hosted-fixture.ts";

// The graph lives in an independent mapping, so its collector callbacks never
// allocate managed objects. The fixture's own runtime still uses copying GC.
const memoryModule = "packages/native-runtime/src/intrinsics/memory.ts";
verifyHostedFixture(
  `import {mapMemory,unmapMemory,readMemoryWord,writeMemoryWord,moveMemory} from "memory";
import {createNurseryEvacuator} from "tracing";
import {nativeWeakSlotMarker,nativeWeakSlotWeak,nativeWeakSlotEphemeron} from "weak-layout";
export function run():number {
 const base=mapMemory(16384);if(base<=0)return 1;
 const starts=new Uint32Array(2),forwarding=new Uint32Array(64),summary=new Uint32Array(3);
 let used=0,published=0;
 function put(offset:number,value:number):void{if(writeMemoryWord(base,16384,offset,value)!==0)throw "write";}
 function get(offset:number):number{return readMemoryWord(base,16384,offset);}
 function allocate(size:number):number{
  const offset=used;used+=size;if(used>1024)throw "space";
  const unit=offset/16;starts[unit>>>5]=(starts[unit>>>5]??0)|(1<<(unit&31));return offset;
 }
 function object(reference:number):number{const offset=allocate(32);put(offset,base+4096);put(offset+16,reference);return base+offset;}
 function cell(key:number,value:number,flags:number):number{
  const offset=allocate(48);put(offset,nativeWeakSlotMarker);put(offset+8,flags);
  put(offset+16,5);put(offset+24,key);put(offset+32,value===0?0:5);put(offset+40,value);return base+offset;
 }
 put(4096,32);put(4104,1);put(4112,16);put(4120,0);put(8200,base+4160);
 const collector=createNurseryEvacuator({base,byteLength:1024,targetBase:base+2048,targetLength:1024,
 starts,forwarding,sources:new Uint32Array(64),sizes:new Uint32Array(64),destinations:new Uint32Array(64),
 slots:new Float64Array(128),values:new Float64Array(128),summary,
 read:(address:number):number|undefined=>{const value=readMemoryWord(base,16384,address-base);return value<0?undefined:value;},
 isExternal:(address:number):boolean=>address>=base+4096&&address<base+16384,
 scanRemembered:(visit:(address:number,slot:number)=>boolean):boolean=>true,
 canWrite:(slot:number):boolean=>(slot>=base+2048&&slot<base+3072)||(slot>=base+8208&&slot<base+8240),
 copy:(destination:number,source:number,size:number):boolean=>moveMemory(base,16384,destination-base,source-base,size)===0,
 write:(slot:number,value:number):boolean=>writeMemoryWord(base,16384,slot-base,value)===0,
 publish:(count:number,bytes:number):boolean=>{published++;return count>0&&bytes>0;}});
 if(collector===undefined)return 2;
 for(let scenario=0;scenario<5;scenario++){
  for(let offset=0;offset<3072;offset+=8)put(offset,0);
  starts[0]=0;starts[1]=0;used=0;
  const key1=object(0),key2=object(0),value=object(scenario===3?key1:0);
  const first=cell(key1,scenario===2?key2:value,scenario===0?nativeWeakSlotWeak:nativeWeakSlotEphemeron);
  const second=cell(key2,value,nativeWeakSlotEphemeron);
  const rootCount=scenario===2?3:scenario===1?2:1;
  put(4160,rootCount);put(4168,16);put(4176,rootCount===1?0:24);put(4184,rootCount===3?32:0);put(4192,0);
  put(8208,scenario===2?second:first);put(8216,scenario===2?first:key1);put(8224,key1);
  if(scenario===4){put(first-base+24,base+12288);}
  const oldRoot=get(8208);
  if(!collector.prepare(used,base+8192))return 3+scenario*4;
  if(get(8208)!==oldRoot||get(2048)!==0)return 4+scenario*4;
  if(!collector.commit())return 5+scenario*4;
  const result=get(8208)-base;
  if(scenario===0||scenario===3){
   if(summary[0]!==1||get(result+16)!==0||get(result+24)!==0||get(result+32)!==0||get(result+40)!==0)return 6+scenario*4;
  }else if(scenario===1){
   if(summary[0]!==3||get(result+24)!==get(8216)||get(result+40)<base+2048||get(result+40)>=base+3072)return 10;
  }else if(scenario===2){
   const other=get(8216)-base;
   if(summary[0]!==5||get(other+24)!==get(8224)||get(other+40)!==get(result+24)||get(result+40)<base+2048)return 14;
  }else if(summary[0]!==2||get(result+24)!==base+12288||get(result+40)<base+2048)return 22;
 }
 if(published!==5)return 30;
 return unmapMemory(base,16384)===0?42:31;
}`,
  "weak-collector",
  [
    ["memory", memoryModule],
    ["tracing", "packages/native-runtime/src/tracing/index.ts"],
    ["weak-layout", "packages/abi/src/weak-slot.ts"],
  ],
  [],
  [],
  [{ module: memoryModule, namespace: "native-memory" }],
  {
    runtimeEntry: "initializeRuntime",
    managedBytes: 4194304,
    allocationCapacity: 65536,
    hostBindings: [
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
  },
);
