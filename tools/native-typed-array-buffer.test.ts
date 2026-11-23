// Typed code builds typed arrays over an ArrayBuffer: views of any native
// element type share the buffer's bytes, follow it through collections and
// reject misaligned or out-of-range windows with RangeError, as in Node.
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
export function run(): number {
  const buffer = new ArrayBuffer(16);
  if (buffer.byteLength !== 16) return 1;
  const bytes = new Uint8Array(buffer);
  const words = new Uint32Array(buffer, 4, 2);
  const doubles = new Float64Array(buffer, 8);
  if (bytes.length !== 16 || words.length !== 2 || doubles.length !== 1)
    return 2;
  if (words.byteOffset !== 4 || doubles.byteOffset !== 8) return 3;
  if (words.byteLength !== 8 || doubles.byteLength !== 8) return 4;
  words[0] = 67305985;
  if (bytes[4] !== 1 || bytes[7] !== 4 || bytes[3] !== 0) return 5;
  doubles[0] = 1.5;
  // 1.5 is 0x3ff8000000000000, little endian.
  const halves = new Uint16Array(bytes.buffer, 8, 4);
  if (halves[3] !== 16376 || halves[0] !== 0) return 6;
  if (words[1] !== 0) return 7;
  // A view of a view's buffer and a subarray of a view share the bytes.
  const tail = new Uint8Array(halves.buffer, 12);
  // 2.5 is 0x4004000000000000.
  tail[2] = 4;
  tail[3] = 64;
  if (doubles[0] !== 2.5 || tail.length !== 4) return 8;
  const inner = words.subarray(1);
  inner[0] = 4294967295;
  if (bytes[8] !== 255 || bytes[11] !== 255) return 9;
  // The views follow the buffer through collections.
  if (churn(20000) !== 1280000) return 10;
  if (bytes[4] !== 1 || words[0] !== 67305985 || halves[0] !== 65535)
    return 11;
  // An empty buffer and a view at its end.
  const empty = new ArrayBuffer(0);
  if (empty.byteLength !== 0 || new Uint8Array(empty).length !== 0) return 12;
  if (new Uint32Array(buffer, 16).length !== 0) return 13;
  let errors = 0;
  errors += rangeError((): number => new Uint32Array(buffer, 2).length);
  errors += rangeError((): number => new Uint32Array(buffer, 4, 4).length);
  errors += rangeError(
    (): number => new Uint32Array(new ArrayBuffer(6)).length,
  );
  errors += rangeError((): number => new Uint8Array(buffer, 17).length);
  errors += rangeError((): number => new Uint8Array(buffer, -1).length);
  errors += rangeError((): number => new Uint16Array(buffer, 0, 9).length);
  errors += rangeError((): number => new ArrayBuffer(-1).byteLength);
  if (errors !== 7) return 14;
  return 42;
}
`;

test("typed arrays over an ArrayBuffer match Node", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-typed-array-buffer-"));
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

test("typed code builds typed arrays over an ArrayBuffer natively", () => {
  verifyHostedFixture(source, "typed-array-buffer", [], [], [], [], {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 2097152,
    allocationCapacity: 65536,
  });
});
