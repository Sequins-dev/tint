// Native FFI fixtures (docs/native-ffi.md): direct leaf c-calls through
// `tint:c/...` binding declarations, checked by native execution.
import { createHash } from "node:crypto";
import { darwinSystemLibrary } from "@tint/abi/c";
import {
  verifyHostedFixture,
  type FixtureForeignDeclaration,
} from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";

const crypto = "packages/native-runtime/src/node/crypto.ts";

/** Test vectors: [label, update chunks]. Chunks are strings or byte
 * patterns `{ bytes: length, seed }`. */
type Chunk = string | { readonly bytes: number; readonly seed: number };
const vectors: readonly (readonly [string, readonly Chunk[]])[] = [
  ["empty", []],
  ["empty-string", [""]],
  ["abc", ["abc"]],
  ["one-byte", [{ bytes: 1, seed: 7 }]],
  ["55", [{ bytes: 55, seed: 1 }]],
  ["56", [{ bytes: 56, seed: 2 }]],
  ["63", [{ bytes: 63, seed: 3 }]],
  ["64", [{ bytes: 64, seed: 4 }]],
  ["65", [{ bytes: 65, seed: 5 }]],
  ["multi", ["The quick brown fox ", { bytes: 37, seed: 9 }, "jumps", ""]],
  [
    "split-block",
    [
      { bytes: 63, seed: 11 },
      { bytes: 2, seed: 12 },
    ],
  ],
  ["non-ascii", ["héllo wörld ✓ 🌍 ", "日本語", "\u{1F600}"]],
  ["lone-surrogate", ["a\uD800b", "\uDC00"]],
  ["large", [{ bytes: 1048576 + 13, seed: 17 }]],
];
function pattern(length: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++)
    bytes[i] = (seed * 131 + i * 7 + (i >> 8)) & 255;
  return bytes;
}
function nodeDigest(
  chunks: readonly Chunk[],
  encoding: "hex" | "base64" | "base64url",
): string {
  const hash = createHash("sha256");
  for (const chunk of chunks)
    hash.update(
      typeof chunk === "string" ? chunk : pattern(chunk.bytes, chunk.seed),
    );
  return hash.digest(encoding);
}
function chunkSource(chunk: Chunk): string {
  return typeof chunk === "string"
    ? JSON.stringify(chunk)
    : `pattern(${chunk.bytes}, ${chunk.seed})`;
}

/** createHash('sha256') against Node's digests, with collections forced
 * between updates (the copying collectors move the hash object and its
 * context buffer while no c-call is running). */
export function cryptoFixtureSource(): string {
  const cases = vectors
    .map(([label, chunks], index) => {
      const updates = chunks
        .map((chunk) => `  hash.update(${chunkSource(chunk)});\n  churn();`)
        .join("\n");
      return `{
  const hash = createHash(${index % 2 === 0 ? '"sha256"' : '"SHA256"'});
  churn();
${updates}
  const encoded = hash.digest(${JSON.stringify(index % 3 === 0 ? "base64" : index % 3 === 1 ? "hex" : "base64url")});
  if (encoded !== ${JSON.stringify(nodeDigest(chunks, index % 3 === 0 ? "base64" : index % 3 === 1 ? "hex" : "base64url"))}) return ${index + 1};
  // ${label}
}`;
    })
    .join("\n");
  const abcHex = nodeDigest(["abc"], "hex");
  const source = `import { createHash, createHmac, randomBytes } from "node:crypto";
function pattern(length: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (seed * 131 + i * 7 + (i >> 8)) & 255;
  return bytes;
}
let sink: number[][] = [];
/** Allocation pressure: several collections between updates. */
function churn(): void {
  for (let round = 0; round < 64; round++) {
    const values: number[] = [];
    for (let i = 0; i < 256; i++) values.push(round * i);
    sink.push(values);
    if (sink.length > 16) sink = [];
  }
}
function hexOf(bytes: Uint8Array): string {
  const digits = "0123456789abcdef";
  let text = "";
  for (let i = 0; i < bytes.length; i++)
    text += digits.charAt((bytes[i] ?? 0) >> 4) + digits.charAt((bytes[i] ?? 0) & 15);
  return text;
}
export function run(): number {
${cases}
  // digest() without an encoding returns the bytes.
  const bytes = createHash("sha256").update("abc").digest();
  if (typeof bytes === "string" || hexOf(bytes) !== ${JSON.stringify(abcHex)}) return 90;
  // Uint8Array updates (a subarray view too) hash like the string.
  const abc = new Uint8Array(5);
  abc[1] = 97; abc[2] = 98; abc[3] = 99;
  if (createHash("sha256").update(abc.subarray(1, 4)).digest("hex") !== ${JSON.stringify(abcHex)}) return 95;
  // Chaining returns the same hash. A finalized hash throws a coded Error
  // from either entry point.
  const hash = createHash("sha256");
  if (hash.update("a") !== hash) return 91;
  hash.digest("hex");
  function finalized(error: unknown): boolean {
    if (!(error instanceof Error) || error instanceof TypeError ||
        error.message !== "Digest already called") return false;
    return "code" in error && error.code === "ERR_CRYPTO_HASH_FINALIZED";
  }
  let twice = false;
  try { hash.digest("hex"); } catch (error) { twice = finalized(error); }
  if (!twice) return 92;
  let after = false;
  try { hash.update("b"); } catch (error) { after = finalized(error); }
  if (!after) return 93;
  let unsupported = false;
  try { createHash("tint-unknown-digest"); } catch (error) {
    unsupported = error instanceof Error && !(error instanceof TypeError) &&
      error.message === "Digest method not supported" && !("code" in error);
  }
  if (!unsupported) return 94;
  try {
    const sha512 = createHash("SHA512").update("abc").digest("hex");
    if (sha512 !== "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f") return 97;
  } catch (error) {
    if (error instanceof Error && error.message === "Digest method not supported") return 96;
    throw error;
  }
  const mac = createHmac("sha256", "key");
  if (mac.update("a") !== mac || mac.update("bc").digest("hex") !== "9c196e32dc0175f86f4b1cb89289d6619de6bee699e4c378e68309ed97a1a6ab") return 98;
  if (mac.digest("hex") !== "") return 99;
  if (randomBytes(0).length !== 0 || randomBytes(32.5).length !== 32) return 100;
  if (createHash("sha256").update("616263", "hex").digest("HEX") !== ${JSON.stringify(abcHex)}) return 101;
  const acrossSweep = createHash("sha256").update("a");
  for (let i = 0; i < 300; i++) createHash("sha256").update("temporary");
  churn();
  const sweep = createHash("sha256").digest("hex");
  if (typeof sweep !== "string") return 102;
  if (acrossSweep.update("bc").digest("hex") !== ${JSON.stringify(abcHex)}) return 103;
  return 42;
}
`;
  return source;
}
export function verifyCryptoFixture(): string {
  return verifyHostedFixture(
    cryptoFixtureSource(),
    "ffi-crypto",
    [["node:crypto", crypto]],
    [],
    [],
    [],
    {
      managedBytes: 8388608,
      allocationCapacity: 131072,
    },
  );
}

/** ABI probes over the C library: each call shape's values are observable
 * in the callee's behavior (snprintf reads variadic and stack slots back).
 * The complex-number functions are libm's: glibc ships them in libm.so.6,
 * Darwin re-exports them from libSystem (no extra load command). */
export const probeDeclarations: FixtureForeignDeclaration = {
  id: "fixture/probe.d.ts",
  text: `declare module "tint:c/libsystem" {
  import type { i8, i16, i32, u8, u16, i64, u64, usize, f32, f64, Ptr, CString, CStringBytes, Variadic, FixedArray } from "tint:ffi";
  export interface div_t { quot: i32; rem: i32 }
  export interface ldiv_t { quot: i64; rem: i64 }
  export interface Complex { re: f64; im: f64 }
  export interface Big { words: FixedArray<i64, 3> }
  export interface Pair16 { a: i64; b: i64 }
  export function getpid(): i32;
  export function abs(value: i32): i32;
  export function labs(value: i64): i64;
  export function strlen(text: CString): usize;
  export function strlen$bytes(text: CStringBytes): usize;
  export function atof(text: CString): f64;
  export function fabsf(value: f32): f32;
  export function toupper(c: i32): i32;
  export function div(numerator: i32, denominator: i32): div_t;
  export function ldiv(numerator: i64, denominator: i64): ldiv_t;
  export function memcpy$indirect(destination: Ptr<u8>, source: Big, count: usize): void;
  export function memset$narrow(destination: Ptr<u8>, value: i8, count: usize): void;
  export function snprintf$variadic(buffer: Ptr<u8>, size: usize, format: CString, a: Variadic<i32>, b: Variadic<f64>, c: Variadic<i64>, s: Variadic<CString>, f: Variadic<f32>, n: Variadic<i16>): i32;
  export function snprintf$packed(buffer: Ptr<u8>, size: usize, format: CString, x3: i64, x4: i64, x5: i64, x6: i64, x7: i64, s0: i32, s1: i32, s2: i16, s3: u16, s4: i32, s5: i64): i32;
  export function snprintf$composite(buffer: Ptr<u8>, size: usize, format: CString, x3: i64, x4: i64, x5: i64, x6: i64, x7: i64, pair: Pair16, after: u64): i32;
  export function snprintf$hfa(buffer: Ptr<u8>, size: usize, format: CString, d0: f64, d1: f64, d2: f64, d3: f64, d4: f64, d5: f64, d6: f64, d7: f64, z: Complex, single: f32): i32;
}
`,
};
export const probeMathDeclarations: FixtureForeignDeclaration = {
  id: "fixture/probe-math.d.ts",
  text: `declare module "tint:c/libm" {
  import type { f32, f64 } from "tint:ffi";
  export interface Complex { re: f64; im: f64 }
  export interface ComplexF { re: f32; im: f32 }
  export function cabs(z: Complex): f64;
  export function conj(z: Complex): Complex;
  export function conjf(z: ComplexF): ComplexF;
}
`,
  manifest: [
    {
      module: "tint:c/libm",
      darwin: {
        name: darwinSystemLibrary,
        optional: false,
        currentVersion: 0x10000,
        compatibilityVersion: 0x10000,
      },
      linux: {
        name: "libm.so.6",
        optional: false,
        currentVersion: 0,
        compatibilityVersion: 0,
      },
    },
  ],
};
/** What snprintf reads back after the register-file arguments, per C
 * target: Apple packs named stack arguments at natural alignment and passes
 * variadic arguments on the stack; AAPCS64 gives every stack argument an
 * 8-byte slot and passes variadic arguments in the registers first, so
 * va_arg reads the five X (or eight D) register arguments before the
 * stack. */
function stackProbes(darwin: boolean): {
  readonly packed: readonly [string, string];
  readonly composite: readonly [string, string];
  readonly hfa: readonly [string, string];
} {
  return darwin
    ? {
        // Two i32s share the first 8-byte slot, two i16s and an i32 the
        // second.
        packed: ["%lld %lld %lld", "8589934593 21475098627 -7"],
        composite: ["%lld %lld %llu", "-11 12 9007199254740991"],
        // The f32 after the HFA packs into the low half of a double slot.
        hfa: ["%.2f %.2f", "1.25 -3.50"],
      }
    : {
        // One slot each; narrow values are read at their own width (the
        // callee extends them).
        packed: [
          "%lld %lld %lld %lld %lld %d %d %hd %hu %d %lld",
          "0 0 0 0 0 1 2 3 4 5 -7",
        ],
        composite: [
          "%lld %lld %lld %lld %lld %lld %lld %llu",
          "0 0 0 0 0 -11 12 9007199254740991",
        ],
        hfa: [
          "%.0f%.0f%.0f%.0f%.0f%.0f%.0f%.0f %.2f %.2f",
          "00000000 1.25 -3.50",
        ],
      };
}
export function verifyAbiProbeFixture(): string {
  const probes = stackProbes(nativeFixtureTarget().os === "darwin");
  const source = `import {
  getpid, abs, labs, strlen, strlen$bytes, atof, fabsf, toupper, div, ldiv,
  memcpy$indirect, memset$narrow, snprintf$variadic, snprintf$packed, snprintf$composite, snprintf$hfa,
} from "probe";
import { cabs, conj, conjf } from "probe-math";
function text(buffer: Uint8Array, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(buffer[i] ?? 0);
  return out;
}
export function run(): number {
  if (getpid() <= 0) return 1;
  if (abs(-5) !== 5 || labs(-4000000000) !== 4000000000) return 2;
  if (strlen("héllo") !== 6) return 3;
  const terminated = new Uint8Array(4);
  terminated[0] = 65; terminated[1] = 66;
  if (strlen$bytes(terminated) !== 2) return 4;
  if (atof("2.5e3") !== 2500) return 5;
  // KNOWN DEFECT: literal Math.fround results; typed code lacks Math.fround.
  if (fabsf(-1.1) !== 1.100000023841858) return 6;
  if (toupper(97) !== 65) return 7;
  const q = div(17, 5);
  if (q.quot !== 3 || q.rem !== 2) return 8;
  const l = ldiv(-9000000000, 7);
  if (l.quot !== -1285714285 || l.rem !== -5) return 9;
  if (cabs({ re: 3, im: 4 }) !== 5) return 10;
  const c = conj({ re: 1.5, im: -2.25 });
  if (c.re !== 1.5 || c.im !== 2.25) return 11;
  const f = conjf({ re: 0.1, im: 0.2 });
  if (f.re !== 0.10000000149011612 || f.im !== -0.20000000298023224) return 12;
  // A 24-byte record passes a pointer to a caller copy: memcpy copies it.
  const copy = new Uint8Array(24);
  memcpy$indirect(copy, { words: [0x0102030405, -2, 9007199254740991] }, 24);
  if (copy[0] !== 5 || copy[4] !== 1 || copy[8] !== 254 || copy[15] !== 255 || copy[16] !== 255 || copy[22] !== 31 || copy[23] !== 0) return 13;
  // Narrow arguments arrive extended (memset reads an int).
  const filled = new Uint8Array(3);
  memset$narrow(filled, -1, 3);
  if (filled[0] !== 255 || filled[2] !== 255) return 14;
  const buffer = new Uint8Array(128);
  // Variadic arguments of every class (f32 promoted to double, i16 to int):
  // on the stack in 8-byte slots (Apple) or in registers (AAPCS64).
  let n = snprintf$variadic(buffer, 128, "%d %.3f %lld %s %.2f %d", -7, 2.5, 123456789012, "ok", 0.25, -300);
  if (text(buffer, n) !== "-7 2.500 123456789012 ok 0.25 -300") return 20;
  // Named stack arguments after the X registers are used up.
  n = snprintf$packed(buffer, 128, ${JSON.stringify(probes.packed[0])}, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, -7);
  if (text(buffer, n) !== ${JSON.stringify(probes.packed[1])}) return 21;
  // With the X registers used up, a 16-byte record goes wholly to the stack.
  n = snprintf$composite(buffer, 128, ${JSON.stringify(probes.composite[0])}, 0, 0, 0, 0, 0, { a: -11, b: 12 }, 9007199254740991);
  if (text(buffer, n) !== ${JSON.stringify(probes.composite[1])}) return 22;
  // With d0-d7 used up, an HFA goes wholly to the stack, then an f32.
  n = snprintf$hfa(buffer, 128, ${JSON.stringify(probes.hfa[0])}, 0, 0, 0, 0, 0, 0, 0, 0, { re: 1.25, im: -3.5 }, 0);
  if (text(buffer, n) !== ${JSON.stringify(probes.hfa[1])}) return 23;
  return 42;
}
`;
  return verifyHostedFixture(
    source,
    "ffi-abi-probes",
    [
      ["probe", probeDeclarations.id],
      ["probe-math", probeMathDeclarations.id],
    ],
    [],
    [],
    [],
    {
      managedBytes: 4194304,
      allocationCapacity: 65536,
      foreignDeclarations: [probeDeclarations, probeMathDeclarations],
    },
  );
}

/** External storage and raw addresses (docs/native-ffi.md, "External
 * storage"), with members read and written through C views. */
export const storageDeclarations: FixtureForeignDeclaration = {
  id: "fixture/storage.d.ts",
  text: `declare module "tint:c/libsystem" {
  import type { i8, u8, i16, u16, i32, u32, i64, u64, f32, f64, bool, char, usize, Ptr, Address, Layout, Packed } from "tint:ffi";
  export interface Probe extends Packed { a: u8; b: i32; c: Address<u8>; d: f64; e: i16; f: f32; g: bool; h: i64; k: u64 }
  export const Probe: Layout<Probe>;
  export interface Natural { a: u8; b: i32; c: Address<u8>; d: f64; e: i16; f: f32; g: bool; h: i64; k: u64; s: i8; u: u16 }
  export const Natural: Layout<Natural>;
  /** The mapping granule external storage aligns to. */
  export function getpagesize(): i32;
  /** A pointer result and pointer arguments (raw addresses). */
  export function strchr(text: Address<char>, c: i32): Address<char>;
  export function strlen(text: Address<char>): usize;
  export function memchr(bytes: Ptr<u8>, c: i32, n: usize): Address<u8>;
}
`,
};
export function verifyStorageFixture(): string {
  const source = `import { allocate, release, address, external } from "tint:ffi";
import { cStringAt } from "tint:ffi/unsafe";
import { externalBytes } from "ffi-internal";
import { Natural, Probe, getpagesize, strchr, strlen, memchr } from "storage";
let sink: number[][] = [];
function churn(): void {
  for (let round = 0; round < 64; round++) {
    const values: number[] = [];
    for (let i = 0; i < 256; i++) values.push(round * i);
    sink.push(values);
    if (sink.length > 16) sink = [];
  }
}
function throwsType(f: () => void): boolean {
  try { f(); } catch (error) { return error instanceof TypeError; }
  return false;
}
function dropped(count: number): number {
  // Collector-registered storage nobody keeps: sweeps unmap it.
  let total = 0;
  for (let i = 0; i < count; i++) {
    const view = external(1048576);
    view[i % 1048576] = 1;
    total += view.length;
  }
  return total;
}
export function run(): number {
  if (Natural.size !== 64 || Natural.offsets.c !== 8 || Natural.offsets.u !== 58) return 1;
  // Every scalar kind at its C offset, through views of external storage
  // and of an ordinary movable array alike (churn moves the latter).
  const record = allocate(Natural.size);
  const plain = new Uint8Array(Natural.size);
  const views = [record, plain];
  for (let v = 0; v < views.length; v++) {
    const bytes = views[v];
    if (bytes === undefined) return 2;
    const r = Natural.view(bytes);
    r.a = 255; r.b = -2147483648; r.d = -0.125;
    r.e = -32768; r.f = 1.1; r.g = true;
    r.h = -9007199254740991; r.k = 18446744073709549568;
    churn();
    if (r.a !== 255 || r.b !== -2147483648 || r.d !== -0.125) return 3;
    if (r.e !== -32768 || r.f !== 1.100000023841858 || r.g !== true) return 4;
    if (r.h !== -9007199254740991 || r.k !== 18446744073709549568) return 5;
    // Little-endian bytes at the declared offsets.
    if (bytes[0] !== 255 || bytes[4] !== 0 || bytes[7] !== 128 || bytes[23] !== 191 || bytes[24] !== 0 || bytes[25] !== 128 || bytes[31] !== 63 || bytes[32] !== 1) return 6;
    if (bytes[40] !== 1 || bytes[46] !== 224 || bytes[47] !== 255 || bytes[48] !== 0 || bytes[49] !== 248 || bytes[55] !== 255 || bytes[56] !== 0) return 7;
    bytes[56] = 200; bytes[58] = 0x34; bytes[59] = 0x12;
    if (r.s !== -56 || r.u !== 0x1234) return 8;
    r.g = false;
    if (r.g !== false) return 9;
  }
  // Raw addresses: exact above 2^53 (2^60, 2^63 + 2^11), C's own pointers
  // round-trip, pointer results and arguments.
  const natural = Natural.view(record);
  natural.c = 1152921504606846976;
  if (natural.c !== 1152921504606846976 || record[15] !== 16) return 10;
  natural.c = 9223372036854777856;
  if (natural.c !== 9223372036854777856 || record[15] !== 128 || record[9] !== 8) return 11;
  const text = allocate(16);
  text[0] = 104; text[1] = 105; text[2] = 33;
  const at = address(text);
  // Whole pages of the kernel's size (16 KiB on Apple arm64; 4, 16 or
  // 64 KiB on Linux arm64).
  const page = getpagesize();
  if (page < 4096 || at <= 0 || at % page !== 0) return 12;
  natural.c = at;
  if (strlen(natural.c) !== 3 || cStringAt(natural.c) !== "hi!") return 13;
  if (strchr(at, 105) !== at + 1 || strchr(at, 120) !== 0) return 14;
  if (memchr(text, 33, 16) !== at + 2) return 15;
  // Packed records place members without padding.
  const packed = Probe.view(allocate(Probe.size));
  packed.c = at;
  if (Probe.size !== 44 || packed.c !== at || packed.k !== 0) return 16;
  // Explicit lifetime: release once, then the storage is gone.
  release(text);
  if (!throwsType(() => release(text))) return 17;
  if (!throwsType(() => { address(text); })) return 18;
  if (!throwsType(() => { address(plain); })) return 19;
  if (!throwsType(() => { address(record.subarray(1)); })) return 20;
  release(record);
  // Collector-registered storage: 512 MiB of dropped 1 MiB views stay
  // bounded by external memory pressure (forced collections and sweeps).
  const before = externalBytes();
  if (dropped(512) !== 536870912) return 21;
  if (externalBytes() - before > 201326592) return 22;
  // A registered view that stays reachable survives sweeps.
  const kept = external(64);
  kept[63] = 7;
  dropped(256);
  if (kept[63] !== 7) return 23;
  release(kept);
  return 42;
}
`;
  return verifyHostedFixture(
    source,
    "ffi-storage",
    [
      ["tint:ffi", "packages/native-runtime/src/ffi/index.ts"],
      ["tint:ffi/unsafe", "packages/native-runtime/src/ffi/unsafe.ts"],
      ["ffi-internal", "packages/native-runtime/src/ffi/index.ts"],
      ["storage", storageDeclarations.id],
    ],
    [],
    [],
    [],
    {
      managedBytes: 8388608,
      allocationCapacity: 131072,
      foreignDeclarations: [storageDeclarations],
    },
  );
}

/** C views (docs/native-ffi.md, "C views"): nested records, fixed arrays,
 * unions, member contracts, compound assignment forms, annotations and
 * views passed to C, over heap arrays that collections move. */
export const viewDeclarations: FixtureForeignDeclaration = {
  id: "fixture/views.d.ts",
  text: `declare module "tint:c/libsystem" {
  import type { i8, u8, i16, u16, i32, u32, i64, u64, f32, f64, bool, usize, Ptr, Address, Layout, FixedArray, Union } from "tint:ffi";
  export interface Point { x: i32; y: i32 }
  export interface Number32 extends Union { i: i32; u: u32; f: f32; bytes: FixedArray<u8, 4> }
  export interface Outer {
    tag: u8;
    origin: Point;
    words: FixedArray<u32, 4>;
    points: FixedArray<Point, 3>;
    grid: FixedArray<FixedArray<i16, 3>, 2>;
    value: Number32;
    big: u64;
    signed: i64;
    small: i8;
    flag: bool;
    ratio: f64;
    next: Address<Outer>;
  }
  export const Outer: Layout<Outer>;
  export const Point: Layout<Point>;
  export function memcpy$outer(destination: Ptr<Outer>, source: Ptr<Outer>, count: usize): Address<Outer>;
  export function memset$point(destination: Ptr<Point>, value: i32, count: usize): Address<Point>;
}
`,
};
export function verifyViewFixture(): string {
  const source = `import { type View } from "tint:ffi";
import { Outer, Point, memcpy$outer, memset$point } from "views";
let sink: number[][] = [];
function churn(): void {
  for (let round = 0; round < 64; round++) {
    const values: number[] = [];
    for (let i = 0; i < 256; i++) values.push(round * i);
    sink.push(values);
    if (sink.length > 16) sink = [];
  }
}
function throwsType(f: () => void): boolean {
  try { f(); } catch (error) { return error instanceof TypeError; }
  return false;
}
function throwsRange(f: () => void): boolean {
  try { f(); } catch (error) { return error instanceof RangeError; }
  return false;
}
/** Annotated views as parameters and results. */
function origin(outer: View<Outer>): View<Point> {
  return outer.origin;
}
function sum(point: View<Point>): number {
  return point.x + point.y;
}
function total(outer: View<Outer>): number {
  let result = 0;
  for (let i = 0; i < outer.words.length; i++) result += outer.words[i] ?? 0;
  return result;
}
export function run(): number {
  if (Outer.size !== 112 || Point.size !== 8) return 1;
  // A heap array: collections move it between accesses.
  const bytes = new Uint8Array(Outer.size + 8);
  const outer = Outer.view(bytes);
  outer.tag = 9;
  outer.origin.x = -5;
  outer.origin.y = 12;
  churn();
  if (bytes[0] !== 9 || bytes[4] !== 251 || bytes[7] !== 255 || bytes[8] !== 12) return 2;
  if (outer.origin.x !== -5 || sum(origin(outer)) !== 7) return 3;
  // A nested view is a view of the same bytes.
  const point = outer.origin;
  point.y = 30;
  churn();
  if (outer.origin.y !== 30 || bytes[8] !== 30) return 4;
  // Fixed arrays: elements, length, records and arrays of arrays.
  for (let i = 0; i < 4; i++) outer.words[i] = 1000 * (i + 1);
  if (outer.words.length !== 4 || total(outer) !== 10000 || bytes[12] !== 232 || bytes[13] !== 3) return 5;
  for (let i = 0; i < 3; i++) {
    outer.points[i].x = i;
    outer.points[i].y = -i;
  }
  churn();
  if (outer.points[2].x !== 2 || outer.points[2].y !== -2 || bytes[44] !== 2 || bytes[48] !== 254) return 6;
  outer.grid[1][2] = -300;
  if (outer.grid[1][2] !== -300 || outer.grid[0][0] !== 0 || bytes[62] !== 212 || bytes[63] !== 254) return 7;
  // Out-of-range or non-integer indexes throw RangeError, reading or writing.
  if (!throwsRange(() => { outer.words[4]; })) return 8;
  if (!throwsRange(() => { outer.words[-1] = 1; })) return 9;
  if (!throwsRange(() => { outer.words[1.5]; })) return 10;
  if (!throwsRange(() => { outer.points[3].x = 1; })) return 11;
  if (!throwsRange(() => { outer.grid[0][3]; })) return 12;
  // The inner index of an element of an element is checked too, though the
  // row it names would still lie inside the bytes.
  if (!throwsRange(() => { outer.grid[2][0]; })) return 39;
  if (!throwsRange(() => { outer.grid[0.5][0] = 1; })) return 40;
  // Unions overlay their members.
  outer.value.f = 1;
  if (outer.value.u !== 1065353216 || outer.value.bytes[3] !== 63) return 13;
  outer.value.i = -1;
  if (outer.value.u !== 4294967295 || outer.value.bytes[0] !== 255) return 14;
  // Member contracts: integers and addresses must be exact and in range;
  // a rejected write leaves the member unchanged.
  outer.tag = 7;
  if (!throwsType(() => { outer.tag = 256; }) || outer.tag !== 7) return 15;
  if (!throwsType(() => { outer.tag = -1; }) || outer.tag !== 7) return 16;
  if (!throwsType(() => { outer.origin.x = 1.5; }) || outer.origin.x !== -5) return 17;
  if (!throwsType(() => { outer.origin.x = 2147483648; })) return 18;
  if (!throwsType(() => { outer.words[0] = -1; }) || outer.words[0] !== 1000) return 19;
  if (!throwsType(() => { outer.big = 18446744073709551616; })) return 20;
  if (!throwsType(() => { outer.signed = 9223372036854775808; })) return 21;
  if (!throwsType(() => { outer.small = NaN; })) return 22;
  if (!throwsType(() => { outer.next = -8; })) return 23;
  outer.big = 18446744073709549568;
  outer.signed = -9223372036854775808;
  outer.small = -128;
  if (outer.big !== 18446744073709549568 || outer.signed !== -9223372036854775808 || outer.small !== -128) return 24;
  // f32 rounds; f64 and bool take any value of their type.
  outer.value.f = 0.1;
  if (outer.value.f !== 0.10000000149011612) return 25;
  outer.ratio = NaN;
  if (outer.ratio === outer.ratio) return 26;
  // Compound assignment, updates and logical assignment.
  outer.origin.x = 10;
  outer.origin.x += 5;
  outer.origin.x *= 2;
  if (outer.origin.x !== 30) return 27;
  const post = outer.origin.x++;
  const pre = ++outer.origin.x;
  if (post !== 30 || pre !== 32 || outer.origin.x !== 32) return 28;
  outer.words[3]--;
  if (outer.words[3] !== 3999) return 29;
  outer.tag = 255;
  if (!throwsType(() => { outer.tag++; }) || outer.tag !== 255) return 30;
  outer.flag = false;
  outer.flag ||= true;
  if (outer.flag !== true) return 31;
  outer.flag &&= false;
  if (outer.flag !== false) return 32;
  outer.origin.y = 0;
  outer.origin.y ||= 4;
  outer.origin.y &&= 6;
  outer.origin.y ??= 99;
  if (outer.origin.y !== 6) return 33;
  // Views pass to C as Ptr<R>.
  const copy = Outer.view(new Uint8Array(Outer.size));
  memcpy$outer(copy, outer, Outer.size);
  if (copy.origin.x !== 32 || copy.points[1].y !== -1 || copy.grid[1][2] !== -300) return 34;
  memset$point(copy.origin, 0, Point.size);
  if (copy.origin.x !== 0 || copy.origin.y !== 0 || copy.tag !== 255) return 35;
  // Creating a view checks the bytes hold the record.
  if (!throwsRange(() => { Outer.view(new Uint8Array(Outer.size - 1)); })) return 36;
  const small = Point.view(bytes.subarray(4, 12));
  if (small.x !== 32 || small.y !== 6) return 37;
  churn();
  if (outer.origin.y !== 6 || copy.ratio === copy.ratio) return 38;
  return 42;
}
`;
  return verifyHostedFixture(
    source,
    "ffi-views",
    [
      ["tint:ffi", "packages/native-runtime/src/ffi/index.ts"],
      ["views", viewDeclarations.id],
    ],
    [],
    [],
    [],
    {
      managedBytes: 4194304,
      allocationCapacity: 65536,
      foreignDeclarations: [viewDeclarations],
    },
  );
}

/** Foreign memory (docs/native-ffi.md, "Foreign memory"): views over
 * memory C owns through `tint:ffi/unsafe` (records and arrays of them at
 * addresses, raw bytes, C strings), linked lists through Address members,
 * the creation contracts and member contracts, across collections. */
export const foreignDeclarations: FixtureForeignDeclaration = {
  id: "fixture/foreign.d.ts",
  text: `declare module "tint:c/libsystem" {
  import type { i32, u16, f64, char, usize, Ptr, Address, Layout } from "tint:ffi";
  export interface Node { value: i32; weight: f64; next: Address<Node>; label: Address<char> }
  export const Node: Layout<Node>;
  export interface Pair { a: u16; b: u16 }
  export const Pair: Layout<Pair>;
  /** C-owned memory: the C library's static message text. */
  export function strerror(code: i32): Address<char>;
  export function strchr(text: Address<char>, c: i32): Address<char>;
  export function memcpy$node(destination: Ptr<Node>, source: Ptr<Node>, count: usize): Address<Node>;
}
`,
};
export function verifyForeignFixture(): string {
  const source = `import { allocate, release, address, type View } from "tint:ffi";
import { viewAt, arrayAt, bytesAt, cStringAt } from "tint:ffi/unsafe";
import { Node, Pair, strerror, strchr, memcpy$node } from "foreign";
let sink: number[][] = [];
function churn(): void {
  for (let round = 0; round < 64; round++) {
    const values: number[] = [];
    for (let i = 0; i < 256; i++) values.push(round * i);
    sink.push(values);
    if (sink.length > 16) sink = [];
  }
}
function throwsType(f: () => void): boolean {
  try { f(); } catch (error) { return error instanceof TypeError; }
  return false;
}
function throwsRange(f: () => void): boolean {
  try { f(); } catch (error) { return error instanceof RangeError; }
  return false;
}
/** Walks a C linked list through its Address members. */
function sumList(head: number): number {
  let total = 0;
  for (let at = head; at !== 0; ) {
    const node = viewAt(Node, at);
    total += node.value;
    at = node.next;
  }
  return total;
}
function weight(node: View<Node>): number {
  return node.weight;
}
export function run(): number {
  if (Node.size !== 32 || Pair.size !== 4) return 1;
  // Memory handed over by address only (external storage stands in for a
  // C library's allocation; the views know nothing but the address).
  const block = allocate(Node.size * 3 + 16);
  const base = address(block), labels = base + Node.size * 3;
  block[Node.size * 3] = 97; block[Node.size * 3 + 1] = 98;
  const nodes: View<Node>[] = arrayAt(Node, base, 3);
  if (nodes.length !== 3) return 2;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node === undefined) return 3;
    node.value = (i + 1) * 10;
    node.weight = i + 0.5;
    node.next = i < 2 ? base + (i + 1) * Node.size : 0;
    node.label = labels + i;
  }
  churn();
  if (sumList(base) !== 60) return 4;
  const head = viewAt(Node, base), second = viewAt(Node, head.next);
  if (second.value !== 20 || weight(second) !== 1.5) return 5;
  // Writes reach C's bytes at the declared offsets.
  second.value = -7;
  if (block[Node.size] !== 249 || block[Node.size + 3] !== 255) return 6;
  if (cStringAt(head.label) !== "ab" || cStringAt(second.label) !== "b") return 7;
  // Raw bytes and views of the same memory agree.
  const raw = bytesAt(base, Node.size);
  if (raw.length !== Node.size || raw[0] !== 10) return 8;
  raw[0] = 11;
  if (head.value !== 11 || viewAt(Pair, base).a !== 11) return 9;
  // Memory the C library owns: ENOENT's message (the same text in
  // libSystem and glibc).
  const message = strerror(2), name = cStringAt(message);
  if (name !== "No such file or directory") return 10;
  const nameBytes = bytesAt(message, name.length + 1);
  if (nameBytes[name.length] !== 0) return 11;
  if (strchr(message, nameBytes[0] ?? 0) !== message) return 12;
  // Foreign views pass to C as Ptr<R>.
  const copy = Node.view(new Uint8Array(Node.size));
  memcpy$node(copy, head, Node.size);
  if (copy.value !== 11 || copy.next !== base + Node.size) return 13;
  // Creation contracts: null or inexact addresses are TypeErrors, bad
  // lengths and counts RangeErrors.
  if (!throwsType(() => { viewAt(Node, 0); })) return 14;
  if (!throwsType(() => { bytesAt(0, 1); })) return 15;
  if (!throwsType(() => { cStringAt(0); })) return 16;
  if (!throwsType(() => { bytesAt(1.5, 1); })) return 17;
  if (!throwsType(() => { arrayAt(Node, 0, 0); })) return 18;
  if (!throwsType(() => { viewAt(Node, -16); })) return 19;
  if (!throwsRange(() => { bytesAt(base, -1); })) return 20;
  if (!throwsRange(() => { bytesAt(base, 0.5); })) return 21;
  if (!throwsRange(() => { arrayAt(Node, base, -1); })) return 22;
  if (!throwsRange(() => { arrayAt(Node, base, 134217728); })) return 23;
  if (!throwsRange(() => { bytesAt(18446744073709549568, 4096); })) return 24;
  if (arrayAt(Node, base, 0).length !== 0 || bytesAt(base, 0).length !== 0) return 25;
  // Member contracts are unchanged.
  if (!throwsType(() => { head.value = 2147483648; }) || head.value !== 11) return 26;
  // Foreign memory is C's: no release, no address.
  if (!throwsType(() => release(raw))) return 27;
  if (!throwsType(() => { address(head); })) return 28;
  // The data never moves: views stay valid across collections.
  churn();
  if (head.value !== 11 || sumList(base) !== 34 || nodes[2]?.label !== labels + 2) return 29;
  release(block);
  return 42;
}
`;
  return verifyHostedFixture(
    source,
    "ffi-foreign",
    [
      ["tint:ffi", "packages/native-runtime/src/ffi/index.ts"],
      ["tint:ffi/unsafe", "packages/native-runtime/src/ffi/unsafe.ts"],
      ["foreign", foreignDeclarations.id],
    ],
    [],
    [],
    [],
    {
      managedBytes: 4194304,
      allocationCapacity: 65536,
      foreignDeclarations: [foreignDeclarations],
    },
  );
}

/** Optional libraries (docs/native-ffi.md, "Optional libraries"):
 * availability queries and calls for an absent library and a present one
 * with a present and a missing symbol: weak imports on Darwin, dlopen at
 * first use on Linux. */
const optionalImage = (name: string) => ({
  name,
  optional: true,
  currentVersion: 0x10000,
  compatibilityVersion: 0x10000,
});
export const absentDeclarations: FixtureForeignDeclaration = {
  id: "fixture/absent.d.ts",
  text: `declare module "tint:c/tint-absent" {
  import type { i32, Available } from "tint:ffi";
  export function tint_absent_symbol(value: i32): i32;
  export function hasAbsentSymbol(): Available<"tint_absent_symbol">;
}
`,
  manifest: [
    {
      module: "tint:c/tint-absent",
      darwin: optionalImage("/usr/lib/libtint-absent.dylib"),
      linux: optionalImage("libtint-absent.so.1"),
    },
  ],
};
export const presentDeclarations: FixtureForeignDeclaration = {
  id: "fixture/present.d.ts",
  text: `declare module "tint:c/optional-z" {
  import type { char, u8, u32, u64, i32, Ptr, Address, Available } from "tint:ffi";
  export function zlibVersion(): Address<char>;
  export function hasZlibVersion(): Available<"zlibVersion">;
  export function crc32(crc: u64, bytes: Ptr<u8>, length: u32): u64;
  export function hasCrc32(): Available<"crc32">;
  export function tint_missing_in_z(value: i32): i32;
  export function hasMissingInZ(): Available<"tint_missing_in_z">;
}
`,
  manifest: [
    {
      module: "tint:c/optional-z",
      darwin: optionalImage("/usr/lib/libz.1.dylib"),
      linux: optionalImage("libz.so.1"),
    },
  ],
};
export function verifyAvailabilityFixture(): string {
  // Calling an absent function jumps to 0 on Darwin (a weak import), so
  // only Linux, which resolves lazily, checks that such calls throw.
  const lazy = nativeFixtureTarget().os !== "darwin";
  const source = `import { tint_absent_symbol, hasAbsentSymbol } from "absent";
import { zlibVersion, hasZlibVersion, crc32, hasCrc32, tint_missing_in_z, hasMissingInZ } from "present";
function throwsType(f: () => void): boolean {
  try { f(); } catch (error) { return error instanceof TypeError; }
  return false;
}
/** Calls the absent function only when it is bound. */
function guarded(value: number): number {
  return hasAbsentSymbol() ? tint_absent_symbol(value) : -value;
}
export function run(): number {
  if (hasAbsentSymbol()) return 1;
  if (!hasZlibVersion()) return 2;
  if (zlibVersion() === 0) return 3;
  let total = 0;
  for (let i = 0; i < 1000; i++) total += guarded(i);
  if (total !== -499500) return 4;
  // A present library's functions, with arguments, and a missing symbol.
  if (!hasCrc32() || hasMissingInZ()) return 5;
  const abc = new Uint8Array(3);
  abc[0] = 97; abc[1] = 98; abc[2] = 99;
  if (crc32(0, abc, 3) !== 891568578) return 6;
  ${
    lazy
      ? `if (!throwsType(() => { tint_absent_symbol(1); })) return 7;
  if (!throwsType(() => { tint_missing_in_z(1); })) return 8;
  if (hasAbsentSymbol() || hasMissingInZ() || crc32(0, abc, 3) !== 891568578) return 9;`
      : ""
  }
  return 42;
}
`;
  return verifyHostedFixture(
    source,
    "ffi-availability",
    [
      ["absent", absentDeclarations.id],
      ["present", presentDeclarations.id],
    ],
    [],
    [],
    [],
    {
      managedBytes: 4194304,
      allocationCapacity: 65536,
      foreignDeclarations: [absentDeclarations, presentDeclarations],
    },
  );
}
