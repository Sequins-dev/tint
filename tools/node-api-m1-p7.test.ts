import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { osModule } from "./native-os-fixtures.ts";
import {
  workerFixtureOptions,
  workerFixtureRuntimes,
} from "./worker-fixture-options.ts";

const source = `
import os, { arch, endianness } from "node:os";
import crypto, { hash, randomUUID } from "node:crypto";
import workers, { isInternalThread, MessageChannel, receiveMessageOnPort } from "node:worker_threads";
export async function run(): Promise<number> {
  if (os.arch !== arch || !["arm64", "x64"].includes(arch()) || endianness() !== "LE") return 1;
  if (typeof os.userInfo().username !== "string") return 2;
  if (crypto.hash !== hash || hash("sha256", "abc") !== "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") return 3;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(randomUUID())) return 4;
  const original: { value: number; self?: unknown } = { value: 1.5 };
  original.self = original;
  const clone = structuredClone(original);
  if (clone === original || clone.self !== clone || clone.value !== 1.5) return 5;
  const buffer = new ArrayBuffer(4);
  new Uint8Array(buffer)[2] = 99;
  const result = structuredClone(buffer, { transfer: [buffer] });
  if (buffer.byteLength !== 0 || new Uint8Array(result)[2] !== 99) return 6;
  const shared = new SharedArrayBuffer(4);
  const sharedClone = structuredClone(shared);
  new Uint8Array(sharedClone)[0] = 17;
  if (sharedClone === shared || new Uint8Array(shared)[0] !== 17) return 9;
  const pending = new ArrayBuffer(4);
  try {
    structuredClone(null, { transfer: [pending, pending] });
    return 10;
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "DataCloneError" || pending.byteLength !== 4) return 11;
  }
  if (isInternalThread || workers.receiveMessageOnPort !== receiveMessageOnPort) return 7;
  const { port1, port2 } = new MessageChannel();
  try {
    port1.postMessage({ value: 42 });
    if (receiveMessageOnPort(port2)?.message.value !== 42 || receiveMessageOnPort(port2) !== undefined) return 8;
  } finally { port1.close(); port2.close(); }
  return 42;
}
`;

test("OS, crypto, cloning and worker APIs match Node", async () => {
  const fixture = (await import(
    "data:text/javascript," + encodeURIComponent(stripTypeScriptTypes(source))
  )) as { run(): Promise<number> };
  assert.equal(await fixture.run(), 42);
});

test("OS, crypto, cloning and worker APIs run natively", () => {
  verifyHostedFixture(
    source,
    "m1p7-os-crypto-workers",
    [
      ["node:os", osModule],
      ["node:crypto", "node:crypto"],
      ["node:worker_threads", "node:worker_threads"],
    ],
    [],
    [],
    workerFixtureRuntimes,
    {
      ...workerFixtureOptions([]),
      nodeCrypto: "esm",
      managedBytes: 134217728,
      allocationCapacity: 1048576,
    },
  );
});
