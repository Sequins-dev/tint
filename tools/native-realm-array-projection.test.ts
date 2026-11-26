// A realm typed array or SharedArrayBuffer passed to a typed function's native
// parameter (the slice 2b buffer view) is viewed natively: the native view
// shares the realm buffer's bytes in both directions, keeps them through
// collections, and observes detachment as V8 does. Both cases share one
// `await import(...)` + `argv` binary while keeping the trusted helper modules
// strictly on the typed side of the partition boundary.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { prepareHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";
import {
  workerFixtureOptions,
  workerFixtureRuntimes,
} from "./worker-fixture-options.ts";
import {
  cleanupNativeBinary,
  generalImportDispatcher,
  nodeProcessModule,
  parseFixtureModule,
  runNativeSuiteCase,
} from "./native-suite-runner.ts";

const trusted = "fixture:trusted";
const sharedTrusted = "fixture:trusted-shared";
const unsupported =
  "Passing a realm typed array to a native typed-array parameter requires the slice 2b buffer view";
const unsupportedShared =
  "Passing a realm SharedArrayBuffer to a native SharedArrayBuffer requires a fixed-length SharedArrayBuffer";

const skipX64 =
  nativeFixtureTarget().arch === "x86_64"
    ? { skip: "mixed realm programs need the x86-64 program realm runtime" }
    : {};

const trustedSource = `
function churn(rounds: number): number {
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    const garbage = new Float64Array(64);
    garbage[round % 64] = round;
    total += garbage.length;
  }
  return total;
}
function first(value: Uint8Array): number {
  const previous = value[0] ?? 0;
  value[0] = previous + 1;
  return previous * 1000 + value.length;
}
function words(value: Uint32Array): number {
  if (churn(2000) !== 128000) return -2;
  return Atomics.add(value, 1, 5);
}
function sum(value: Float64Array): number {
  let total = 0;
  for (const element of value) total += element;
  return total;
}
export function bytes(value: unknown): number {
  if (value instanceof Uint8Array) return first(value);
  return -1;
}
export function bump(value: unknown): number {
  if (value instanceof Uint32Array) return words(value);
  return -1;
}
export function add(value: unknown): number {
  if (value instanceof Uint16Array) return Atomics.add(value, 0, 3);
  return -1;
}
let kept: Uint8Array | undefined = undefined;
function take(value: Uint8Array): Uint8Array {
  return value;
}
function held(): Uint8Array {
  const view = kept;
  if (view === undefined) throw new TypeError("nothing kept");
  return view;
}
export function keep(value: unknown): number {
  if (!(value instanceof Uint8Array)) return -1;
  const view = take(value);
  kept = view;
  return view.length;
}
export function keptLength(): number {
  return held().length;
}
export function keptRead(): number {
  return held()[0] ?? -1;
}
export function keptWrite(): number {
  const view = held();
  view[0] = 99;
  return view.length;
}
export function keptOffset(): number {
  return held().byteOffset;
}
export function keptAtomics(): number {
  const view = held();
  try {
    Atomics.add(view, 0, 1);
    return 0;
  } catch (error) {
    return error instanceof TypeError ? 1 : error instanceof RangeError ? 2 : 3;
  }
}
export function keptFill(): number {
  const view = held();
  try {
    view.fill(1);
    return 0;
  } catch (error) {
    return error instanceof TypeError ? 1 : 3;
  }
}
export function total(value: unknown): number {
  if (value instanceof Float64Array) return sum(value);
  return -1;
}
export function bumpHalf(value: unknown): number {
  if (!(value instanceof Float16Array)) return -1;
  const prev = value[0] ?? 0;
  value[0] = prev + 1.5;
  return prev;
}
export function bumpBig(value: unknown): string {
  if (value instanceof BigInt64Array) return String(Atomics.add(value, 0, 5n));
  if (value instanceof BigUint64Array) return String(Atomics.add(value, 0, 7n));
  return "none";
}
let keptBig: BigInt64Array | undefined = undefined;
function takeBig(value: BigInt64Array): BigInt64Array {
  return value;
}
export function keepBig(value: unknown): number {
  if (!(value instanceof BigInt64Array)) return -1;
  const view = takeBig(value);
  keptBig = view;
  return view.length;
}
export function keptBigRead(): string {
  const view = keptBig;
  if (view === undefined) throw new TypeError("nothing kept");
  const item = view[0];
  return item === undefined ? "absent" : String(item);
}
export function keptBigLength(): number {
  const view = keptBig;
  if (view === undefined) throw new TypeError("nothing kept");
  return view.length;
}
`;

const sharedTrustedSource = `
function churn(rounds: number): number {
  let total = 0;
  for (let round = 0; round < rounds; round++) {
    const garbage = new Float64Array(64);
    garbage[round % 64] = round;
    total += garbage.length;
  }
  return total;
}
function acceptBuffer(buffer: SharedArrayBuffer): number {
  if (churn(2000) !== 128000) return -2;
  const words = new Uint32Array(buffer, 4, 2);
  return Atomics.add(words, 0, 5) * 100 + buffer.byteLength;
}
function acceptBytes(view: Uint8Array): number {
  return view.length;
}
function passthrough(buffer: SharedArrayBuffer): SharedArrayBuffer {
  return buffer;
}
let kept: SharedArrayBuffer | undefined = undefined;
export function isShared(value: unknown): boolean {
  return value instanceof SharedArrayBuffer;
}
export function isBytes(value: unknown): boolean {
  return value instanceof Uint8Array;
}
export function lengthOf(value: unknown): number {
  if (value instanceof SharedArrayBuffer) return value.byteLength;
  return -1;
}
export function bumpDirect(value: unknown): number {
  if (value instanceof SharedArrayBuffer) {
    const words = new Uint32Array(value, 4, 2);
    return Atomics.add(words, 1, 7) * 100 + value.byteLength;
  }
  return -1;
}
export function bumpParam(value: unknown): number {
  if (value instanceof SharedArrayBuffer) return acceptBuffer(value);
  return -1;
}
export function keepShared(value: unknown): number {
  if (!(value instanceof SharedArrayBuffer)) return -1;
  const direct: SharedArrayBuffer = passthrough(value);
  kept = direct;
  return direct.byteLength;
}
export function readKept(): number {
  const buffer = kept;
  if (buffer === undefined) return -1;
  return new Uint32Array(buffer, 4, 2)[0] ?? -2;
}
export function castBuffer(value: unknown): number {
  const buffer = value as SharedArrayBuffer;
  const bytes = new Uint8Array(buffer);
  bytes[0] = (bytes[0] ?? 0) + 1;
  return buffer.byteLength;
}
export function checkNativeSelf(): number {
  const sab = new SharedArrayBuffer(16);
  const words = new Uint32Array(sab, 4, 2);
  words[0] = 30;
  const boxed: unknown = sab;
  if (!(boxed instanceof SharedArrayBuffer)) return 1;
  if (boxed instanceof Uint8Array) return 2;
  const view: unknown = words;
  if (view instanceof SharedArrayBuffer) return 3;
  const byteView: unknown = new Uint8Array(sab);
  if (byteView instanceof SharedArrayBuffer) return 4;
  if (!(byteView instanceof Uint8Array)) return 5;
  const ordinary: unknown = new ArrayBuffer(16);
  if (ordinary instanceof SharedArrayBuffer) return 6;
  if (bumpParam(boxed) !== 3016) return 7;
  if (words[0] !== 35) return 8;
  if (castBuffer(boxed) !== 16) return 9;
  if (new Uint8Array(sab)[0] !== 1) return 10;
  // A native SharedArrayBuffer boxed as unknown must not pass as Uint8Array.
  const unnarrowed: unknown = sab;
  let rejected = false;
  try {
    const asBytes = unnarrowed as Uint8Array;
    acceptBytes(asBytes);
  } catch (error) {
    rejected = error instanceof TypeError;
  }
  if (!rejected) return 11;
  return 0;
}
`;

const typedArraysCaseSource = `
import process from "node:process";
import { add, bytes, bump, bumpHalf, bumpBig, keepBig, keptBigRead, keptBigLength, total, keep, keptLength, keptRead, keptWrite, keptOffset, keptAtomics, keptFill } from "./trusted.ts";
function rejects(make) {
  try { make(); } catch (e) {
    return e instanceof TypeError && e.message === ${JSON.stringify(unsupported)};
  }
  return false;
}
function checkTypedArrays(): number {
  // Not a typed array: still rejected.
  if (!rejects(() => bytes(new Proxy({}, {getPrototypeOf() {return Uint8Array.prototype;}})))) return 1;
  // The native view writes through to the realm's bytes.
  const array = new Uint8Array([7, 8, 9]);
  if (bytes(array) !== 7003 || array[0] !== 8) return 2;
  const window = new Uint8Array(array.buffer, 1, 2);
  if (bytes(window) !== 8002 || array[1] !== 9) return 3;
  // Through collections, and with element offsets.
  const words = new Uint32Array(new ArrayBuffer(24), 8, 3);
  words[1] = 37;
  if (bump(words) !== 37 || words[1] !== 42) return 4;
  if (total(new Float64Array([1.5, 2.25])) !== 3.75) return 5;
  // Inline Atomics on a narrowed realm typed array.
  const halves = new Uint16Array([65534, 1]);
  if (add(halves) !== 65534 || halves[0] !== 1) return 12;
  // A typed view kept across a detachment of its buffer sees it detached.
  const buffer = new ArrayBuffer(8);
  const window2 = new Uint8Array(buffer, 2, 4);
  window2[0] = 5;
  if (keep(window2) !== 4 || keptRead() !== 5 || keptOffset() !== 2) return 6;
  const moved = buffer.transfer();
  if (window2.length !== 0 || keptLength() !== 0 || keptRead() !== -1) return 7;
  if (keptWrite() !== 0 || new Uint8Array(moved)[2] !== 5) return 8;
  // Atomics and fill reject the detached buffer (TypeError is 1).
  const atomics = keptAtomics(), fill = keptFill();
  if (atomics !== 1) return 20 + atomics;
  if (fill !== 1) return 30 + fill;
  if (keptOffset() !== 0) return 13;
  // A typed array already detached is an empty one.
  if (bytes(window2) !== 0) return 14;
  // No fixed native window: resizable and length-tracking views.
  const resizable = new ArrayBuffer(4, { maxByteLength: 8 });
  if (!rejects(() => bytes(new Uint8Array(resizable, 0, 2)))) return 9;
  if (!rejects(() => bytes(new Uint8Array(resizable)))) return 10;
  // Another kind is not an instance.
  if (bytes(new Uint16Array(2)) !== -1) return 11;
  // Float16Array, BigInt64Array and BigUint64Array project natively too.
  const f16 = new Float16Array([2.5, 4.0]);
  if (bumpHalf(f16) !== 2.5 || f16[0] !== 4.0) return 40;
  const bi64 = new BigInt64Array([-10n, 20n]);
  if (bumpBig(bi64) !== "-10" || bi64[0] !== -5n) return 41;
  const bu64 = new BigUint64Array([18446744073709551610n]);
  if (bumpBig(bu64) !== "18446744073709551610" || bu64[0] !== 1n) return 43;
  // Detachment propagates to projected BigInt64Array views.
  const bigBuf = new ArrayBuffer(16);
  const bigView = new BigInt64Array(bigBuf, 8, 1);
  bigView[0] = 1234567890123n;
  if (keepBig(bigView) !== 1 || keptBigRead() !== "1234567890123") return 44;
  bigBuf.transfer();
  if (keptBigLength() !== 0 || keptBigRead() !== "absent") return 45;
  return 42;
}
process.exitCode = checkTypedArrays();
`;

const sharedBuffersCaseSource = `
import process from "node:process";
import {
  isShared,
  isBytes,
  lengthOf,
  bumpDirect,
  bumpParam,
  keepShared,
  readKept,
  castBuffer,
  checkNativeSelf,
} from "./trusted-shared.ts";
function rejects(make, message) {
  try { make(); } catch (e) {
    return e instanceof TypeError && (message === undefined || e.message === message);
  }
  return false;
}
function checkSharedBuffers(): number {
  if (checkNativeSelf() !== 0) return 1;
  const sab = new SharedArrayBuffer(16);
  const words = new Uint32Array(sab, 4, 2);
  words[0] = 37;
  words[1] = 10;
  if (!isShared(sab) || isBytes(sab)) return 2;
  if (lengthOf(sab) !== 16) return 3;
  if (bumpDirect(sab) !== 1016 || words[1] !== 17) return 4;
  if (bumpParam(sab) !== 3716 || words[0] !== 42) return 5;
  if (keepShared(sab) !== 16 || readKept() !== 42) return 6;
  words[0] = 77;
  if (readKept() !== 77) return 7;
  if (castBuffer(sab) !== 16 || new Uint8Array(sab)[0] !== 1) return 8;
  // Growable SharedArrayBuffer: instanceof is true, native projection rejects.
  const growable = new SharedArrayBuffer(8, { maxByteLength: 32 });
  if (!isShared(growable)) return 9;
  if (!rejects(() => lengthOf(growable), ${JSON.stringify(unsupportedShared)})) return 10;
  if (!rejects(() => bumpDirect(growable), ${JSON.stringify(unsupportedShared)})) return 11;
  if (!rejects(() => bumpParam(growable), ${JSON.stringify(unsupportedShared)})) return 12;
  if (!rejects(() => castBuffer(growable))) return 13;
  // Spoofed prototype: instanceof is true, native projection rejects.
  const spoofed = new Proxy({}, { getPrototypeOf() { return SharedArrayBuffer.prototype; } });
  if (!isShared(spoofed)) return 14;
  if (!rejects(() => lengthOf(spoofed), ${JSON.stringify(unsupportedShared)})) return 15;
  if (!rejects(() => bumpParam(spoofed), ${JSON.stringify(unsupportedShared)})) return 16;
  if (!rejects(() => castBuffer(spoofed))) return 17;
  // Non-SharedArrayBuffers: instanceof is false, downcast rejects.
  const ab = new ArrayBuffer(16);
  const bytes = new Uint8Array(sab);
  if (isShared(ab) || isShared(bytes) || isShared(words) || isShared(123)) return 18;
  if (!rejects(() => castBuffer(ab)) || !rejects(() => castBuffer(bytes))) return 19;
  return 42;
}
process.exitCode = checkSharedBuffers();
`;

let suiteBinary: string | undefined;
function projectionSuite(): string {
  if (suiteBinary !== undefined) return suiteBinary;
  const cases = [
    {
      name: "typed-arrays",
      specifier: "./typed-arrays.ts",
      id: "fixture:realm-typed-arrays",
      text: typedArraysCaseSource,
      deps: [
        ["node:process", nodeProcessModule],
        ["./trusted.ts", trusted],
      ] as [string, string][],
    },
    {
      name: "shared-buffers",
      specifier: "./shared-buffers.ts",
      id: "fixture:realm-shared-buffers",
      text: sharedBuffersCaseSource,
      deps: [
        ["node:process", nodeProcessModule],
        ["./trusted-shared.ts", sharedTrusted],
      ] as [string, string][],
    },
  ];
  let partition: readonly string[] | undefined;
  suiteBinary = prepareHostedFixture(
    generalImportDispatcher(cases),
    "realm-array-projection-suite",
    [
      ["node:process", nodeProcessModule],
      ...cases.map(({ specifier, id }): [string, string] => [specifier, id]),
    ],
    [
      parseFixtureModule(trusted, trustedSource),
      parseFixtureModule(sharedTrusted, sharedTrustedSource),
      ...cases.map(({ id, text, deps }) => parseFixtureModule(id, text, deps)),
    ],
    [],
    [
      {
        module: trusted,
        namespace: "trusted-array-projection",
        retainedExports: [],
      },
      {
        module: sharedTrusted,
        namespace: "trusted-shared-projection",
        retainedExports: [],
      },
      ...workerFixtureRuntimes,
    ],
    {
      ...workerFixtureOptions([]),
      managedBytes: 67108864,
      allocationCapacity: 1048576,
      onGeneralFallback(modules) {
        partition = modules;
      },
    },
  );
  assert.ok(partition !== undefined, "expected general fallback");
  assert.ok(
    !partition.includes(trusted) && !partition.includes(sharedTrusted),
    "trusted projection modules must stay typed: " + JSON.stringify(partition),
  );
  return suiteBinary;
}

after(() => {
  cleanupNativeBinary(suiteBinary);
});

test("typed code views realm typed arrays natively", skipX64, () => {
  runNativeSuiteCase(projectionSuite(), ["typed-arrays"]);
});

test("typed code views realm SharedArrayBuffers natively", skipX64, () => {
  runNativeSuiteCase(projectionSuite(), ["shared-buffers"]);
});
