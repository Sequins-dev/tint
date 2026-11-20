import { nativeFixtureTarget } from "./native-host-target.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The worker exit fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";

const target = nativeFixtureTarget();
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const declaration = "fixture:worker-exit-pipe";
const bindings = [
  [clock, "monotonicMilliseconds", "monotonic-time"],
  [memory, "mapMemory", "memory-map"],
  [memory, "unmapMemory", "memory-unmap"],
  [shared, "readSharedWord64", "shared-read-word64"],
  [shared, "writeSharedWord64", "shared-write-word64"],
  [memory, "startNativeThread", "thread-start"],
  [memory, "hostedThreadEntry", "hosted-thread-entry"],
] as const;

verifyHostedFixture(
  `
import {mapMemory,unmapMemory,startNativeThread,hostedThreadEntry} from 'memory';
import {readSharedWord64,writeSharedWord64} from 'shared';
import {monotonicMilliseconds} from 'clock';
import {read,close} from 'fs';
import {createReactor} from 'reactor';
import {pipe,dup,pthread_detach,fcntl$setFlags} from 'thread';
import {nativeThreadExitReadOffset,nativeThreadExitWriteOffset} from 'abi';

function descriptor(bytes:Uint8Array,offset:number):number {
  return (bytes[offset]??0)+(bytes[offset+1]??0)*256+
    (bytes[offset+2]??0)*65536+(bytes[offset+3]??0)*16777216;
}

export function run(argument:number):number {
  if(argument!==0)return argument%2===1?7:8;
  const mapping=mapMemory(16384);
  if(mapping<=0)return 1;
  const ends=new Uint8Array(8);
  if(pipe(ends)!==0)return 2;
  const input=descriptor(ends,0),output=descriptor(ends,4);
  const readGuard=dup(input),writer=dup(output);
  if(readGuard<0||writer<0||close(output)!==0)return 3;
  if(fcntl$setFlags(writer,4,${target.os === "darwin" ? 4 : 2048})!==0)return 4;
  if(writeSharedWord64(mapping,16384,nativeThreadExitWriteOffset,1,writer,0)!==0||
      writeSharedWord64(mapping,16384,nativeThreadExitReadOffset,1,readGuard,0)!==0)return 5;
  const reactor=createReactor();
  try{
    reactor.watchReadable(input,1);
    const thread=startNativeThread(hostedThreadEntry(),mapping+1);
    if(thread<=0||pthread_detach(thread)!==0)return 6;
    let ready=false;
    const deadline=monotonicMilliseconds()+1000;
    while(!ready){
      const timeout=deadline-monotonicMilliseconds();
      if(timeout<=0)return 7;
      reactor.poll(timeout,(token:number):void=>{if(token===1)ready=true;});
    }
    const bytes=new Uint8Array(1);
    if(read(input,bytes)!==1||bytes[0]!==1)return 9;
    const status=new Uint32Array(2);
    if(readSharedWord64(mapping,16384,0,1,status)!==0||status[0]!==8||status[1]!==0)return 10;
  }finally{reactor.close();close(input);}
  return unmapMemory(mapping,16384)===0?42:11;
}
`,
  "worker-exit-v1",
  [
    ["memory", memory],
    ["shared", shared],
    ["clock", clock],
    ["fs", "packages/native-runtime/src/intrinsics/fs.ts"],
    ["reactor", "packages/platform/src/" + target.os + "/reactor.ts"],
    ["thread", declaration],
    ["abi", "packages/abi/src/host.ts"],
  ],
  [],
  [],
  [memory, shared, clock].map((module, index) => ({
    module,
    namespace: "worker-exit-" + index,
    retainedExports: bindings
      .filter((binding) => binding[0] === module)
      .map((binding) => binding[1]),
  })),
  {
    threaded: true,
    threadExitPipe: true,
    managedBytes: 4194304,
    allocationCapacity: 65536,
    runtimeEntry:
      target.arch === "x86_64"
        ? "initializeGenerationalRuntime"
        : "initializeCopyingRuntime",
    hostBindings: bindings.map(([module, name, operation]) => ({
      module,
      name,
      operation,
    })),
    foreignDeclarations: [
      {
        id: declaration,
        text: `
declare module "tint:c/worker-exit-pipe" {
  import type { Address, i32, u8, Ptr, OrErrno, Variadic } from "tint:ffi";
  export function pipe(descriptors:Ptr<u8>):OrErrno<i32>;
  export function dup(fd:i32):OrErrno<i32>;
  export function pthread_detach(thread:Address<void>):i32;
  export function fcntl$setFlags(fd:i32,command:i32,flags:Variadic<i32>):OrErrno<i32>;
}
`,
        manifest: [
          {
            module: "tint:c/worker-exit-pipe",
            darwin: {
              name: "/usr/lib/libSystem.B.dylib",
              optional: false,
              currentVersion: 0x10000,
              compatibilityVersion: 0x10000,
            },
            linux: {
              name: "libc.so.6",
              optional: false,
              currentVersion: 0,
              compatibilityVersion: 0,
            },
          },
        ],
      },
    ],
  },
);
