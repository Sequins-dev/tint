import { verifyHostedFixture } from "./hosted-fixture.ts";
import type { NativeHostBinding } from "@tint/compiler/native";
if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("shared block fixture requires TINT_BUILD_ONLY=1");

const memory = "packages/native-runtime/src/intrinsics/memory.ts",
  primitives = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const hostBindings: readonly NativeHostBinding[] = [
  {
    module: primitives,
    name: "compareExchangeSharedUnsigned",
    operation: "shared-compare-exchange-unsigned",
  },
  { module: memory, name: "mapMemory", operation: "memory-map" },
  { module: memory, name: "unmapMemory", operation: "memory-unmap" },
  {
    module: primitives,
    name: "readSharedUnsigned",
    operation: "shared-read-unsigned",
  },
  {
    module: primitives,
    name: "writeSharedUnsigned",
    operation: "shared-write-unsigned",
  },
  {
    module: primitives,
    name: "readSharedWord64",
    operation: "shared-read-word64",
  },
  {
    module: primitives,
    name: "writeSharedWord64",
    operation: "shared-write-word64",
  },
  {
    module: primitives,
    name: "compareExchangeSharedWord64",
    operation: "shared-compare-exchange-word64",
  },
];
verifyHostedFixture(
  `
import { createNativeSharedBlockService, attachNativeSharedBlockService, nativeSharedMemoryHost, nativeSharedAtomicMemoryHost } from 'service';
import { createSharedStorage, attachSharedStorage, sameSharedBlock } from 'storage';
export function run(): number {
 const created=createNativeSharedBlockService(nativeSharedMemoryHost(),{pageSize:16384,maxBlocks:4,maxReservedBytes:65536});
 if(!created.ok)return 1;
 const service=created.value;
 const block=createSharedStorage(service,8,64,true);if(!block.ok)return 2;
 const facade=attachNativeSharedBlockService(nativeSharedMemoryHost(),service.registry);if(!facade.ok)return 3;
 const alias=attachSharedStorage(facade.value,block.value.handle);if(!alias.ok||!sameSharedBlock(block.value,alias.value))return 4;
 if(service.writeWord64(block.value.handle,0,'seq-cst',4294967295,4294967295)!=='none')return 5;
 const scratch=new Uint32Array(2);
 if(facade.value.readWord64(block.value.handle,0,'unordered',scratch)!=='none'||scratch[0]!==4294967295||scratch[1]!==4294967295)return 6;
 if(facade.value.grow(block.value.handle,32)!=='none'||service.grow(block.value.handle,32)!=='none')return 7;
 if(service.grow(block.value.handle,31)!=='invalid-length'||service.grow(block.value.handle,65)!=='invalid-length')return 8;
 for(let i=8;i<32;i++){const byte=service.readUnsigned(block.value.handle,i,1,'unordered');if(!byte.ok||byte.value!==0)return 9;}
 const fixed=service.create(16,16,false);if(!fixed.ok||service.grow(fixed.value.handle,16)!=='fixed-length')return 10;
 const empty=service.create(0,0,false);if(!empty.ok||empty.value.blockId===fixed.value.blockId)return 11;
 const over=service.create(0,16385,true);if(over.ok||over.error!=='allocation-limit')return 12;
 const last=facade.value.create(0,0,false);if(!last.ok)return 13;
 const exhausted=service.create(0,0,false);if(exhausted.ok||exhausted.error!=='allocation-limit')return 14;
 const invalid=service.describe(999);if(invalid.ok||invalid.error!=='invalid-handle')return 15;
 const unaligned=service.readUnsigned(block.value.handle,1,4,'unordered');if(unaligned.ok||unaligned.error!=='unaligned')return 16;
 const outside=service.readUnsigned(block.value.handle,32,1,'unordered');if(outside.ok||outside.error!=='invalid-range')return 17;
 for(let round=0;round<8;round++){
  for(let i=0;i<32;i++){const garbage=new Uint32Array(128);garbage[0]=i;if(garbage[0]!==i)return 18;}
  if(!sameSharedBlock(block.value,alias.value))return 19;
  if(facade.value.readWord64(alias.value.handle,0,'seq-cst',scratch)!=='none'||scratch[0]!==4294967295||scratch[1]!==4294967295)return 20;
  const length=service.length(block.value.handle,'seq-cst');if(!length.ok||length.value!==32)return 21;
 }

 if(service.atomics!==undefined||facade.value.atomics!==undefined)return 24;
 const enabled=attachNativeSharedBlockService(nativeSharedMemoryHost(),service.registry,nativeSharedAtomicMemoryHost());if(!enabled.ok)return 25;
 const atomics=enabled.value.atomics;if(atomics===undefined)return 26;
 {
  if(service.writeUnsigned(block.value.handle,16,1,255,'seq-cst')!=='none')return 27;
  const success=atomics.compareExchangeUnsigned(block.value.handle,16,1,255,1);if(!success.ok||success.value!==255)return 28;
  const mismatch=atomics.compareExchangeUnsigned(block.value.handle,16,1,255,0);if(!mismatch.ok||mismatch.value!==1)return 29;
  const equal=atomics.compareExchangeUnsigned(block.value.handle,16,1,1,1);if(!equal.ok||equal.value!==1)return 30;
  const overflow=atomics.compareExchangeUnsigned(block.value.handle,16,1,255+1,0);if(overflow.ok||overflow.error!=='invalid-value')return 31;
 }
 {
  if(service.writeUnsigned(block.value.handle,16,2,65535,'seq-cst')!=='none')return 27;
  const success=atomics.compareExchangeUnsigned(block.value.handle,16,2,65535,1);if(!success.ok||success.value!==65535)return 28;
  const mismatch=atomics.compareExchangeUnsigned(block.value.handle,16,2,65535,0);if(!mismatch.ok||mismatch.value!==1)return 29;
  const equal=atomics.compareExchangeUnsigned(block.value.handle,16,2,1,1);if(!equal.ok||equal.value!==1)return 30;
  const overflow=atomics.compareExchangeUnsigned(block.value.handle,16,2,65535+1,0);if(overflow.ok||overflow.error!=='invalid-value')return 31;
 }
 {
  if(service.writeUnsigned(block.value.handle,16,4,4294967295,'seq-cst')!=='none')return 27;
  const success=atomics.compareExchangeUnsigned(block.value.handle,16,4,4294967295,1);if(!success.ok||success.value!==4294967295)return 28;
  const mismatch=atomics.compareExchangeUnsigned(block.value.handle,16,4,4294967295,0);if(!mismatch.ok||mismatch.value!==1)return 29;
  const equal=atomics.compareExchangeUnsigned(block.value.handle,16,4,1,1);if(!equal.ok||equal.value!==1)return 30;
  const overflow=atomics.compareExchangeUnsigned(block.value.handle,16,4,4294967295+1,0);if(overflow.ok||overflow.error!=='invalid-value')return 31;
 }

 if(atomics.compareExchangeWord64(block.value.handle,0,4294967295,4294967295,1,2147483648,scratch)!=='none'||scratch[0]!==4294967295||scratch[1]!==4294967295)return 32;
 if(atomics.compareExchangeWord64(block.value.handle,0,0,0,0,0,scratch)!=='none'||scratch[0]!==1||scratch[1]!==2147483648)return 33;
 if(atomics.compareExchangeWord64(block.value.handle,0,1,2147483648,1,2147483648,scratch)!=='none'||scratch[0]!==1||scratch[1]!==2147483648)return 34;
 if(atomics.compareExchangeWord64(block.value.handle,0,-1,0,0,0,scratch)!=='invalid-value'||scratch[0]!==1||scratch[1]!==2147483648)return 35;
 const bad=atomics.compareExchangeUnsigned(999,0,1,0,1);if(bad.ok||bad.error!=='invalid-handle')return 36;
 const outsideAtomic=atomics.compareExchangeUnsigned(block.value.handle,32,1,0,1);if(outsideAtomic.ok||outsideAtomic.error!=='invalid-range')return 37;
 if(atomics.compareExchangeWord64(block.value.handle,1,0,0,0,0,scratch)!=='unaligned')return 38;
 const emptyAtomic=atomics.compareExchangeUnsigned(empty.value.handle,0,1,0,0);if(emptyAtomic.ok||emptyAtomic.error!=='invalid-range')return 44;
 const short=new Uint32Array(1);short[0]=99;
 if(atomics.compareExchangeWord64(block.value.handle,0,0,0,0,0,short)!=='invalid-value'||short[0]!==99)return 39;
 for(let round=0;round<8;round++){
  for(let i=0;i<64;i++){const garbage=new Uint32Array(128);garbage[0]=i;if(garbage[0]!==i)return 40;}
  if(atomics.compareExchangeWord64(block.value.handle,0,1,2147483648,1,2147483648,scratch)!=='none'||scratch[0]!==1||scratch[1]!==2147483648)return 41;
 }
 const other=createNativeSharedBlockService(nativeSharedMemoryHost(),{pageSize:16384,maxBlocks:1,maxReservedBytes:16384},nativeSharedAtomicMemoryHost());if(!other.ok)return 22;
 const different=createSharedStorage(other.value,8,8,false);if(!different.ok||sameSharedBlock(block.value,different.value))return 23;
 const otherAtomics=other.value.atomics;if(otherAtomics===undefined)return 43;
 const initialSwap=otherAtomics.compareExchangeUnsigned(different.value.handle,0,4,0,1);if(!initialSwap.ok||initialSwap.value!==0)return 45;
 return 42;
}
`,
  "shared-atomic-backing-v1",
  [
    ["service", "packages/native-runtime/src/shared-blocks.ts"],
    ["storage", "packages/js-runtime/src/bytes/shared.ts"],
  ],
  [],
  [],
  [
    {
      module: memory,
      namespace: "native-memory",
      retainedExports: ["mapMemory", "unmapMemory"],
    },
    {
      module: primitives,
      namespace: "shared-primitives-fixture",
      retainedExports: [
        "readSharedUnsigned",
        "writeSharedUnsigned",
        "readSharedWord64",
        "writeSharedWord64",
        "compareExchangeSharedWord64",
        "compareExchangeSharedUnsigned",
      ],
    },
  ],
  {
    managedBytes: 4194304,
    allocationCapacity: 65536,
    rootCapacity: 4096,
    runtimeEntry: "initializeCopyingRuntime",
    hostBindings,
  },
);
