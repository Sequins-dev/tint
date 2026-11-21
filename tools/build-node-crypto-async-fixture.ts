import { nativeFixtureTarget } from "./native-host-target.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const target = nativeFixtureTarget();
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts";
const clock = "packages/native-runtime/src/intrinsics/clock.ts";
const bindings = [
  [clock, "monotonicMilliseconds", "monotonic-time"],
  [memory, "mapMemory", "memory-map"],
  [memory, "unmapMemory", "memory-unmap"],
  [memory, "startNativeThread", "thread-start"],
  [memory, "joinNativeThread", "thread-join"],
  [memory, "hostedThreadEntry", "hosted-thread-entry"],
  [memory, "parkNativeWord", "word-park"],
  [memory, "wakeNativeWord", "word-wake"],
  [shared, "readSharedUnsigned", "shared-read-unsigned"],
  [shared, "writeSharedUnsigned", "shared-write-unsigned"],
  [shared, "readSharedWord64", "shared-read-word64"],
  [shared, "writeSharedWord64", "shared-write-word64"],
  [shared, "compareExchangeSharedWord64", "shared-compare-exchange-word64"],
] as const;

export function verifyCryptoAsyncFixture(): string {
  return verifyHostedFixture(
    `
import {createNativeBlockingPool,runNativeBlockingHelper} from 'pool';
import {createReactorEventLoop,type ReactorEventLoop} from 'loop';
import {createReactor,signalReactor} from 'reactor';
import {nativeSharedMemoryHost,nativeWaiterParkingHost} from 'blocks';
import {startNativeThread,joinNativeThread,hostedThreadEntry} from 'memory';
import {monotonicMilliseconds} from 'clock';
import {pbkdf2} from 'node:crypto';
import {initializeCryptoJobs,performCryptoJob,type CryptoJobs} from 'crypto-jobs';

export function run(argument:number):number {
  const host=nativeSharedMemoryHost(),parking=nativeWaiterParkingHost();
  if(argument!==0)return runNativeBlockingHelper(host,parking,argument,performCryptoJob,signalReactor);

  let deliver:()=>void=():void=>{};
  const runtime:ReactorEventLoop=createReactorEventLoop({
    createReactor:()=>createReactor(),
    now:()=>monotonicMilliseconds(),
    drainMicrotasks:():void=>{},
    onWake:():void=>deliver()
  });
  let jobs:CryptoJobs|undefined=undefined;
  try{
    const created=createNativeBlockingPool(host,parking,{
      wakeTarget:()=>runtime.wakeTarget(),
      entry:hostedThreadEntry(),
      start:(entry:number,argument:number):number=>startNativeThread(entry,argument),
      join:(thread:number):number=>joinNativeThread(thread),
    },2,2);
    const session=initializeCryptoJobs(runtime.loop,created);
    jobs=session;
    deliver=():void=>session.receive();
    let submitted=false,completed=false,valid=false;
    pbkdf2("password","salt",2,20,"sha1",(error:unknown,bytes:Uint8Array|undefined):void=>{
      completed=true;
      if(!submitted||error!==null||bytes===undefined||bytes.length!==20)return;
      valid=bytes[0]===234&&bytes[1]===108&&bytes[19]===87;
    });
    if(completed)return 1;
    submitted=true;
    const deadline=runtime.loop.setTimeout(():void=>{throw "crypto helper did not complete";},1000);
    deadline.unref();
    runtime.loop.run("callback");
    return completed&&valid?42:2;
  }finally{
    jobs?.close();
    runtime.close();
  }
}
`,
    "node-crypto-pbkdf2-v1",
    [
      ["pool", "packages/native-runtime/src/blocking-pool.ts"],
      ["loop", "packages/native-runtime/src/event-loop-reactor.ts"],
      ["reactor", "packages/platform/src/" + target.os + "/reactor.ts"],
      ["blocks", "packages/native-runtime/src/shared-blocks.ts"],
      ["clock", clock],
      ["memory", memory],
      ["node:crypto", "packages/native-runtime/src/node/crypto.ts"],
      ["crypto-jobs", "packages/native-runtime/src/node/crypto-jobs.ts"],
    ],
    [],
    [],
    [shared, clock].map((module, index) => ({
      module,
      namespace: "blocking-pool-" + index,
      retainedExports: bindings
        .filter((binding) => binding[0] === module)
        .map((binding) => binding[1]),
    })),
    {
      threaded: true,
      requireTyped: true,
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
    },
  );
}

export function verifyCryptoPublicFixture(): string {
  return verifyHostedFixture(
    `
import { createHash, pbkdf2 } from "node:crypto";
import { Buffer as BufferExport } from "node:buffer";

export async function run() {
  const esm = await import("node:crypto");
  const crypto = require("node:crypto");
  if (esm.default !== crypto || esm.createHash !== createHash ||
      crypto.createHash !== createHash || require("crypto") !== crypto) return 1;
  const buffer = await import("node:buffer");
  if (BufferExport !== Buffer || buffer.Buffer !== Buffer ||
      require("node:buffer").Buffer !== Buffer) return 2;
  const bytes = crypto.randomBytes(16);
  if (!(bytes instanceof Buffer) || !Buffer.isBuffer(bytes) || bytes.constructor !== Buffer) return 3;
  const hash = createHash("sha256");
  for (const operation of [
    () => hash.copy(),
    () => hash.pipe({}),
    () => createHash("shake256", {outputLength:16}),
    () => crypto.KeyObject,
    () => crypto.pbkdf2Sync(),
    () => esm.pbkdf2Sync(),
    () => crypto.randomFillSync(bytes),
    () => crypto.randomBytes(1, () => {}),
  ]) {
    try { operation(); return 4; }
    catch (error) {
      if (error.code !== "ERR_CRYPTO_UNSUPPORTED_OPERATION" ||
          !error.message.includes("outside")) return 5;
    }
  }
  let returned = false;
  const completed = new Promise((resolve) => {
    pbkdf2("password", "salt", 2, 20, "sha1", (error, key) => {
      resolve(returned && error === null && key instanceof Buffer &&
        key.constructor === Buffer && key.toString("hex") ===
        "ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957");
    });
  });
  returned = true;
  return await completed ? 42 : 6;
}
`,
    "node-crypto-public",
    [],
    [],
    [],
    [],
    {
      nodeCrypto: "commonjs",
      managedBytes: 33554432,
      allocationCapacity: 524288,
    },
  );
}

if (import.meta.main) {
  process.env.TINT_BUILD_ONLY = "1";
  verifyCryptoAsyncFixture();
}
