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
  const source = `import { createHash } from "node:crypto";
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
  // Chaining returns the same hash; digesting twice or updating after a
  // digest throws "Digest already called". KNOWN DEFECT: Node throws Error
  // and the message is not checked, because typed code cannot construct
  // Error or read a caught error's message (docs/native-ffi.md).
  const hash = createHash("sha256");
  if (hash.update("a") !== hash) return 91;
  hash.digest("hex");
  let twice = "";
  try { hash.digest("hex"); } catch (error) { if (error instanceof TypeError) twice = "thrown"; }
  if (twice !== "thrown") return 92;
  let after = "";
  try { hash.update("b"); } catch (error) { if (error instanceof TypeError) after = "thrown"; }
  if (after !== "thrown") return 93;
  let unsupported = "";
  try { createHash("md4"); } catch (error) { if (error instanceof TypeError) unsupported = "thrown"; }
  if (unsupported !== "thrown") return 94;
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
    { managedBytes: 8388608, allocationCapacity: 131072 },
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

/** External storage, raw addresses and Field accessors (docs/native-ffi.md,
 * "External storage"). */
export const storageDeclarations: FixtureForeignDeclaration = {
  id: "fixture/storage.d.ts",
  text: `declare module "tint:c/libsystem" {
  import type { i8, u8, i16, u16, i32, u32, i64, u64, f32, f64, bool, char, usize, Ptr, Address, Field, Layout } from "tint:ffi";
  export interface Probe extends Packed { a: u8; b: i32; c: Address<u8>; d: f64; e: i16; f: f32; g: bool; h: i64; k: u64 }
  export interface Natural { a: u8; b: i32; c: Address<u8>; d: f64; e: i16; f: f32; g: bool; h: i64; k: u64; s: i8; u: u16 }
  export const Natural: Layout<Natural>;
  export function Natural$a(r: Ptr<Natural>): Field<Natural, "a">;
  export function Natural$set$a(r: Ptr<Natural>, v: Field<Natural, "a">): void;
  export function Natural$b(r: Ptr<Natural>): Field<Natural, "b">;
  export function Natural$set$b(r: Ptr<Natural>, v: Field<Natural, "b">): void;
  export function Natural$c(r: Ptr<Natural>): Field<Natural, "c">;
  export function Natural$set$c(r: Ptr<Natural>, v: Field<Natural, "c">): void;
  export function Natural$d(r: Ptr<Natural>): Field<Natural, "d">;
  export function Natural$set$d(r: Ptr<Natural>, v: Field<Natural, "d">): void;
  export function Natural$e(r: Ptr<Natural>): Field<Natural, "e">;
  export function Natural$set$e(r: Ptr<Natural>, v: Field<Natural, "e">): void;
  export function Natural$f(r: Ptr<Natural>): Field<Natural, "f">;
  export function Natural$set$f(r: Ptr<Natural>, v: Field<Natural, "f">): void;
  export function Natural$g(r: Ptr<Natural>): Field<Natural, "g">;
  export function Natural$set$g(r: Ptr<Natural>, v: Field<Natural, "g">): void;
  export function Natural$h(r: Ptr<Natural>): Field<Natural, "h">;
  export function Natural$set$h(r: Ptr<Natural>, v: Field<Natural, "h">): void;
  export function Natural$k(r: Ptr<Natural>): Field<Natural, "k">;
  export function Natural$set$k(r: Ptr<Natural>, v: Field<Natural, "k">): void;
  export function Natural$s(r: Ptr<Natural>): Field<Natural, "s">;
  export function Natural$u(r: Ptr<Natural>): Field<Natural, "u">;
  export function Probe$c(r: Ptr<Probe>): Field<Probe, "c">;
  export function Probe$set$c(r: Ptr<Probe>, v: Field<Probe, "c">): void;
  export function Probe$k(r: Ptr<Probe>): Field<Probe, "k">;
  /** The mapping granule external storage aligns to. */
  export function getpagesize(): i32;
  /** A pointer result and pointer arguments (raw addresses). */
  export function strchr(text: Address<char>, c: i32): Address<char>;
  export function strlen(text: Address<char>): usize;
  export function memchr(bytes: Ptr<u8>, c: i32, n: usize): Address<u8>;
}
`
    .replace("u64, f32", "u64, f32")
    .replace("Layout }", "Layout, Packed }"),
};
export function verifyStorageFixture(): string {
  const source = `import { allocate, release, address, cString } from "tint:ffi";
import { external } from "tint:ffi/collected";
import { externalBytes } from "ffi-internal";
import {
  Natural, Natural$a, Natural$set$a, Natural$b, Natural$set$b, Natural$c, Natural$set$c,
  Natural$d, Natural$set$d, Natural$e, Natural$set$e, Natural$f, Natural$set$f,
  Natural$g, Natural$set$g, Natural$h, Natural$set$h, Natural$k, Natural$set$k,
  Natural$s, Natural$u, Probe$c, Probe$set$c, Probe$k, getpagesize, strchr, strlen, memchr,
} from "storage";
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
  // Field accessors: every scalar kind at its C offset (external storage
  // and an ordinary movable array alike; a leaf access cannot see a move).
  const record = allocate(Natural.size);
  const plain = new Uint8Array(Natural.size);
  const views = [record, plain];
  for (let v = 0; v < views.length; v++) {
    const r = views[v];
    if (r === undefined) return 2;
    Natural$set$a(r, 255); Natural$set$b(r, -2147483648); Natural$set$d(r, -0.125);
    Natural$set$e(r, -32768); Natural$set$f(r, 1.1); Natural$set$g(r, true);
    Natural$set$h(r, -9007199254740991); Natural$set$k(r, 18446744073709549568);
    churn();
    if (Natural$a(r) !== 255 || Natural$b(r) !== -2147483648 || Natural$d(r) !== -0.125) return 3;
    if (Natural$e(r) !== -32768 || Natural$f(r) !== 1.100000023841858 || Natural$g(r) !== true) return 4;
    if (Natural$h(r) !== -9007199254740991 || Natural$k(r) !== 18446744073709549568) return 5;
    // Little-endian bytes at the declared offsets.
    if (r[0] !== 255 || r[4] !== 0 || r[7] !== 128 || r[23] !== 191 || r[24] !== 0 || r[25] !== 128 || r[31] !== 63 || r[32] !== 1) return 6;
    if (r[40] !== 1 || r[46] !== 224 || r[47] !== 255 || r[48] !== 0 || r[49] !== 248 || r[55] !== 255 || r[56] !== 0) return 7;
    r[56] = 200; r[58] = 0x34; r[59] = 0x12;
    if (Natural$s(r) !== -56 || Natural$u(r) !== 0x1234) return 8;
    Natural$set$g(r, false);
    if (Natural$g(r) !== false) return 9;
  }
  // Raw addresses: exact above 2^53 (2^60, 2^63 + 2^11), C's own pointers
  // round-trip, pointer results and arguments.
  Natural$set$c(record, 1152921504606846976);
  if (Natural$c(record) !== 1152921504606846976 || record[15] !== 16) return 10;
  Natural$set$c(record, 9223372036854777856);
  if (Natural$c(record) !== 9223372036854777856 || record[15] !== 128 || record[9] !== 8) return 11;
  const text = allocate(16);
  text[0] = 104; text[1] = 105; text[2] = 33;
  const at = address(text);
  // Whole pages of the kernel's size (16 KiB on Apple arm64; 4, 16 or
  // 64 KiB on Linux arm64).
  const page = getpagesize();
  if (page < 4096 || at <= 0 || at % page !== 0) return 12;
  Natural$set$c(record, at);
  if (strlen(Natural$c(record)) !== 3 || cString(Natural$c(record)) !== "hi!") return 13;
  if (strchr(at, 105) !== at + 1 || strchr(at, 120) !== 0) return 14;
  if (memchr(text, 33, 16) !== at + 2) return 15;
  // Packed records place members without padding.
  const packed = allocate(44);
  Probe$set$c(packed, at);
  if (Probe$c(packed) !== at || Probe$k(packed) !== 0) return 16;
  // Explicit lifetime: release once, then the storage is gone.
  release(text);
  if (!throwsType(() => release(text))) return 17;
  if (!throwsType(() => { address(text); })) return 18;
  if (!throwsType(() => { address(plain); })) return 19;
  if (!throwsType(() => { address(record.subarray(1)); })) return 20;
  release(record);
  release(packed);
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
      ["tint:ffi/collected", "packages/native-runtime/src/ffi/collected.ts"],
      ["ffi-internal", "packages/native-runtime/src/ffi/index.ts"],
      ["storage", storageDeclarations.id],
    ],
    [],
    [],
    [],
    {
      runtimeEntry: "initializeCopyingRuntime",
      managedBytes: 8388608,
      allocationCapacity: 131072,
      foreignDeclarations: [storageDeclarations],
    },
  );
}
