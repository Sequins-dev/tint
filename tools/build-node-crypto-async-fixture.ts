import { createHash as referenceHash, createHmac } from "node:crypto";
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
  const sha256 = (bytes: Uint8Array): string =>
    referenceHash("sha256").update(bytes).digest("hex");
  // Node reference digests for the byte-window and name checks below.
  const abc = sha256(Buffer.from("abc"));
  const wide = sha256(new Uint8Array(new Uint16Array([0x6261, 0x63]).buffer));
  const window = sha256(Buffer.from("bcd"));
  const dss1 = createHmac("sha1", "key").update("abc").digest("hex");
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
  const borrowed = createHash("sha256");
  const hmac = crypto.createHmac("sha256", "key");
  if (Object.hasOwn(hash, "update") || hash.update !== borrowed.update ||
      hash.digest !== borrowed.digest || hash.update !== hmac.update) return 7;
  if (hash.update.call(borrowed, "abc") !== borrowed ||
      hash.digest.call(borrowed, "hex") !==
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") return 8;
  const empty = hmac.digest.call(borrowed);
  if (!(empty instanceof Buffer) || empty.length !== 0 ||
      hmac.digest.call(borrowed, "hex") !== "") return 9;
  try { hash.digest.call(undefined); return 10; }
  catch (error) {
    if (!(error instanceof TypeError) || error.message !==
        "Cannot read properties of undefined (reading 'Symbol(kState)')") return 11;
  }
  for (const hmac of [false, true]) {
    try {
      if (hmac) crypto.createHmac("md4", "key");
      else crypto.createHash("md4");
      return 12;
    } catch (error) {
      if (!(error instanceof Error) || error.code !== "ERR_OSSL_EVP_UNSUPPORTED" ||
          error.message !== "error:0308010C:digital envelope routines::unsupported" ||
          error.library !== "digital envelope routines" || error.reason !== "unsupported") return 13;
      if (hmac ? error.opensslErrorStack !== undefined :
          error.opensslErrorStack?.[0] !== "error:03000086:digital envelope routines::initialization error") return 14;
    }
  }
  for (const operation of [
    () => hash.copy(),
    () => hash.pipe({}),
    () => createHash("shake256", {outputLength:16}),
    () => createHash("2.16.840.1.101.3.4.2.12"),
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
  // Typed-array windows: offset subviews, wider elements and DataView.
  const backing = new Uint8Array([0, 97, 98, 99, 100, 0]);
  if (createHash("sha256").update(backing.subarray(1, 4)).digest("hex") !==
      "${abc}") return 15;
  if (createHash("SHA256").update(new Uint16Array([0x6261, 0x63])).digest("hex") !==
      "${wide}") return 16;
  if (createHash("sha256").update(new DataView(backing.buffer, 2, 3)).digest("hex") !==
      "${window}") return 17;
  // Finished hashes reject both operations; HMAC digests stay empty.
  const finished = createHash("sha256");
  finished.digest();
  for (const operation of [() => finished.update("x"), () => finished.digest()]) {
    try { operation(); return 18; }
    catch (error) {
      if (error.code !== "ERR_CRYPTO_HASH_FINALIZED" ||
          error.message !== "Digest already called") return 19;
    }
  }
  if (crypto.createHmac("DSS1", "key").update("abc").digest("hex") !== "${dss1}")
    return 20;
  // Abandoned contexts are reclaimed with their objects across collections.
  for (let i = 0; i < 20000; i++) createHash(i % 2 === 0 ? "sha256" : "sha512").update("x");
  if (createHash("sha256").update("abc").digest("hex") !== "${abc}") return 21;
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
