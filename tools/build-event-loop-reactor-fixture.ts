import { nativeFixtureTarget } from "./native-host-target.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("The reactor fixture must run under LLDB");
process.env.TINT_GENERAL_FALLBACK = "0";

const target = nativeFixtureTarget();
const darwin = target.os === "darwin";
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const pipeDeclaration = "fixture:reactor-pipe";
const reactor = darwin
  ? "packages/platform/src/darwin/reactor.ts"
  : "packages/platform/src/linux/reactor.ts";

const bindings = [
  [clock, "monotonicMilliseconds", "monotonic-time"],
  [memory, "startNativeThread", "thread-start"],
  [memory, "joinNativeThread", "thread-join"],
  [memory, "hostedThreadEntry", "hosted-thread-entry"],
] as const;

verifyHostedFixture(
  `
import {createReactor,signalReactor} from 'reactor';
import {createReactorEventLoop} from 'loop';
import type {EventLoopHandle} from 'loop-core';
import {monotonicMilliseconds} from 'clock';
import {startNativeThread,joinNativeThread,hostedThreadEntry} from 'memory';
import {read,write,close} from 'fs';
import {pipe,fcntl$setFlags} from 'pipe';

function descriptor(bytes:Uint8Array,offset:number):number {
  return (bytes[offset]??0)+(bytes[offset+1]??0)*256+
    (bytes[offset+2]??0)*65536+(bytes[offset+3]??0)*16777216;
}

export function run(argument:number):number {
  if(argument!==0){signalReactor(argument-1);return 0;}
  const reactor=createReactor();
  try {
    let wakes=0;
    signalReactor(reactor.control);
    reactor.poll(1000,(token:number):void=>{if(token===0)wakes++;});
    if(wakes!==1)return 1;

    const thread=startNativeThread(hostedThreadEntry(),reactor.control+1);
    if(thread<=0)return 2;
    reactor.poll(1000,(token:number):void=>{if(token===0)wakes++;});
    if(joinNativeThread(thread)!==0||wakes!==2)return 3;
    reactor.poll(0,(token:number):void=>{if(token===0)wakes++;});
    if(wakes!==2)return 4;

    const pair=new Uint8Array(8);
    if(pipe(pair)!==0)return 5;
    const input=descriptor(pair,0),output=descriptor(pair,4);
    try {
      if(fcntl$setFlags(input,4,${darwin ? 4 : 2048})!==0)return 6;
      const data=new Uint8Array(1);
      if(read(input,data)!==${darwin ? -35 : -11})return 7;
      let trace="";
      const runtime=createReactorEventLoop({
        createReactor:()=>reactor,
        now:():number=>monotonicMilliseconds(),
        onWake:():void=>{},
        drainMicrotasks:():void=>{}
      });
      try {
        const loop=runtime.loop;
        const watch:EventLoopHandle=runtime.watchReadable(input,():void=>{
          if(read(input,data)!==1||data[0]!==42)trace+="!";
          trace+="I";
          watch.close();
          loop.setTimeout(():void=>{trace+="T";},0);
          loop.setImmediate(():void=>{trace+="C";});
        });
        const deadline=loop.setTimeout(():void=>{throw "read did not become ready";},1000);
        deadline.unref();
        data[0]=42;
        if(write(output,data)!==1)return 8;
        data[0]=0;
        loop.run("callback");
        return trace==="ICT"?42:9;
      }finally{runtime.close();}
    } finally {
      close(input);close(output);
    }
  } finally {
    reactor.close();
  }
}
`,
  "event-loop-reactor-v2",
  [
    ["reactor", reactor],
    ["loop", "packages/native-runtime/src/event-loop-reactor.ts"],
    ["loop-core", "packages/native-runtime/src/event-loop.ts"],
    ["memory", memory],
    ["clock", clock],
    ["fs", "packages/native-runtime/src/intrinsics/fs.ts"],
    ["pipe", pipeDeclaration],
  ],
  [],
  [],
  [memory, clock].map((module, index) => ({
    module,
    namespace: "event-loop-reactor-" + index,
    retainedExports: bindings
      .filter((binding) => binding[0] === module)
      .map((binding) => binding[1]),
  })),
  {
    threaded: true,
    managedBytes: 4194304,
    allocationCapacity: 65536,
    runtimeEntry:
      target.arch === "x86_64"
        ? "initializeGenerationalRuntime"
        : "initializeGenerationalRuntime",
    hostBindings: bindings.map(([module, name, operation]) => ({
      module,
      name,
      operation,
    })),
    foreignDeclarations: [
      {
        id: pipeDeclaration,
        text: `
declare module "tint:c/event-loop-pipe" {
  import type { i32, u8, Ptr, OrErrno, Variadic } from "tint:ffi";
  export function pipe(descriptors:Ptr<u8>):OrErrno<i32>;
  export function fcntl$setFlags(fd:i32,command:i32,flags:Variadic<i32>):OrErrno<i32>;
}
`,
        manifest: [
          {
            module: "tint:c/event-loop-pipe",
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
