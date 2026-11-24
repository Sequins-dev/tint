// Native dynamic C calls (docs/native-ffi.md, "Dynamic calls"): a C
// library compiled by clang at test time, opened with dlopen and called
// through the universal trampoline for every argument and result class,
// plus libc symbols found in the program itself. Expected values are C's.
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";
import { stableScratchDirectory } from "./fixture-scratch.ts";

/** The test library: records of every passing class, narrow and 64-bit
 * integers, bools, floats, stack arguments, variadics and buffers. */
export const dynamicLibrarySource = `#include <stdarg.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
typedef struct { int64_t a, b, c; } Big;
typedef struct { float x, y, z; } Vec3;
typedef struct { double re, im; } Complex;
typedef struct { uint8_t tag; int32_t value; } Small;
int64_t big_sum(Big b) { return b.a + b.b * 2 + b.c * 3; }
Big big_make(int64_t a, int64_t b, int64_t c) { Big r = { a, b, c }; return r; }
float vec_dot(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
Vec3 vec_scale(Vec3 v, float k) { Vec3 r = { v.x * k, v.y * k, v.z * k }; return r; }
Complex complex_mul(Complex a, Complex b) {
  Complex r = { a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re };
  return r;
}
Small small_bump(Small s) { s.tag++; s.value *= 2; return s; }
int32_t narrow(int8_t a, uint8_t b, int16_t c, uint16_t d) { return a + b + c + d; }
int8_t narrow_result(int32_t v) { return (int8_t)v; }
uint16_t narrow_unsigned(int32_t v) { return (uint16_t)v; }
double many(int32_t a0, int32_t a1, int32_t a2, int32_t a3, int32_t a4,
            int32_t a5, int32_t a6, int32_t a7, int32_t a8, int32_t a9,
            double d0, double d1, double d2, double d3, double d4,
            double d5, double d6, double d7, double d8, double d9,
            int8_t s, float f, Big big) {
  return a0 + 2 * a1 + 3 * a2 + 4 * a3 + 5 * a4 + 6 * a5 + 7 * a6 + 8 * a7 +
         9 * a8 + 10 * a9 + d0 + d1 * 2 + d2 * 3 + d3 * 4 + d4 * 5 + d5 * 6 +
         d6 * 7 + d7 * 8 + d8 * 9 + d9 * 10 + s * 100 + f * 1000 +
         (double)(big.a + big.b + big.c);
}
bool negate(bool b) { return !b; }
uint64_t u64_max(void) { return UINT64_MAX; }
int64_t i64_min(void) { return INT64_MIN; }
uint64_t echo_u64(uint64_t v) { return v + 1; }
int64_t echo_i64(int64_t v) { return v - 1; }
void *echo_pointer(void *p) { return p; }
void fill(uint8_t *buffer, size_t count, uint8_t value) { memset(buffer, value, count); }
size_t matching(const uint8_t *a, const uint8_t *b, size_t count) {
  size_t same = 0;
  for (size_t i = 0; i < count; i++) same += a[i] == b[i];
  return same;
}
int32_t sum_ints(int32_t count, ...) {
  va_list list; va_start(list, count);
  int32_t total = 0;
  for (int32_t i = 0; i < count; i++) total += va_arg(list, int32_t) * (i + 1);
  va_end(list);
  return total;
}
double sum_doubles(int32_t count, ...) {
  va_list list; va_start(list, count);
  double total = 0;
  for (int32_t i = 0; i < count; i++) total += va_arg(list, double) * (i + 1);
  va_end(list);
  return total;
}
float halve(float v) { return v / 2; }
`;

/** Compile the library (clang -shared); undefined without clang. */
export function buildDynamicLibrary(directory: string): string | undefined {
  const clang = spawnSync("clang", ["--version"], { encoding: "utf8" });
  if (clang.status !== 0) return undefined;
  const source = join(directory, "tint-dynamic.c"),
    library = join(
      directory,
      nativeFixtureTarget().os === "darwin"
        ? "libtint-dynamic.dylib"
        : "libtint-dynamic.so",
    );
  writeFileSync(source, dynamicLibrarySource);
  const built = spawnSync(
    "clang",
    ["-O1", "-shared", "-fPIC", "-o", library, source],
    { encoding: "utf8" },
  );
  if (built.status !== 0) throw Error("clang failed:\n" + built.stderr);
  return library;
}

export function dynamicFixtureSource(library: string): string {
  return `import { allocate, release } from "tint:ffi";
import {
  openLibrary,
  openProgram,
  findSymbol,
  closeLibrary,
  foreignFunction,
  setNumber,
  setBoolean,
  setWords,
  setBytes,
  setRecord,
  invoke,
  resultNumber,
  resultBoolean,
  resultLow,
  resultHigh,
  resultRecord,
  setCallback,
  bytesAt,
  type ForeignFunction,
  type LibraryHandle,
  type ForeignSignature,
  type ForeignType,
} from "tint:ffi/unsafe";
const v: ForeignType = { kind: "void" };
const b8: ForeignType = { kind: "scalar", scalar: "bool" };
const i8: ForeignType = { kind: "scalar", scalar: "i8" };
const u8: ForeignType = { kind: "scalar", scalar: "u8" };
const i16: ForeignType = { kind: "scalar", scalar: "i16" };
const u16: ForeignType = { kind: "scalar", scalar: "u16" };
const i32: ForeignType = { kind: "scalar", scalar: "i32" };
const i64: ForeignType = { kind: "scalar", scalar: "i64" };
const u64: ForeignType = { kind: "scalar", scalar: "u64" };
const usize: ForeignType = { kind: "scalar", scalar: "usize" };
const f32: ForeignType = { kind: "scalar", scalar: "f32" };
const f64: ForeignType = { kind: "scalar", scalar: "f64" };
const pointer: ForeignType = { kind: "pointer", pointee: v };
function record(name: string, types: ForeignType[]): ForeignType {
  const fields: { readonly name: string; readonly type: ForeignType }[] = [];
  for (let i = 0; i < types.length; i++) {
    const type = types[i];
    if (type !== undefined) fields.push({ name: "m" + String(i), type });
  }
  return { kind: "record", name, union: false, packed: false, alignment: 0, fields };
}
const big = record("Big", [i64, i64, i64]);
const vec3 = record("Vec3", [f32, f32, f32]);
const complex = record("Complex", [f64, f64]);
const small = record("Small", [u8, i32]);
function signature(parameters: ForeignType[], result: ForeignType, fixed: number): ForeignSignature {
  return { parameters, result, fixedParameters: fixed, callClass: "leaf", errno: "none" };
}
function fn(library: LibraryHandle, name: string, parameters: ForeignType[], result: ForeignType): ForeignFunction {
  return foreignFunction(findSymbol(library, name), signature(parameters, result, parameters.length));
}
function throwsType(f: () => void): boolean {
  try { f(); } catch (error) { return error instanceof TypeError; }
  return false;
}
function throwsLoaderError(f: () => void, prefix: string): boolean {
  try { f(); } catch (error) {
    if (!(error instanceof Error) || error instanceof TypeError || error.name !== "Error") return false;
    if (!("code" in error) || error.code !== "ERR_FFI_CALL_FAILED") return false;
    return error.message.slice(0, prefix.length) === prefix;
  }
  return false;
}
function throwsRange(f: () => void): boolean {
  try { f(); } catch (error) { return error instanceof RangeError; }
  return false;
}
let sink: number[][] = [];
function churn(): void {
  for (let round = 0; round < 32; round++) {
    const values: number[] = [];
    for (let i = 0; i < 256; i++) values.push(round * i);
    sink.push(values);
    if (sink.length > 16) sink = [];
  }
}
/** Little-endian i64 fields of a record image (small magnitudes;
 * negative values as the complement of -value - 1). */
function writeI64(bytes: Uint8Array, offset: number, value: number): void {
  const negative = value < 0;
  let rest = negative ? -value - 1 : value;
  for (let i = 0; i < 8; i++) {
    const byte = rest % 256;
    bytes[offset + i] = negative ? 255 - byte : byte;
    rest = Math.floor(rest / 256);
  }
}
function readI64(bytes: Uint8Array, offset: number): number {
  const negative = (bytes[offset + 7] ?? 0) >= 128;
  let value = 0;
  for (let i = 7; i >= 0; i--) {
    const byte = bytes[offset + i] ?? 0;
    value = value * 256 + (negative ? 255 - byte : byte);
  }
  return negative ? -value - 1 : value;
}
export function run(): number {
  const library = openLibrary(${JSON.stringify(library)});
  // Records by value: indirect (24 bytes), HFAs, a small composite.
  const bigSum = fn(library, "big_sum", [big], i64);
  const image = new Uint8Array(24);
  writeI64(image, 0, 5); writeI64(image, 8, -7); writeI64(image, 16, 11);
  setRecord(bigSum, 0, image);
  churn();
  invoke(bigSum);
  if (resultNumber(bigSum) !== 5 - 14 + 33) return 1;
  const bigMake = fn(library, "big_make", [i64, i64, i64], big);
  setNumber(bigMake, 0, 1); setNumber(bigMake, 1, -2); setNumber(bigMake, 2, 3000000000);
  invoke(bigMake);
  const made = new Uint8Array(24);
  resultRecord(bigMake, made);
  if (readI64(made, 0) !== 1 || readI64(made, 8) !== -2 || readI64(made, 16) !== 3000000000) return 2;
  const vecDot = fn(library, "vec_dot", [vec3, vec3], f32);
  const a = new Uint8Array(12), c = new Uint8Array(12);
  const scale = fn(library, "vec_scale", [vec3, f32], vec3);
  // Build float images through C: scale (1,2,3) by 1 into a, by 2 into c.
  const ones = new Uint8Array(12);
  // 1.0f = 0x3f800000, 2.0f = 0x40000000, 3.0f = 0x40400000.
  ones[3] = 0x3f; ones[2] = 0x80; ones[7] = 0x40; ones[11] = 0x40; ones[10] = 0x40;
  setRecord(scale, 0, ones); setNumber(scale, 1, 1); invoke(scale); resultRecord(scale, a);
  setNumber(scale, 1, 2); invoke(scale); resultRecord(scale, c);
  setRecord(vecDot, 0, a); setRecord(vecDot, 1, c);
  invoke(vecDot);
  if (resultNumber(vecDot) !== 28) return 3;
  const complexMul = fn(library, "complex_mul", [complex, complex], complex);
  const product = new Uint8Array(16);
  const left = new Uint8Array(16), right = new Uint8Array(16);
  // (1 + 2i) * (3 + 4i) = -5 + 10i; doubles 1, 2, 3, 4 by their bytes.
  left[7] = 0x3f; left[6] = 0xf0; left[15] = 0x40;
  right[7] = 0x40; right[6] = 0x08; right[15] = 0x40; right[14] = 0x10;
  setRecord(complexMul, 0, left); setRecord(complexMul, 1, right);
  invoke(complexMul); resultRecord(complexMul, product);
  // -5.0 = 0xc014000000000000, 10.0 = 0x4024000000000000.
  if (product[7] !== 0xc0 || product[6] !== 0x14 || product[15] !== 0x40 || product[14] !== 0x24) return 4;
  const smallBump = fn(library, "small_bump", [small], small);
  const s = new Uint8Array(8);
  s[0] = 41; s[4] = 0xff; s[5] = 0xff; s[6] = 0xff; s[7] = 0xff;
  setRecord(smallBump, 0, s); invoke(smallBump);
  const bumped = new Uint8Array(8);
  resultRecord(smallBump, bumped);
  if (bumped[0] !== 42 || bumped[4] !== 0xfe || bumped[7] !== 0xff) return 5;
  // Narrow integers both ways.
  const narrow = fn(library, "narrow", [i8, u8, i16, u16], i32);
  setNumber(narrow, 0, -128); setNumber(narrow, 1, 255); setNumber(narrow, 2, -32768); setNumber(narrow, 3, 65535);
  invoke(narrow);
  if (resultNumber(narrow) !== -128 + 255 - 32768 + 65535) return 6;
  const narrowResult = fn(library, "narrow_result", [i32], i8);
  setNumber(narrowResult, 0, 383); invoke(narrowResult);
  if (resultNumber(narrowResult) !== 127) return 7;
  setNumber(narrowResult, 0, 128); invoke(narrowResult);
  if (resultNumber(narrowResult) !== -128) return 8;
  const narrowUnsigned = fn(library, "narrow_unsigned", [i32], u16);
  setNumber(narrowUnsigned, 0, -1); invoke(narrowUnsigned);
  if (resultNumber(narrowUnsigned) !== 65535) return 9;
  // Stack arguments: 10 ints, 10 doubles, a narrow, a float, a record.
  const manyTypes: ForeignType[] = [];
  for (let i = 0; i < 10; i++) manyTypes.push(i32);
  for (let i = 0; i < 10; i++) manyTypes.push(f64);
  manyTypes.push(i8); manyTypes.push(f32); manyTypes.push(big);
  const many = fn(library, "many", manyTypes, f64);
  let expected = 0;
  for (let i = 0; i < 10; i++) { setNumber(many, i, i - 3); expected += (i + 1) * (i - 3); }
  for (let i = 0; i < 10; i++) { setNumber(many, 10 + i, i * 0.5); expected += (i + 1) * i * 0.5; }
  setNumber(many, 20, -2); setNumber(many, 21, 0.25); setRecord(many, 22, image);
  expected += -200 + 250 + 9;
  churn();
  invoke(many);
  if (resultNumber(many) !== expected) return 10;
  // Bools, 64-bit extremes (exact halves and the exactness rule).
  const negate = fn(library, "negate", [b8], b8);
  setBoolean(negate, 0, true); invoke(negate);
  if (resultBoolean(negate) !== false) return 11;
  const u64Max = fn(library, "u64_max", [], u64);
  invoke(u64Max);
  if (resultLow(u64Max) !== 4294967295 || resultHigh(u64Max) !== 4294967295) return 12;
  if (!throwsRange(() => { resultNumber(u64Max); })) return 13;
  const i64Min = fn(library, "i64_min", [], i64);
  invoke(i64Min);
  if (resultNumber(i64Min) !== -9223372036854775808 || resultHigh(i64Min) !== 2147483648) return 14;
  const echoU64 = fn(library, "echo_u64", [u64], u64);
  setWords(echoU64, 0, 4294967294, 4294967295); invoke(echoU64);
  if (resultLow(echoU64) !== 4294967295 || resultHigh(echoU64) !== 4294967295) return 15;
  setNumber(echoU64, 0, 9007199254740992); invoke(echoU64);
  if (!throwsRange(() => { resultNumber(echoU64); })) return 16;
  const echoI64 = fn(library, "echo_i64", [i64], i64);
  setNumber(echoI64, 0, -9007199254740991); invoke(echoI64);
  if (resultNumber(echoI64) !== -9007199254740992) return 17;
  if (!throwsType(() => { setNumber(echoI64, 0, 0.5); })) return 18;
  if (!throwsType(() => { setNumber(narrow, 0, 128); })) return 19;
  // Buffers are borrowed for the call: C writes them, collections between
  // calls move them.
  const fill = fn(library, "fill", [pointer, usize, u8], v);
  const buffer = new Uint8Array(64);
  setBytes(fill, 0, buffer); setNumber(fill, 1, 64); setNumber(fill, 2, 7);
  churn();
  invoke(fill);
  if (buffer[0] !== 7 || buffer[63] !== 7) return 20;
  const matching = fn(library, "matching", [pointer, pointer, usize], usize);
  const other = new Uint8Array(64);
  for (let i = 0; i < 64; i += 2) other[i] = 7;
  setBytes(matching, 0, buffer); setBytes(matching, 1, other); setNumber(matching, 2, 64);
  churn();
  invoke(matching);
  if (resultNumber(matching) !== 32) return 21;
  const echoPointer = fn(library, "echo_pointer", [pointer], pointer);
  setNumber(echoPointer, 0, 1152921504606846976); invoke(echoPointer);
  if (resultNumber(echoPointer) !== 1152921504606846976) return 22;
  // Variadic calls: one prototype per call shape.
  const sumInts = foreignFunction(findSymbol(library, "sum_ints"), signature([i32, i32, i32, i32], i32, 1));
  setNumber(sumInts, 0, 3); setNumber(sumInts, 1, 10); setNumber(sumInts, 2, 20); setNumber(sumInts, 3, 30);
  invoke(sumInts);
  if (resultNumber(sumInts) !== 140) return 23;
  const sumDoubles = foreignFunction(findSymbol(library, "sum_doubles"), signature([i32, f64, f64], f64, 1));
  setNumber(sumDoubles, 0, 2); setNumber(sumDoubles, 1, 1.5); setNumber(sumDoubles, 2, 0.25);
  invoke(sumDoubles);
  if (resultNumber(sumDoubles) !== 2) return 24;
  const halve = fn(library, "halve", [f32], f32);
  setNumber(halve, 0, 0.1); invoke(halve);
  if (resultNumber(halve) !== 0.05000000074505806) return 25;
  // The program itself: libc's strlen through dlopen(NULL).
  const program = openProgram();
  const strlen = fn(program, "strlen", [pointer], usize);
  const text = new Uint8Array(6);
  text[0] = 104; text[1] = 105;
  setBytes(strlen, 0, text); invoke(strlen);
  if (resultNumber(strlen) !== 2) return 26;
  // Contracts: unset arguments, wrong setters, missing symbols and
  // libraries, null addresses.
  const unset = fn(library, "negate", [b8], b8);
  if (!throwsType(() => { invoke(unset); })) return 27;
  if (!throwsType(() => { setNumber(negate, 0, 1); })) return 28;
  if (!throwsType(() => { setBytes(narrow, 0, buffer); })) return 29;
  if (!throwsLoaderError(() => { findSymbol(library, "tint_no_such_symbol"); }, "dlsym failed: ")) return 30;
  if (!throwsLoaderError(() => { openLibrary("/nonexistent/libtint-missing.so"); }, "dlopen failed: ")) return 31;
  if (!throwsType(() => { foreignFunction(0, signature([], v, 0)); })) return 32;
  if (!throwsRange(() => { setRecord(bigSum, 0, new Uint8Array(8)); })) return 33;
  // Dynamic callbacks: libc's qsort with a TypeScript comparator through a
  // universal callback thunk, collections inside it.
  const qsort = fn(program, "qsort", [pointer, usize, usize, pointer], v);
  const words = allocate(4 * 64);
  for (let i = 0; i < 64; i++) words[i * 4] = (i * 37) % 64;
  setBytes(qsort, 0, words);
  setNumber(qsort, 1, 64);
  setNumber(qsort, 2, 4);
  let compared = 0;
  setCallback(qsort, 3, signature([pointer, pointer], i32, 2), (args: number[]): number => {
    compared++;
    if (compared % 50 === 0) churn();
    const left = bytesAt(args[0] ?? 0, 4)[0] ?? 0,
      right = bytesAt(args[1] ?? 0, 4)[0] ?? 0;
    return left - right;
  });
  invoke(qsort);
  if (compared === 0) return 34;
  for (let i = 0; i < 64; i++) if (words[i * 4] !== i) return 35;
  // An exception in a dynamic callback is rethrown after the call.
  setCallback(qsort, 3, signature([pointer, pointer], i32, 2), (args: number[]): number => {
    throw new RangeError("from a dynamic callback");
  });
  if (!throwsRange(() => { invoke(qsort); })) return 36;
  // Movable buffers are refused while callbacks may collect.
  setBytes(qsort, 0, new Uint8Array(16));
  if (!throwsType(() => { invoke(qsort); })) return 37;
  release(words);
  closeLibrary(library);
  return 42;
}
`;
}
export function verifyDynamicFixture(
  library: string,
  runtimeEntry?: "initializeCopyingRuntime",
): string {
  return verifyHostedFixture(
    dynamicFixtureSource(library),
    runtimeEntry === undefined ? "ffi-dynamic" : "ffi-dynamic-copying",
    [
      ["tint:ffi/unsafe", "packages/native-runtime/src/ffi/unsafe.ts"],
      ["tint:ffi", "packages/native-runtime/src/ffi/index.ts"],
    ],
    [],
    [],
    [],
    {
      ...(runtimeEntry === undefined ? {} : { runtimeEntry }),
      managedBytes: 4194304,
      allocationCapacity: 65536,
    },
  );
}
/** Build the library in a temporary directory, run `body`, clean up;
 * undefined (and no run) without clang. */
export function withDynamicLibrary<T>(
  body: (library: string) => T,
): T | undefined {
  const directory = stableScratchDirectory("dynamic-library");
  try {
    const library = buildDynamicLibrary(directory);
    return library === undefined ? undefined : body(library);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
