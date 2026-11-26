// Typed stdlib builtins & buffer views (docs/unified-pipeline.md):
//   - ArrayBuffer / SharedArrayBuffer (ArrayBufferLike) views across all 12
//     typed-array kinds + DataView (all 22 getters/setters, endianness, bounds,
//     instanceof, .buffer/.byteOffset/.byteLength, BYTES_PER_ELEMENT)
//   - Math.* transcendental, hyperbolic, rounding, and variadic hypot builtins
//   - String.prototype.* casing (Unicode 17.0.0 + ASCII fast path), trimLeft /
//     trimRight, replace / replaceAll ($ substitutions), normalize (NFC/NFD/
//     NFKC/NFKD), isWellFormed / toWellFormed, and optional-primitive templates
// Each fixture is verified against Node for exact semantic parity and executed
// natively under LLDB on the typed path (TINT_GENERAL_FALLBACK=0).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");
const { sharedBufferFixtureRuntimes, sharedBufferHostBindings } =
  await import("./worker-fixture-options.ts");

async function runInNode(source: string): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), "tint-builtins-node-"));
  try {
    const file = join(dir, "fixture.ts");
    writeFileSync(file, source, "utf8");
    const mod = (await import(pathToFileURL(file).href)) as {
      run: () => number;
    };
    return mod.run();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const bufferViewsAndDataViewSource = `function catchRange(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof RangeError;
  }
}

function inspectBufferLike(buf: ArrayBufferLike): number {
  const bytes = new Uint8Array(buf, 4, 8);
  const view = new DataView(buf, 4, 8);
  view.setUint32(0, 0x12345678, false);
  view.setUint32(4, 0x12345678, true);
  if (bytes[0] !== 0x12 || bytes[1] !== 0x34 || bytes[2] !== 0x56 || bytes[3] !== 0x78)
    return 1;
  if (bytes[4] !== 0x78 || bytes[5] !== 0x56 || bytes[6] !== 0x34 || bytes[7] !== 0x12)
    return 2;
  if (view.getUint32(0) !== 0x12345678) return 3;
  if (view.getUint32(0, false) !== 0x12345678) return 4;
  if (view.getUint32(4, true) !== 0x12345678) return 5;
  if (view.buffer !== buf) return 6;
  if (view.byteOffset !== 4 || view.byteLength !== 8) return 7;
  if (bytes.buffer !== buf || bytes.byteOffset !== 4 || bytes.byteLength !== 8)
    return 8;
  return 0;
}

export function run(): number {
  const ab = new ArrayBuffer(32);
  const sab = new SharedArrayBuffer(32);
  if (inspectBufferLike(ab) !== 0) return 10;
  if (inspectBufferLike(sab) !== 0) return 11;

  // All 12 typed-array kinds over a shared buffer + BYTES_PER_ELEMENT (static & instance)
  let sideEffects = 0;
  function bump(): number {
    sideEffects++;
    return 0;
  }
  const i8 = new Int8Array(ab, 0, 8);
  const u8 = new Uint8Array(ab, 0, 8);
  const u8c = new Uint8ClampedArray(ab, 0, 8);
  const i16 = new Int16Array(ab, 0, 4);
  const u16 = new Uint16Array(ab, 0, 4);
  const i32 = new Int32Array(ab, 0, 2);
  const u32 = new Uint32Array(ab, 0, 2);
  const f16 = new Float16Array(ab, 8, 4);
  const f32 = new Float32Array(ab, 8, 2);
  const f64 = new Float64Array(ab, 16, 1);
  const bi64 = new BigInt64Array(ab, 24, 1);
  const bu64 = new BigUint64Array(ab, 24, 1);

  if (
    Int8Array.BYTES_PER_ELEMENT !== 1 ||
    Uint8Array.BYTES_PER_ELEMENT !== 1 ||
    Uint8ClampedArray.BYTES_PER_ELEMENT !== 1 ||
    Int16Array.BYTES_PER_ELEMENT !== 2 ||
    Uint16Array.BYTES_PER_ELEMENT !== 2 ||
    Int32Array.BYTES_PER_ELEMENT !== 4 ||
    Uint32Array.BYTES_PER_ELEMENT !== 4 ||
    Float16Array.BYTES_PER_ELEMENT !== 2 ||
    Float32Array.BYTES_PER_ELEMENT !== 4 ||
    Float64Array.BYTES_PER_ELEMENT !== 8 ||
    BigInt64Array.BYTES_PER_ELEMENT !== 8 ||
    BigUint64Array.BYTES_PER_ELEMENT !== 8
  )
    return 12;

  if (
    (bump(), i8).BYTES_PER_ELEMENT !== 1 ||
    (bump(), u8).BYTES_PER_ELEMENT !== 1 ||
    (bump(), u8c).BYTES_PER_ELEMENT !== 1 ||
    (bump(), i16).BYTES_PER_ELEMENT !== 2 ||
    (bump(), u16).BYTES_PER_ELEMENT !== 2 ||
    (bump(), i32).BYTES_PER_ELEMENT !== 4 ||
    (bump(), u32).BYTES_PER_ELEMENT !== 4 ||
    (bump(), f16).BYTES_PER_ELEMENT !== 2 ||
    (bump(), f32).BYTES_PER_ELEMENT !== 4 ||
    (bump(), f64).BYTES_PER_ELEMENT !== 8 ||
    (bump(), bi64).BYTES_PER_ELEMENT !== 8 ||
    (bump(), bu64).BYTES_PER_ELEMENT !== 8 ||
    sideEffects !== 12
  )
    return 13;

  // All 22 DataView getters and setters + endianness + aliasing with typed arrays
  const dv = new DataView(ab);
  if (dv.byteOffset !== 0 || dv.byteLength !== 32 || dv.buffer !== ab) return 14;

  // instanceof DataView across typed, optional, unknown, and negative operands
  const optPresent: DataView | undefined = dv;
  const optMissing: DataView | undefined = undefined;
  const unknownDv: unknown = dv;
  const unknownAb: unknown = ab;
  const unknownNum: unknown = 123;
  if (!(dv instanceof DataView)) return 15;
  if (!(optPresent instanceof DataView)) return 16;
  if (optMissing instanceof DataView) return 17;
  if (!(unknownDv instanceof DataView)) return 18;
  if (unknownAb instanceof DataView) return 19;
  if (unknownNum instanceof DataView) return 20;
  if (ab instanceof DataView) return 21;
  if (u8 instanceof DataView) return 22;

  // Int8 / Uint8
  dv.setInt8(0, -1);
  if (dv.getInt8(0) !== -1 || dv.getUint8(0) !== 255 || u8[0] !== 255 || i8[0] !== -1)
    return 23;
  dv.setUint8(1, 0x1ab);
  if (dv.getUint8(1) !== 0xab || dv.getInt8(1) !== -85) return 24;

  // Int16 / Uint16 (BE & LE + optional endianness)
  const optLe: boolean | undefined = undefined;
  dv.setInt16(2, -12345, optLe);
  if (dv.getInt16(2) !== -12345 || dv.getUint16(2, false) !== 53191) return 25;
  dv.setUint16(4, 0xabcd, true);
  if (dv.getUint16(4, true) !== 0xabcd || dv.getUint16(4, false) !== 0xcdab || u16[2] !== 0xabcd)
    return 26;

  // Int32 / Uint32
  dv.setInt32(0, -0x12345678, false);
  if (dv.getInt32(0, false) !== -0x12345678) return 27;
  dv.setUint32(0, 0xdeadbeef, true);
  if (dv.getUint32(0, true) !== 0xdeadbeef || dv.getUint32(0, false) !== 0xefbeadde)
    return 28;
  if (u32[0] !== 0xdeadbeef || i32[0] !== (0xdeadbeef | 0)) return 29;

  // Float16 (BE & LE, special values, subnormal)
  dv.setFloat16(8, 1.5, false);
  if (dv.getFloat16(8, false) !== 1.5 || dv.getUint16(8, false) !== 0x3e00) return 30;
  dv.setFloat16(10, -0, true);
  const f16NegZero = dv.getFloat16(10, true);
  if (f16NegZero !== 0 || 1 / f16NegZero !== -Infinity || dv.getUint16(10, true) !== 0x8000)
    return 31;
  dv.setFloat16(12, 1 / 16777216, true); // 2^-24 smallest positive subnormal
  if (dv.getFloat16(12, true) !== 1 / 16777216 || dv.getUint16(12, true) !== 0x0001)
    return 32;
  dv.setFloat16(14, 70000, false);
  if (dv.getFloat16(14, false) !== Infinity) return 33;
  dv.setFloat16(8, NaN, true);
  if (!Number.isNaN(dv.getFloat16(8, true))) return 34;

  // Float32
  dv.setFloat32(8, 3.25, true);
  if (dv.getFloat32(8, true) !== 3.25 || f32[0] !== 3.25) return 35;
  dv.setFloat32(12, -12.5, false);
  if (dv.getFloat32(12, false) !== -12.5) return 36;

  // Float64
  dv.setFloat64(16, -Math.PI, true);
  if (dv.getFloat64(16, true) !== -Math.PI || f64[0] !== -Math.PI) return 37;
  dv.setFloat64(16, 1.234567890123456, false);
  if (dv.getFloat64(16, false) !== 1.234567890123456) return 38;

  // BigInt64 / BigUint64
  const negBig = -(1n << 63n) + 42n;
  dv.setBigInt64(24, negBig, true);
  const bi64Val = bi64[0];
  if (dv.getBigInt64(24, true) !== negBig || bi64Val === undefined || bi64Val !== negBig)
    return 39;
  const maxU64 = (1n << 64n) - 1n;
  dv.setBigUint64(24, maxU64, false);
  if (dv.getBigUint64(24, false) !== maxU64 || dv.getBigInt64(24, false) !== -1n)
    return 40;
  dv.setBigUint64(24, (1n << 64n) + 0x0102030405060708n, false);
  if (dv.getBigUint64(24, false) !== 0x0102030405060708n) return 41;
  if (dv.getUint8(24) !== 1 || dv.getUint8(31) !== 8) return 43;

  // Sub-view defaults & undefined optional byteLength
  const sub1 = new DataView(ab, 16);
  const maybeLen: number | undefined = undefined;
  const sub2 = new DataView(ab, 16, maybeLen);
  if (sub1.byteOffset !== 16 || sub1.byteLength !== 16) return 44;
  if (sub2.byteOffset !== 16 || sub2.byteLength !== 16) return 45;
  if (sub1.getUint16(14) !== dv.getUint16(30)) return 46;

  // Bounds & alignment RangeErrors
  if (!catchRange(() => { new DataView(ab, -1); })) return 47;
  if (!catchRange(() => { new DataView(ab, 33); })) return 48;
  if (!catchRange(() => { new DataView(ab, 24, 9); })) return 49;
  if (!catchRange(() => { new Uint32Array(ab, 2); })) return 50;
  if (!catchRange(() => { new Uint32Array(ab, 0, 9); })) return 51;
  if (!catchRange(() => { dv.getUint32(-1); })) return 52;
  if (!catchRange(() => { dv.getUint32(29); })) return 53;
  if (!catchRange(() => { dv.setFloat64(25, 1); })) return 54;
  if (!catchRange(() => { dv.getBigInt64(25); })) return 55;
  if (!catchRange(() => { sub1.getUint16(15); })) return 56;

  // SharedArrayBuffer DataView & typed-array aliasing
  const sdv = new DataView(sab, 8, 16);
  const sf64 = new Float64Array(sab, 8, 2);
  sdv.setFloat64(0, 6.25, true);
  sdv.setBigInt64(8, -987654321012345n, true);
  const sbi64 = new BigInt64Array(sab, 16, 1);
  const sbi64Val = sbi64[0];
  if (sf64[0] !== 6.25 || sbi64Val === undefined || sbi64Val !== -987654321012345n)
    return 57;

  return 42;
}
`;

export const mathBuiltinsSource = `function close(a: number, b: number, eps: number): boolean {
  return Math.abs(a - b) <= eps;
}
function isNegZero(x: number): boolean {
  return x === 0 && 1 / x === -Infinity;
}
function isPosZero(x: number): boolean {
  return x === 0 && 1 / x === Infinity;
}

export function run(): number {
  // Math.pow
  if (Math.pow(2, 10) !== 1024) return 1;
  if (Math.pow(-2, 3) !== -8 || Math.pow(-2, 2) !== 4) return 2;
  if (!Number.isNaN(Math.pow(-2, 0.5))) return 3;
  if (!Number.isNaN(Math.pow(1, Infinity)) || !Number.isNaN(Math.pow(-1, Infinity)))
    return 4;
  if (Math.pow(0.5, Infinity) !== 0 || Math.pow(0.5, -Infinity) !== Infinity)
    return 5;
  if (Math.pow(2, -Infinity) !== 0 || Math.pow(0, 0) !== 1 || Math.pow(NaN, 0) !== 1)
    return 6;
  if (!isNegZero(Math.pow(-0, 3)) || !isPosZero(Math.pow(-0, 2))) return 7;
  if (Math.pow(-0, -3) !== -Infinity || Math.pow(-0, -2) !== Infinity) return 8;
  if (!isNegZero(Math.pow(-Infinity, -3))) return 9;
  if (!close(Math.pow(9, 0.5), 3, 1e-15) || !close(Math.pow(10, -2), 0.01, 1e-15))
    return 10;

  // Math.exp / Math.expm1
  if (Math.exp(0) !== 1 || !close(Math.exp(1), Math.E, 1e-15)) return 11;
  if (Math.exp(-Infinity) !== 0 || Math.exp(Infinity) !== Infinity) return 12;
  if (!isNegZero(Math.expm1(-0)) || Math.expm1(-Infinity) !== -1) return 13;
  if (!close(Math.expm1(1e-10), 1e-10 + 5e-21, 1e-24)) return 14;

  // Math.log / Math.log2 / Math.log10 / Math.log1p
  if (Math.log(1) !== 0 || !close(Math.log(Math.E), 1, 1e-15)) return 15;
  if (Math.log(0) !== -Infinity || !Number.isNaN(Math.log(-1))) return 16;
  if (Math.log2(1024) !== 10 || Math.log2(0.125) !== -3) return 17;
  if (!close(Math.log10(1000), 3, 1e-15) || !close(Math.log10(1e-6), -6, 1e-15))
    return 18;
  if (!isNegZero(Math.log1p(-0)) || Math.log1p(-1) !== -Infinity) return 19;
  if (!Number.isNaN(Math.log1p(-2)) || !close(Math.log1p(1e-12), 1e-12, 1e-24))
    return 20;

  // Math.cbrt
  if (!close(Math.cbrt(27), 3, 1e-15) || !close(Math.cbrt(-27), -3, 1e-15))
    return 21;
  if (!isNegZero(Math.cbrt(-0)) || Math.cbrt(-Infinity) !== -Infinity) return 22;
  if (!Number.isNaN(Math.cbrt(NaN))) return 23;

  // Math.fround / Math.f16round
  if (Math.fround(1.337) !== 1.3370000123977661) return 24;
  if (!isNegZero(Math.fround(-0)) || Math.fround(1e39) !== Infinity) return 25;
  if (Math.fround(1e-46) !== 0) return 26;
  if (Math.f16round(1.337) !== 1.3369140625) return 27;
  if (!isNegZero(Math.f16round(-0))) return 28;
  if (Math.f16round(65504) !== 65504 || Math.f16round(65520) !== Infinity) return 29;
  if (Math.f16round(1e-8) !== 0) return 30;

  // Trig: sin / cos / tan (including large-angle Payne-Hanek reduction)
  if (!isNegZero(Math.sin(-0)) || Math.cos(0) !== 1 || !isNegZero(Math.tan(-0)))
    return 31;
  if (
    !close(Math.sin(Math.PI / 6), 0.5, 1e-15) ||
    !close(Math.cos(Math.PI / 3), 0.5, 1e-15) ||
    !close(Math.tan(Math.PI / 4), 1, 1e-15)
  )
    return 32;
  if (!close(Math.sin(1e10), -0.4875060250875107, 1e-12)) return 33;
  if (!Number.isNaN(Math.sin(Infinity)) || !Number.isNaN(Math.cos(-Infinity)))
    return 34;

  // Inverse trig: asin / acos / atan / atan2
  if (
    !isNegZero(Math.asin(-0)) ||
    !close(Math.asin(0.5), Math.PI / 6, 1e-15) ||
    !Number.isNaN(Math.asin(2))
  )
    return 35;
  if (
    Math.acos(1) !== 0 ||
    !close(Math.acos(0.5), Math.PI / 3, 1e-15) ||
    !Number.isNaN(Math.acos(-2))
  )
    return 36;
  if (
    !isNegZero(Math.atan(-0)) ||
    !close(Math.atan(1), Math.PI / 4, 1e-15) ||
    !close(Math.atan(-Infinity), -Math.PI / 2, 1e-15)
  )
    return 37;
  if (
    !close(Math.atan2(1, 1), Math.PI / 4, 1e-15) ||
    !close(Math.atan2(1, -1), (3 * Math.PI) / 4, 1e-15) ||
    !close(Math.atan2(-1, -1), (-3 * Math.PI) / 4, 1e-15) ||
    !close(Math.atan2(-1, 1), -Math.PI / 4, 1e-15)
  )
    return 38;
  if (
    !close(Math.atan2(0, -0), Math.PI, 1e-15) ||
    !close(Math.atan2(-0, -0), -Math.PI, 1e-15) ||
    !close(Math.atan2(Infinity, Infinity), Math.PI / 4, 1e-15) ||
    !close(Math.atan2(-Infinity, -Infinity), (-3 * Math.PI) / 4, 1e-15)
  )
    return 39;

  // Hyperbolic: sinh / cosh / tanh / asinh / acosh / atanh
  if (
    !isNegZero(Math.sinh(-0)) ||
    !close(Math.sinh(1), (Math.E - 1 / Math.E) / 2, 1e-15)
  )
    return 40;
  if (
    Math.cosh(0) !== 1 ||
    !close(Math.cosh(1), (Math.E + 1 / Math.E) / 2, 1e-15)
  )
    return 41;
  if (
    !isNegZero(Math.tanh(-0)) ||
    Math.tanh(100) !== 1 ||
    Math.tanh(-100) !== -1
  )
    return 43;
  if (
    !isNegZero(Math.asinh(-0)) ||
    !close(Math.asinh(Math.sinh(2.5)), 2.5, 1e-14) ||
    !close(Math.asinh(1e150), 346.0809111296668, 1e-12)
  )
    return 44;
  if (
    Math.acosh(1) !== 0 ||
    !Number.isNaN(Math.acosh(0.5)) ||
    !close(Math.acosh(Math.cosh(2.5)), 2.5, 1e-14) ||
    !close(Math.acosh(1e150), 346.0809111296668, 1e-12)
  )
    return 45;
  if (
    !isNegZero(Math.atanh(-0)) ||
    Math.atanh(1) !== Infinity ||
    Math.atanh(-1) !== -Infinity ||
    !Number.isNaN(Math.atanh(2)) ||
    !close(Math.atanh(0.5), Math.log(3) / 2, 1e-15)
  )
    return 46;

  // Math.hypot (0, 1, 2, 3+ args, scaling without overflow/underflow, Infinity vs NaN)
  if (Math.hypot() !== 0) return 47;
  if (Math.hypot(-5) !== 5 || !isPosZero(Math.hypot(-0))) return 48;
  if (Math.hypot(-Infinity) !== Infinity || !Number.isNaN(Math.hypot(NaN)))
    return 49;
  if (Math.hypot(3, 4) !== 5 || Math.hypot(Infinity, NaN) !== Infinity)
    return 50;
  if (!close(Math.hypot(3e307, 4e307), 5e307, 1e293)) return 51;
  if (!close(Math.hypot(3e-308, 4e-308), 5e-308, 1e-322)) return 52;
  if (Math.hypot(2, 3, 6) !== 7 || Math.hypot(1, 2, 2, 4) !== 5) return 53;
  if (Math.hypot(NaN, 1, -Infinity) !== Infinity) return 54;

  return 42;
}
`;

export const stringBuiltinsSource = `function catchRange(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof RangeError;
  }
}

export function run(): number {
  // ASCII fast-path casing
  if ("Hello, World! 123".toLowerCase() !== "hello, world! 123") return 1;
  if ("Hello, World! 123".toUpperCase() !== "HELLO, WORLD! 123") return 2;

  // Unicode 17.0.0 full casing + special casing + Greek final sigma + astral
  if ("stra\\u00dfe".toUpperCase() !== "STRASSE") return 3;
  if ("\\u0130".toLowerCase() !== "i\\u0307") return 4;
  if ("\\u038c\\u03a3\\u039f\\u03a3".toLowerCase() !== "\\u03cc\\u03c3\\u03bf\\u03c2")
    return 5;
  if ("\\u03a3".toLowerCase() !== "\\u03c3") return 6;
  if ("\\u0391\\u0301\\u03a3".toLowerCase() !== "\\u03b1\\u0301\\u03c2") return 7;
  if ("\\u0391\\u0301\\u03a3\\u0391".toLowerCase() !== "\\u03b1\\u0301\\u03c3\\u03b1")
    return 8;
  if ("\\ud801\\udc00".toLowerCase() !== "\\ud801\\udc28") return 9;
  if ("\\ud801\\udc28".toUpperCase() !== "\\ud801\\udc00") return 10;

  // trimLeft / trimRight
  const padded = " \\t\\n\\r\\u00a0\\ufeff\\u2028abc \\u00a0\\r\\n";
  if (padded.trimLeft() !== "abc \\u00a0\\r\\n") return 11;
  if (padded.trimRight() !== " \\t\\n\\r\\u00a0\\ufeff\\u2028abc") return 12;

  // replace / replaceAll + $ substitutions + empty search
  if ("hello world world".replace("world", "tint") !== "hello tint world") return 13;
  if ("hello world world".replaceAll("world", "tint") !== "hello tint tint") return 14;
  if ("hello".replace("xyz", "!") !== "hello") return 15;
  if ("aaa".replaceAll("aa", "b") !== "ba") return 16;
  if ("".replace("", "x") !== "x") return 17;
  if ("ab".replace("", "-") !== "-ab") return 18;
  if ("ab".replaceAll("", "-") !== "-a-b-") return 19;
  if ("".replaceAll("", "-") !== "-") return 20;
  if ("foo-bar-baz".replace("bar", "[\$\`|\$&|\$'|\$\$|\$x|\$]") !== "foo-[foo-|bar|-baz|\$|\$x|\$]-baz")
    return 21;
  if ("ab-ab".replaceAll("ab", "($&:$')") !== "(ab:-ab)-(ab:)") return 22;
  if ("abc".replace("b", "$") !== "a$c") return 23;

  // normalize: ASCII fast path, NFC/NFD/NFKC/NFKD, default & optional form, RangeError
  if ("plain ascii".normalize() !== "plain ascii") return 24;
  if ("plain ascii".normalize("NFD") !== "plain ascii") return 25;
  const optForm: string | undefined = undefined;
  if ("e\\u0301".normalize() !== "\\u00e9") return 26;
  if ("e\\u0301".normalize(optForm) !== "\\u00e9") return 27;
  if ("\\u00e9".normalize("NFD") !== "e\\u0301") return 28;
  if ("\\ufb01".normalize("NFKC") !== "fi") return 29;
  if ("\\u212b".normalize("NFKD") !== "A\\u030a") return 30;
  if ("\\u1100\\u1161".normalize("NFC") !== "\\uac00") return 31;
  if ("\\uac00".normalize("NFD") !== "\\u1100\\u1161") return 32;
  if (!catchRange(() => { "abc".normalize("INVALID"); })) return 33;

  // isWellFormed / toWellFormed
  if (!"hello".isWellFormed() || "hello".toWellFormed() !== "hello") return 34;
  if (!"\\ud83d\\ude00".isWellFormed() || "\\ud83d\\ude00".toWellFormed() !== "\\ud83d\\ude00")
    return 35;
  if ("a\\ud800b".isWellFormed() || "a\\ud800b".toWellFormed() !== "a\\ufffdb")
    return 36;
  if ("a\\udc00b".isWellFormed() || "a\\udc00b".toWellFormed() !== "a\\ufffdb")
    return 37;
  if ("\\udc00\\ud800".isWellFormed() || "\\udc00\\ud800".toWellFormed() !== "\\ufffd\\ufffd")
    return 38;

  // Template literals with optional primitive substitutions (noUncheckedIndexedAccess)
  const parts = "Hello, World".split(", ");
  const optNumPresent: number | undefined = 7;
  const optNumMissing: number | undefined = undefined;
  const optBoolPresent: boolean | undefined = false;
  const optBoolMissing: boolean | undefined = undefined;
  const rendered = \`\${parts[1]}-\${parts[0]}:\${parts[5]}|\${optNumPresent},\${optNumMissing}|\${optBoolPresent},\${optBoolMissing}\`;
  if (rendered !== "World-Hello:undefined|7,undefined|false,undefined") return 39;

  return 42;
}
`;

test("typed ArrayBuffer/SharedArrayBuffer views and DataView match Node natively", async () => {
  assert.equal(await runInNode(bufferViewsAndDataViewSource), 42);
  verifyHostedFixture(
    bufferViewsAndDataViewSource,
    "typed-buffer-views-dataview",
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

test("typed Math builtins match Node natively", async () => {
  assert.equal(await runInNode(mathBuiltinsSource), 42);
  verifyHostedFixture(mathBuiltinsSource, "typed-math-builtins");
});

test("typed String builtins and optional templates match Node natively", async () => {
  assert.equal(await runInNode(stringBuiltinsSource), 42);
  verifyHostedFixture(stringBuiltinsSource, "typed-string-builtins");
});
