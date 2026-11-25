// Typed code creates SharedArrayBuffers from its isolate's shared block
// service: views of every native element type share the block's bytes,
// Atomics run on them, they never move through collections, and invalid
// lengths and windows throw RangeError, as in Node.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");
const { sharedBufferFixtureRuntimes, sharedBufferHostBindings } =
  await import("./worker-fixture-options.ts");

const source = `
function rangeError(make: () => number): number {
  try {
    make();
  } catch (error) {
    return error instanceof RangeError ? 1 : 0;
  }
  return 0;
}
function churn(rounds: number): number {
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    const garbage = new Float64Array(64);
    garbage[round % 64] = round;
    total += garbage.length;
  }
  return total;
}
function fill(buffer: SharedArrayBuffer, value: number): number {
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index++) bytes[index] = value;
  return bytes.length;
}
export function run(): number {
  const sab = new SharedArrayBuffer(32);
  if (sab.byteLength !== 32 || typeof sab !== "object") return 1;
  const bytes = new Uint8Array(sab);
  if (bytes.length !== 32 || bytes[31] !== 0) return 2;
  const words = new Uint32Array(sab, 8, 2);
  const halves = new Uint16Array(sab, 4);
  const doubles = new Float64Array(sab, 16);
  if (words.length !== 2 || halves.length !== 14 || doubles.length !== 2)
    return 3;
  if (words.byteOffset !== 8 || doubles.byteLength !== 16) return 4;
  words[0] = 67305985;
  if (bytes[8] !== 1 || bytes[11] !== 4) return 5;
  if (halves[2] !== 513 || halves[3] !== 1027) return 6;
  doubles[1] = 1.5;
  if (bytes[31] !== 63 || bytes[30] !== 248) return 7;
  if (words.buffer.byteLength !== 32) return 8;
  // Atomics see the same bytes.
  if (Atomics.add(words, 1, 7) !== 0 || bytes[12] !== 7) return 9;
  if (Atomics.compareExchange(bytes, 12, 7, 9) !== 7) return 10;
  if (Atomics.load(words, 1) !== 9) return 11;
  // A buffer passed by its SharedArrayBuffer type.
  if (fill(sab, 255) !== 32 || words[0] !== 4294967295) return 12;
  // Buffers and views keep their bytes through collections.
  const kept: Uint32Array[] = [];
  for (let index = 0; index < 64; index++) {
    const view = new Uint32Array(new SharedArrayBuffer(8));
    view[0] = index;
    view[1] = index * 2;
    kept.push(view);
  }
  if (churn(20000) !== 1280000) return 13;
  for (let index = 0; index < 64; index++) {
    const view = kept[index];
    if (view === undefined || view[0] !== index || view[1] !== index * 2)
      return 14;
  }
  if (bytes[0] !== 255 || Atomics.load(words, 1) !== 4294967295) return 15;
  const empty = new SharedArrayBuffer(0);
  if (empty.byteLength !== 0 || new Uint8Array(empty).length !== 0) return 16;
  if (new SharedArrayBuffer().byteLength !== 0) return 17;
  let errors = 0;
  errors += rangeError((): number => new SharedArrayBuffer(-1).byteLength);
  errors += rangeError((): number => new Uint32Array(sab, 2).length);
  errors += rangeError((): number => new Uint32Array(sab, 0, 9).length);
  errors += rangeError((): number => new Uint8Array(sab, 33).length);
  errors += rangeError(
    (): number => new Uint32Array(new SharedArrayBuffer(6)).length,
  );
  if (errors !== 5) return 18;
  return 42;
}
`;

test("typed SharedArrayBuffers match Node", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-typed-shared-buffer-"));
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(file, source);
    const module = (await import(pathToFileURL(file).href)) as {
      run(): number;
    };
    assert.equal(module.run(), 42);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("typed code creates SharedArrayBuffers natively", () => {
  verifyHostedFixture(
    source,
    "typed-shared-buffer",
    [],
    [],
    [],
    sharedBufferFixtureRuntimes,
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 2097152,
      allocationCapacity: 65536,
      hostBindings: sharedBufferHostBindings,
    },
  );
});
