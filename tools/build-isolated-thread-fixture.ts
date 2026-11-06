import { verifyHostedFixture } from "./hosted-fixture.ts";
if (process.env.TINT_BUILD_ONLY !== "1") throw Error("build-only fixture");
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const names = [
  "mapMemory",
  "unmapMemory",
  "readMemoryWord",
  "writeMemoryWord",
  "startNativeThread",
  "joinNativeThread",
  "hostedThreadEntry",
  "currentContextDomain",
  "currentRootHead",
];
verifyHostedFixture(
  `
import {readSharedUnsigned,writeSharedUnsigned,compareExchangeSharedUnsigned} from 'shared';
import {mapMemory,unmapMemory,readMemoryWord,writeMemoryWord,startNativeThread,joinNativeThread,hostedThreadEntry,currentContextDomain,currentRootHead} from 'memory';
export function run(argument:number):number {
 if(argument===1)throw 19;
 if(argument!==0){
  if(writeMemoryWord(argument,128,0,currentContextDomain())!==0)return 11;
  if(writeMemoryWord(argument,128,8,currentRootHead())!==0)return 12;
  const barrier=readMemoryWord(argument,128,24);
  while(true){
   const observed=readSharedUnsigned(barrier,8,0,4,1);
   if(compareExchangeSharedUnsigned(barrier,8,0,4,observed,observed+1)===observed)break;
  }
  while(readSharedUnsigned(barrier,8,4,4,1)!==1){}
  const retained=new Float64Array(16);retained[0]=19;
  for(let i=0;i<1000;i++){
   const data=new Float64Array(512);data[0]=i;
   if(data[0]!==i||retained[0]!==19)return 13;
  }
  if(writeMemoryWord(argument,128,16,42)!==0)return 14;
  return 7;
 }
 const failed=startNativeThread(hostedThreadEntry(),1);
 if(failed<=0||joinNativeThread(failed)!==70)return 9;
 const mailbox=mapMemory(16384);
 if(mailbox<=0)return 1;
 const handles=new Float64Array(8),domains=new Float64Array(8),roots=new Float64Array(8);
 for(let i=0;i<8;i++){
  if(writeMemoryWord(mailbox,16384,i*128+24,mailbox+8192)!==0)return 10;
  const handle=startNativeThread(hostedThreadEntry(),mailbox+i*128);
  if(handle<=0)return 2;handles[i]=handle;
 }
 while(readSharedUnsigned(mailbox+8192,8,0,4,1)!==8){}
 if(writeSharedUnsigned(mailbox+8192,8,4,4,1,1)!==0)return 11;
 for(let i=0;i<8;i++){
  if(joinNativeThread(handles[i]??0)!==7)return 3;
  const domain=readMemoryWord(mailbox,16384,i*128);
  const root=readMemoryWord(mailbox,16384,i*128+8);
  if(domain<=0||domain===currentContextDomain()||root<=0||root===currentRootHead())return 4;
  for(let j=0;j<i;j++){if(domain===domains[j]||root===roots[j])return 5;}
  domains[i]=domain;roots[i]=root;
  if(readMemoryWord(mailbox,16384,i*128+16)!==42)return 6;
 }
 if(unmapMemory(mailbox,16384)!==0)return 8;
 return 42;
}`,
  "isolated-threads-v1",
  [
    ["memory", memory],
    ["shared", shared],
  ],
  [],
  [],
  [
    {
      module: memory,
      namespace: "thread-fixture-memory",
      retainedExports: names,
    },
    {
      module: shared,
      namespace: "thread-fixture-shared",
      retainedExports: [
        "readSharedUnsigned",
        "writeSharedUnsigned",
        "compareExchangeSharedUnsigned",
      ],
    },
  ],
  {
    threaded: true,
    managedBytes: 1048576,
    allocationCapacity: 65536,
    runtimeEntry: "initializeCopyingRuntime",
    hostBindings: [
      ...names.map((name, index) => ({
        module: memory,
        name,
        operation: (
          [
            "memory-map",
            "memory-unmap",
            "memory-read-word",
            "memory-write-word",
            "thread-start",
            "thread-join",
            "hosted-thread-entry",
            "context-domain",
            "root-head",
          ] as const
        )[index]!,
      })),
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
      {
        module: shared,
        name: "compareExchangeSharedUnsigned",
        operation: "shared-compare-exchange-unsigned",
      },
    ],
  },
);
