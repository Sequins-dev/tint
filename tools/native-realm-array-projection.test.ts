// A realm typed array passed to a typed function's native typed-array
// parameter (the slice 2b buffer view) is viewed natively: the native view
// shares the realm buffer's bytes in both directions, keeps them through
// collections, and observes a detachment of the buffer as V8's typed arrays
// do (length 0, undefined reads, ignored writes, TypeError from Atomics and
// methods). Windows with no fixed native layout still throw TypeError.
import assert from "node:assert/strict";
import test from "node:test";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";

const trusted = "fixture:trusted";
const unsupported =
  "Passing a realm typed array to a native typed-array parameter requires the slice 2b buffer view";

test(
  "typed code views realm typed arrays natively",
  {
    // The x86-64 general lowering has no program realm runtime for the
    // fixture's instanceof yet.
    skip:
      nativeFixtureTarget().arch === "x86_64"
        ? "mixed realm programs need the x86-64 program realm runtime"
        : false,
  },
  () => {
    const parsed = parseModule(
      createSourceTextView(`
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
`),
    );
    assert.ok(parsed.ok, JSON.stringify(parsed));
    let partition: readonly string[] | undefined;
    verifyHostedFixture(
      `
import { add, bytes, bump, total, keep, keptLength, keptRead, keptWrite, keptOffset, keptAtomics, keptFill } from "./trusted.ts";
function rejects(make) {
  try { make(); } catch (e) {
    return e instanceof TypeError && e.message === ${JSON.stringify(unsupported)};
  }
  return false;
}
export function run(): number {
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
  return 42;
}
`,
      "realm-array-native-projection",
      [["./trusted.ts", trusted]],
      [{ id: trusted, module: parsed.value, dependencies: new Map() }],
      [],
      [
        {
          module: trusted,
          namespace: "trusted-array-projection",
          retainedExports: [],
        },
      ],
      {
        managedBytes: 67108864,
        allocationCapacity: 1048576,
        onGeneralFallback(modules) {
          partition = modules;
        },
      },
    );
    assert.deepEqual(partition, ["fixture"]);
  },
);
