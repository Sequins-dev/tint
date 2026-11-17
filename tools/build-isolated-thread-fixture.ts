import { verifyHostedFixture } from "./hosted-fixture.ts";
import { encode } from "@tint/codegen/aarch64/isa";
const codeBytes: number[] = [];
for (const instruction of [
  { op: "movz", width: 64, rd: 9, immediate: 19, shift: 0 },
  { op: "scvtf-d-x", rd: 0, rn: 9 },
  { op: "str-d", rt: 0, rn: 3, offset: 16 },
  { op: "movz", width: 64, rd: 0, immediate: 1, shift: 0 },
  { op: "ret", rn: 30 },
] as const) {
  const word = encode(instruction);
  if (!word.ok) throw Error("fixture encoding");
  for (let i = 0; i < 4; i++)
    codeBytes.push(Math.floor(word.value / 2 ** (i * 8)) % 256);
}
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
  "mapExecutableMemory",
  "writeExecutableMemory",
  "callExecutableNumber",
  "unmapExecutableMemory",
];
verifyHostedFixture(
  `
import {readSharedUnsigned,writeSharedUnsigned,compareExchangeSharedUnsigned} from 'shared';
import {mapMemory,unmapMemory,readMemoryWord,writeMemoryWord,startNativeThread,joinNativeThread,hostedThreadEntry,currentContextDomain,currentRootHead,mapExecutableMemory,writeExecutableMemory,callExecutableNumber,unmapExecutableMemory} from 'memory';
export function run(argument:number):number {
 if(argument===1)throw 19;
 if(argument!==0){
  if(writeMemoryWord(argument,128,0,currentContextDomain())!==0)return 11;
  if(writeMemoryWord(argument,128,8,currentRootHead())!==0)return 12;
  const code=mapExecutableMemory(16384);
  const published=code>0?writeExecutableMemory(code,16384,0,new Uint8Array([${codeBytes.join(",")}])):-1;
  if(writeMemoryWord(argument,128,32,code>0?code:0)!==0)return 17;
  const barrier=readMemoryWord(argument,128,24);
  while(true){
   const observed=readSharedUnsigned(barrier,8,0,4,1);
   if(compareExchangeSharedUnsigned(barrier,8,0,4,observed,observed+1)===observed)break;
  }
  while(readSharedUnsigned(barrier,8,4,4,1)!==1){}
  if(code<=0||published!==0)return 15;
  if(callExecutableNumber(code)!==19)return 16;
  const retained=new Float64Array(16);retained[0]=19;
  for(let i=0;i<1000;i++){
   const data=new Float64Array(512);data[0]=i;
   if(data[0]!==i||retained[0]!==19)return 13;
  }
  if(callExecutableNumber(code)!==19||unmapExecutableMemory(code,16384)!==0)return 18;
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
  const code=readMemoryWord(mailbox,16384,i*128+32);
  if(code<=0)return 12;
  for(let j=0;j<i;j++){if(code===readMemoryWord(mailbox,16384,j*128+32))return 13;}
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
    allowJit: true,
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
            "executable-map",
            "executable-write",
            "executable-call-number",
            "executable-unmap",
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
