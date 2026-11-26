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
  1.0000001788139343, 65504, 65519.999, 65520, -65520,
  1.00048828125, 1.00146484375, 5.960464477539063e-8, 2.9802322387695312e-8,
  -2.9802322387695312e-8, 2.980232594040899e-8, -2.980232594040899e-8,
  6.097555160522461e-5, 6.1005353927612305e-5, 6.0945749282836914e-5,
  6.103515625e-5, 1e-10, -1e-10, NaN, Infinity, -Infinity,
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
function float16(input: readonly number[]): string {
  const ab = new ArrayBuffer(input.length * 2);
  const a = new Float16Array(ab);
  const bits = new Uint16Array(ab);
  for (let i = 0; i < input.length; i++) a[i] = input[i] ?? 0;
  let text = "";
  for (let i = 0; i < a.length; i++)
    text += show(a[i] ?? 99) + "#" + String(bits[i] ?? -1) + ",";
  // Proven in-bounds and optional reads on Float16Array, plus fill/subarray/slice/set/reverse/at/join.
  const b = new Float16Array(6);
  b.fill(1.5);
  b.fill(65520, 2, 4);
  b.fill(-0, 4, 5);
  const sub = b.subarray(1, 5);
  sub[0] = 0.00000005960464477539063;
  const copy = b.slice(1);
  copy[0] = 3.25;
  const dst = new Float16Array(6);
  dst.set(b);
  const fromList = new Float16Array([0, -0, 1.5, 65504, NaN]);
  text += "|" + b.join(" ") + "|" + sub.join(" ") + "|" + copy.join(" ");
  text += "|" + dst.reverse().join(" ") + "|" + String(b.at(-2) ?? 9);
  text += "|" + String(b[-1] === undefined) + ":" + String(b[99] === undefined);
  text += ":" + String(b[0] ?? 9) + ":" + String(b[99] ?? 2.5);
  text += "|" + fromList.join(" ") + ":" + String(b.byteLength) + ":" + String(sub.byteOffset);
  return text;
}
function bigIntArrays(): string {
  const inputs: bigint[] = [
    0n,
    1n,
    -1n,
    42n,
    -42n,
    9223372036854775807n,
    9223372036854775808n,
    -9223372036854775808n,
    -9223372036854775809n,
    18446744073709551615n,
    18446744073709551616n,
    -18446744073709551616n,
    0x123456789abcdef0n,
    -0x123456789abcdef0n,
    (1n << 100n) + 0xfedcba9876543210n,
    -(1n << 100n) - 1n,
  ];
  const ab = new ArrayBuffer(inputs.length * 8);
  const s = new BigInt64Array(ab);
  const u = new BigUint64Array(ab);
  const words = new Uint32Array(ab);
  for (let i = 0; i < inputs.length; i++) s[i] = inputs[i] ?? 0n;
  let text = "";
  for (let i = 0; i < s.length; i++) {
    const sv = s[i];
    const uv = u[i];
    text +=
      (sv === undefined ? "u" : String(sv)) +
      "/" +
      (uv === undefined ? "u" : String(uv)) +
      "/" +
      String(words[i * 2] ?? -1) +
      ":" +
      String(words[i * 2 + 1] ?? -1) +
      ",";
  }
  const fromList = new BigInt64Array([10n, -20n, 9223372036854775807n, -9223372036854775808n]);
  const copyU = new BigUint64Array(fromList);
  const sub = fromList.subarray(1, 3);
  sub[0] = -99n;
  const sliced = copyU.slice(1, 4);
  sliced[0] = 77n;
  const filled = new BigInt64Array(5);
  filled.fill(-5n);
  filled.fill(0x100000002n, 1, 4);
  const dst = new BigUint64Array(5);
  dst.set(filled);
  dst.set(new BigUint64Array([1n, 2n]), 3);
  const [d0, d1] = fromList;
  let iter = "";
  for (const x of filled) iter += String(x) + ".";
  text += "|" + fromList.join(" ") + "|" + copyU.join(" ") + "|" + sub.join(" ");
  text += "|" + sliced.join(" ") + "|" + filled.join(" ") + "|" + dst.reverse().join(" ");
  text += "|" + String(fromList.at(-1) ?? 0n) + "|" + String(d0 ?? 0n) + ":" + String(d1 ?? 0n) + "|" + iter;
  text += "|" + String(fromList[-1] === undefined) + ":" + String(fromList[99] === undefined);
  text += ":" + String(fromList.byteLength) + ":" + String(sub.byteOffset) + ":" + String(sub.buffer.byteLength);
  return text;
}
function signedAndBigIntAtomics(): string {
  const i8 = new Int8Array(2);
  const u8 = new Uint8Array(2);
  const i16 = new Int16Array(2);
  const u16 = new Uint16Array(2);
  const i32 = new Int32Array(2);
  const u32 = new Uint32Array(2);
  const bi64 = new BigInt64Array(2);
  const bu64 = new BigUint64Array(2);
  let text = "";
  // Int8Array signed negative returns
  text += String(Atomics.store(i8, 0, -5)) + ":" + String(Atomics.load(i8, 0)) + ":";
  text += String(Atomics.add(i8, 0, -125)) + ":" + String(Atomics.load(i8, 0)) + ":";
  text += String(Atomics.sub(i8, 0, 130)) + ":" + String(Atomics.load(i8, 0)) + ":";
  text += String(Atomics.and(i8, 0, -16)) + ":" + String(Atomics.or(i8, 0, 5)) + ":";
  text += String(Atomics.xor(i8, 0, -1)) + ":" + String(Atomics.exchange(i8, 0, -1)) + ":";
  text += String(Atomics.compareExchange(i8, 0, -1, 127)) + ":" + String(Atomics.compareExchange(i8, 0, 0, 1)) + ":" + String(Atomics.load(i8, 0)) + "|";
  // Uint8Array
  Atomics.store(u8, 0, 250);
  text += String(Atomics.add(u8, 0, 10)) + ":" + String(Atomics.load(u8, 0)) + "|";
  // Int16Array signed negative returns
  Atomics.store(i16, 0, -32768);
  text += String(Atomics.load(i16, 0)) + ":" + String(Atomics.sub(i16, 0, 1)) + ":" + String(Atomics.load(i16, 0)) + ":";
  text += String(Atomics.compareExchange(i16, 0, 32767, -2)) + ":" + String(Atomics.exchange(i16, 0, -100)) + ":" + String(Atomics.load(i16, 0)) + "|";
  // Uint16Array
  Atomics.store(u16, 0, 65535);
  text += String(Atomics.add(u16, 0, 2)) + ":" + String(Atomics.load(u16, 0)) + "|";
  // Int32Array signed negative returns
  Atomics.store(i32, 0, -2147483648);
  text += String(Atomics.load(i32, 0)) + ":" + String(Atomics.sub(i32, 0, 1)) + ":" + String(Atomics.load(i32, 0)) + ":";
  text += String(Atomics.and(i32, 0, -256)) + ":" + String(Atomics.or(i32, 0, 0x8000000f)) + ":" + String(Atomics.xor(i32, 0, -1)) + ":";
  text += String(Atomics.compareExchange(i32, 0, Atomics.load(i32, 0), -7)) + ":" + String(Atomics.load(i32, 0)) + "|";
  // Uint32Array
  Atomics.store(u32, 0, 4294967295);
  text += String(Atomics.add(u32, 0, 5)) + ":" + String(Atomics.load(u32, 0)) + "|";
  // BigInt64Array
  text += String(Atomics.store(bi64, 0, -9223372036854775808n)) + ":" + String(Atomics.load(bi64, 0)) + ":";
  text += String(Atomics.sub(bi64, 0, 1n)) + ":" + String(Atomics.load(bi64, 0)) + ":";
  text += String(Atomics.add(bi64, 0, 1n)) + ":" + String(Atomics.load(bi64, 0)) + ":";
  text += String(Atomics.or(bi64, 0, 0x123456780000000fn)) + ":" + String(Atomics.and(bi64, 0, 0xffffffff000000ffn)) + ":";
  text += String(Atomics.xor(bi64, 0, -1n)) + ":" + String(Atomics.exchange(bi64, 0, -42n)) + ":";
  text += String(Atomics.compareExchange(bi64, 0, -42n, 0x700000001n)) + ":" + String(Atomics.compareExchange(bi64, 0, 0n, 1n)) + ":" + String(Atomics.load(bi64, 0)) + "|";
  // BigUint64Array
  text += String(Atomics.store(bu64, 0, -1n)) + ":" + String(Atomics.load(bu64, 0)) + ":";
  text += String(Atomics.add(bu64, 0, 2n)) + ":" + String(Atomics.load(bu64, 0)) + ":";
  text += String(Atomics.sub(bu64, 0, 5n)) + ":" + String(Atomics.load(bu64, 0)) + ":";
  text += String(Atomics.compareExchange(bu64, 0, 18446744073709551612n, 0xabcdef0123456789n)) + ":" + String(Atomics.load(bu64, 0));
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
    new Uint16Array(1),
    new Float16Array(1),
    new Int32Array(1),
    new Uint32Array(1),
    new Float32Array(1),
    new Float64Array(1),
    new BigInt64Array(1),
    new BigUint64Array(1),
  ];
  let text = "";
  for (const value of values) {
    text += value instanceof Int8Array ? "i8" : "";
    text += value instanceof Uint8Array ? "u8" : "";
    text += value instanceof Uint8ClampedArray ? "c8" : "";
    text += value instanceof Int16Array ? "i16" : "";
    text += value instanceof Uint16Array ? "u16" : "";
    text += value instanceof Float16Array ? "f16" : "";
    text += value instanceof Int32Array ? "i32" : "";
    text += value instanceof Uint32Array ? "u32" : "";
    text += value instanceof Float32Array ? "f32" : "";
    text += value instanceof Float64Array ? "f64" : "";
    text += value instanceof BigInt64Array ? "bi64" : "";
    text += value instanceof BigUint64Array ? "bu64" : "";
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
  note(float16(doubles));
  note(bigIntArrays());
  note(signedAndBigIntAtomics());
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
