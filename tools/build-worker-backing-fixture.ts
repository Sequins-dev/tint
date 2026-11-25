import type { NativeHostBinding } from "@tint/compiler/native";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The worker backing fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";

const target = nativeFixtureTarget();
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const bindings: readonly NativeHostBinding[] = [
  { module: memory, name: "mapMemory", operation: "memory-map" },
  { module: memory, name: "unmapMemory", operation: "memory-unmap" },
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
  { module: shared, name: "readSharedWord64", operation: "shared-read-word64" },
  {
    module: shared,
    name: "writeSharedWord64",
    operation: "shared-write-word64",
  },
  {
    module: shared,
    name: "compareExchangeSharedWord64",
    operation: "shared-compare-exchange-word64",
  },
];

verifyHostedFixture(
  `
import {nativeSharedMemoryHost} from 'memory';
import {createNativeWorkerBacking} from 'backing';
import {byteStorageData,createByteStorage,resizeByteStorage} from 'bytes';

export function run():number {
  const memory=nativeSharedMemoryHost();
  const first=createNativeWorkerBacking(memory),second=createNativeWorkerBacking(memory);
  const made=createByteStorage(1048576,2097152,true,2097152,first.allocate);
  if(!made.ok)return 1;
  const initial=byteStorageData(made.value,"write");
  if(initial===undefined)return 2;
  initial[0]=42;
  initial[1048575]=23;
  const transfer=first.inspect(made.value);
  if(transfer===undefined)return 3;
  first.move(made.value,transfer);
  if(byteStorageData(made.value)!==undefined)return 4;
  first.close();
  const received=second.adopt(transfer,2097152);
  const adopted=second.inspect(received);
  if(adopted===undefined||adopted.address!==transfer.address)return 5;
  const bytes=byteStorageData(received);
  if(bytes===undefined||bytes[0]!==42||bytes[1048575]!==23)return 6;
  if(resizeByteStorage(received,1048577)!=="none")return 7;
  const grown=second.inspect(received),after=byteStorageData(received);
  if(grown===undefined||grown.length!==1048577||after===undefined||after[1048575]!==23||after[1048576]!==0)return 8;
  second.close();
  return 42;
}
`,
  "worker-backing",
  [
    ["memory", "packages/native-runtime/src/shared-memory-host.ts"],
    ["backing", "packages/native-runtime/src/worker-backing.ts"],
    ["bytes", "packages/js-runtime/src/bytes/index.ts"],
  ],
  [],
  [],
  [
    {
      module: shared,
      namespace: "worker-backing-shared",
      retainedExports: bindings
        .filter((binding) => binding.module === shared)
        .map((binding) => binding.name),
    },
  ],
  {
    managedBytes: 16777216,
    allocationCapacity: 262144,
    stackBytes: 16777216,
    requireTyped: true,
    runtimeEntry:
      target.arch === "x86_64"
        ? "initializeGenerationalRuntime"
        : "initializeGenerationalRuntime",
    hostBindings: bindings,
  },
);
