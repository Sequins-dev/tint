import { verifyHostedFixture } from "./hosted-fixture.ts";
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
verifyHostedFixture(
  `import {mapMemory,registerExternalMemory,configureExternalMemory,writeMemoryWord,readMemoryWord} from "memory";
export function run():number {
 const size=4096,address=mapMemory(size);
 if(address<=0)return 1;
 if(registerExternalMemory(address,size)!==0||registerExternalMemory(address,size)!==0)return 2;
 if(registerExternalMemory(address+8,16)!==-1||registerExternalMemory(0,size)!==-1)return 3;
 if(configureExternalMemory((base:number,length:number):boolean=>true)!==-1)return 4;
 if(writeMemoryWord(address,size,0,42)!==0||readMemoryWord(address,size,0)!==42)return 5;
 const live:{value:number}[]=[];
 for(let i=0;i<200000;i++){live.push({value:i});if(live.length>64)live.shift();}
 if(live[live.length-1]?.value!==199999||readMemoryWord(address,size,0)!==42)return 6;
 return 42;
}`,
  "external-registration",
  [["memory", memory]],
  [],
  [],
  [{ module: memory, namespace: "native-memory" }],
  {
    runtimeEntry: "initializeRuntime",
    managedBytes: 4194304,
    allocationCapacity: 65536,
    hostBindings: [
      { module: memory, name: "mapMemory", operation: "memory-map" },
      {
        module: memory,
        name: "registerExternalMemory",
        operation: "external-memory-register",
      },
      {
        module: memory,
        name: "configureExternalMemory",
        operation: "external-memory-configure",
      },
      {
        module: memory,
        name: "writeMemoryWord",
        operation: "memory-write-word",
      },
      { module: memory, name: "readMemoryWord", operation: "memory-read-word" },
    ],
  },
);
