// Native typed-array kinds beyond the original four (Int8Array,
// Uint8ClampedArray, Int16Array, Int32Array, Float32Array) on the typed
// path. Element writes convert as ECMAScript requires (ToInt8, ToInt16 and
// ToInt32 wrap modulo 2^n; ToUint8Clamp rounds half to even and clamps;
// Float32 rounds to nearest, ties to even, and overflows to infinity) from
// integer and double values alike, reads sign-extend or widen, and each
// kind keeps its own identity for `instanceof`. Every access form is
// covered: checked and proven in-bounds reads and writes, optional reads,
// `?? 0` and `?? constant` reads, and integer and double uses of elements.
// The same source runs in Node for the expected trace and natively under
// LLDB.
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

const source = `let log = "";
function note(text: string): void {
  log += text + ";";
}
// Doubles reach the stores through a parameter, so nothing folds them.
const doubles: number[] = [
  0, -0, 1, -1, 1.5, -1.5, 2.5, 0.5, 0.49999999999999994, 127, 128, -128,
  -129, 254.5, 255, 255.5, 256, 300, 32767, 32768, -32768, -32769, 65535,
  65536, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295,
  4294967296, 4294967301, 1e10, -1e10, 3.5e9, 0.1, 1e40, -1e40, 1e-46,
  16777217, 3.4028235677973366e38, 1.401298464324817e-45, 1.0000000596046448,
  1.0000001788139343, NaN, Infinity, -Infinity,
];
function show(value: number): string {
  return value === 0 && 1 / value < 0 ? "-0" : String(value);
}
function int8(input: readonly number[]): string {
  const a = new Int8Array(input.length);
  for (let i = 0; i < input.length; i++) a[i] = input[i] ?? 0;
  let text = "";
  for (let i = 0; i < a.length; i++) text += show(a[i] ?? 99) + ",";
  return text;
}
function clamped(input: readonly number[]): string {
  const a = new Uint8ClampedArray(input.length);
  for (let i = 0; i < input.length; i++) a[i] = input[i] ?? 0;
  let text = "";
  for (let i = 0; i < a.length; i++) text += show(a[i] ?? 99) + ",";
  return text;
}
function int16(input: readonly number[]): string {
  const a = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) a[i] = input[i] ?? 0;
  let text = "";
  for (let i = 0; i < a.length; i++) text += show(a[i] ?? 99) + ",";
  return text;
}
function int32(input: readonly number[]): string {
  const a = new Int32Array(input.length);
  for (let i = 0; i < input.length; i++) a[i] = input[i] ?? 0;
  let text = "";
  for (let i = 0; i < a.length; i++) text += show(a[i] ?? 99) + ",";
  return text;
}
function float32(input: readonly number[]): string {
  const a = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) a[i] = input[i] ?? 0;
  let text = "";
  for (let i = 0; i < a.length; i++) text += show(a[i] ?? 99) + ",";
  return text;
}
// Integer-valued stores (int64 arithmetic) and integer uses of elements.
function integers(): string {
  const bytes = new Int8Array(64),
    clamp = new Uint8ClampedArray(64),
    halves = new Int16Array(64),
    words = new Int32Array(64),
    singles = new Float32Array(64);
  for (let i = 0; i < 64; i++) {
    const k = i * 37 - 1000;
    bytes[i] = k;
    clamp[i] = k + 900;
    halves[i] = k * 41;
    words[i] = k * 3000000;
    singles[i] = k * 16777;
  }
  let sum = 0,
    wide = 0;
  for (let i = 0; i < 64; i++) {
    sum = (sum + (bytes[i] ?? 0) + (clamp[i] ?? 0) + (halves[i] ?? 0)) | 0;
    sum = (Math.imul(sum, 31) + (words[i] ?? 0)) | 0;
    wide += (singles[i] ?? 0) * 0.5 + (words[i] ?? 0);
  }
  return String(sum) + "/" + String(wide);
}
// Proven in-bounds reads and writes (array-element/array-store).
function proven(): string {
  const a = new Int16Array(10),
    f = new Float32Array(10),
    c = new Uint8ClampedArray(10);
  for (let i = 0; i < a.length; i++) a[i] = i * 10000 - 40000;
  for (let i = 0; i < f.length; i++) f[i] = i / 3;
  for (let i = 0; i < c.length; i++) c[i] = i * 60.5 - 70;
  let text = "";
  for (let i = 0; i < a.length; i++) text += String(a[i] ?? 0) + ",";
  for (let i = 0; i < f.length; i++) text += String(f[i] ?? 0) + ",";
  for (let i = 0; i < c.length; i++) text += String(c[i] ?? 0) + ",";
  return text;
}
// Optional reads: present, absent, and both fused forms.
function optional(): string {
  const a = new Int8Array(3),
    f = new Float32Array(3);
  a[0] = -5;
  a[2] = 200;
  f[1] = -0.1;
  let text = "";
  for (let i = -1; i < 5; i++) {
    const v = a[i];
    const w = f[i];
    text += (v === undefined ? "u" : String(v)) + ":";
    text += (w === undefined ? "u" : String(w)) + ":";
    text += String(a[i] ?? 0) + ":" + String(f[i] ?? 0) + ":";
    text += String(a[i] ?? -7) + ":" + String(f[i] ?? 2.5) + ",";
  }
  return text;
}
// Library operations convert between kinds by value.
function methods(): string {
  const a = new Int8Array(6);
  a.fill(-3);
  a.fill(300, 2, 4);
  const b = new Uint8ClampedArray(6);
  b.set(a);
  const c = new Int32Array(a);
  const d = new Float32Array(6);
  d.set(c, 0);
  d.fill(0.1, 4);
  const e = new Int16Array(d);
  const s = a.subarray(1, 4);
  s[0] = 1000;
  const t = c.slice(2);
  t[0] = 77;
  let text = a.join(" ") + "|" + b.join(" ") + "|" + c.join(" ") + "|";
  text += d.join(" ") + "|" + e.join(" ") + "|" + s.join(" ") + "|";
  text += t.join(" ") + "|" + String(a.length) + ":" + String(c.byteLength);
  text += ":" + String(d.byteLength) + ":" + String(s.byteOffset) + "|";
  text += String(c.at(-1) ?? 0) + ":" + a.reverse().join(" ");
  return text;
}
// Bulk fills: relative and clamped bounds, empty ranges, lengths that leave
// every tail size, each kind's conversion and the returned receiver.
function fills(): string {
  const bounds: number[][] = [
    [],
    [2],
    [-2],
    [1, -1],
    [-100, 100],
    [NaN, Infinity],
    [5, 2],
    [-Infinity, -1],
    [1.7, 3.2],
    [3, 3],
  ];
  function range(a: number[], length: number): number[] {
    let from = a[0] ?? 0,
      to = a[1] ?? length;
    from = from !== from ? 0 : Math.trunc(from);
    to = to !== to ? 0 : Math.trunc(to);
    if (from < 0) from = Math.max(length + from, 0);
    else from = Math.min(from, length);
    if (to < 0) to = Math.max(length + to, 0);
    else to = Math.min(to, length);
    return [from, to];
  }
  let text = "";
  for (const length of [0, 1, 7, 37, 70]) {
    for (const bound of bounds) {
      const b8 = new Int8Array(length),
        c8 = new Uint8ClampedArray(length),
        u16 = new Uint16Array(length),
        i16 = new Int16Array(length),
        u32 = new Uint32Array(length),
        i32 = new Int32Array(length),
        f32 = new Float32Array(length),
        f64 = new Float64Array(length);
      const clamped = range(bound, length),
        from = clamped[0] ?? 0,
        to = clamped[1] ?? 0;
      const first = bound[0],
        second = bound[1];
      if (first === undefined) {
        b8.fill(200);
        c8.fill(300.5);
        u16.fill(65537);
        i16.fill(-32769);
        u32.fill(-1);
        i32.fill(2147483648);
        f32.fill(0.1);
        f64.fill(-0);
      } else if (second === undefined) {
        b8.fill(-129, first);
        c8.fill(2.5, first);
        u16.fill(-1, first);
        i16.fill(40000, first);
        u32.fill(4294967297, first);
        i32.fill(-1.9, first);
        f32.fill(1e40, first);
        f64.fill(NaN, first);
      } else {
        b8.fill(1.5, first, second);
        c8.fill(-3, first, second);
        u16.fill(7, first, second);
        i16.fill(-7, first, second);
        u32.fill(123456789, first, second);
        i32.fill(-123456789, first, second);
        f32.fill(16777217, first, second);
        f64.fill(0.5, first, second);
      }
      let sum = 0;
      for (let i = 0; i < length; i++)
        sum +=
          (b8[i] ?? 0) +
          (c8[i] ?? 0) +
          (u16[i] ?? 0) +
          (i16[i] ?? 0) +
          (u32[i] ?? 0) +
          (i32[i] ?? 0) +
          (f32[i] ?? 0) +
          ((f64[i] ?? 0) === (f64[i] ?? 0) ? (f64[i] ?? 0) : 1000);
      text += String(from) + "-" + String(to) + ":" + String(sum) + ",";
    }
  }
  const bytes = new Uint8Array(5);
  const same = bytes.fill(9, 1) === bytes;
  return text + String(same) + bytes.join("") + String(1 / (new Float64Array(2).fill(-0)[1] ?? 1));
}
function kinds(): string {
  const values: unknown[] = [
    new Int8Array(1),
    new Uint8Array(1),
    new Uint8ClampedArray(1),
    new Int16Array(1),
    new Int32Array(1),
    new Float32Array(1),
    new Float64Array(1),
  ];
  let text = "";
  for (const value of values) {
    text += value instanceof Int8Array ? "i8" : "";
    text += value instanceof Uint8Array ? "u8" : "";
    text += value instanceof Uint8ClampedArray ? "c8" : "";
    text += value instanceof Int16Array ? "i16" : "";
    text += value instanceof Int32Array ? "i32" : "";
    text += value instanceof Float32Array ? "f32" : "";
    text += value instanceof Float64Array ? "f64" : "";
    text += ",";
  }
  return text;
}
export function trace(): string {
  note(int8(doubles));
  note(clamped(doubles));
  note(int16(doubles));
  note(int32(doubles));
  note(float32(doubles));
  note(integers());
  note(proven());
  note(optional());
  note(methods());
  note(fills());
  note(kinds());
  return log;
}
`;

async function expectedTrace(text: string): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "tint-typed-array-kinds-"));
  try {
    const file = join(directory, "fixture.ts");
    writeFileSync(file, text);
    const module = (await import(pathToFileURL(file).href)) as {
      trace(): string;
    };
    return module.trace();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("typed-array kinds convert, read and keep their identity as in ECMAScript", async () => {
  const expected = await expectedTrace(source);
  // Spot checks of the conversions the trace pins.
  assert.match(expected, /^0,0,1,-1,1,-1,2,0,0,127,-128,-128,127,/);
  assert.match(expected, /;0,0,1,0,2,0,2,0,0,127,128,0,0,254,255,255,255,255,/);
  verifyHostedFixture(
    source +
      `export function run(): number { return trace() === ${JSON.stringify(expected)} ? 42 : 1; }\n`,
    "typed-array-kinds",
    [],
    [],
    [],
    [],
    { requireTyped: true, managedBytes: 67108864, allocationCapacity: 1048576 },
  );
});
