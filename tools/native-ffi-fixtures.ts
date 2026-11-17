// Native FFI fixtures (docs/native-ffi.md): direct leaf c-calls through
// `tint:c/...` binding declarations, checked by native execution.
import { createHash } from "node:crypto";
import {
  verifyHostedFixture,
  type FixtureForeignDeclaration,
} from "./hosted-fixture.ts";

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
  // digest throws ("Digest already called"; typed code reads no message).
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

/** ABI probes over libSystem: each call shape's values are observable in
 * the callee's behavior (snprintf reads variadic and stack slots back). */
export const probeDeclarations: FixtureForeignDeclaration = {
  id: "fixture/probe.d.ts",
  text: `declare module "tint:c/libsystem" {
  import type { i8, i16, i32, u8, u16, i64, u64, usize, f32, f64, Ptr, CString, CStringBytes, Variadic, FixedArray } from "tint:ffi";
  export interface div_t { quot: i32; rem: i32 }
  export interface ldiv_t { quot: i64; rem: i64 }
  export interface Complex { re: f64; im: f64 }
  export interface ComplexF { re: f32; im: f32 }
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
  export function cabs(z: Complex): f64;
  export function conj(z: Complex): Complex;
  export function conjf(z: ComplexF): ComplexF;
  export function memcpy$indirect(destination: Ptr<u8>, source: Big, count: usize): void;
  export function memset$narrow(destination: Ptr<u8>, value: i8, count: usize): void;
  export function snprintf$variadic(buffer: Ptr<u8>, size: usize, format: CString, a: Variadic<i32>, b: Variadic<f64>, c: Variadic<i64>, s: Variadic<CString>, f: Variadic<f32>, n: Variadic<i16>): i32;
  export function snprintf$packed(buffer: Ptr<u8>, size: usize, format: CString, x3: i64, x4: i64, x5: i64, x6: i64, x7: i64, s0: i32, s1: i32, s2: i16, s3: u16, s4: i32, s5: i64): i32;
  export function snprintf$composite(buffer: Ptr<u8>, size: usize, format: CString, x3: i64, x4: i64, x5: i64, x6: i64, x7: i64, pair: Pair16, after: u64): i32;
  export function snprintf$hfa(buffer: Ptr<u8>, size: usize, format: CString, d0: f64, d1: f64, d2: f64, d3: f64, d4: f64, d5: f64, d6: f64, d7: f64, z: Complex, single: f32): i32;
}
`,
};
export function verifyAbiProbeFixture(): string {
  const source = `import {
  getpid, abs, labs, strlen, strlen$bytes, atof, fabsf, toupper, div, ldiv, cabs, conj, conjf,
  memcpy$indirect, memset$narrow, snprintf$variadic, snprintf$packed, snprintf$composite, snprintf$hfa,
} from "probe";
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
  // Narrow arguments are extended by the caller (memset reads an int).
  const filled = new Uint8Array(3);
  memset$narrow(filled, -1, 3);
  if (filled[0] !== 255 || filled[2] !== 255) return 14;
  const buffer = new Uint8Array(128);
  // Apple: every variadic argument is on the stack in an 8-byte slot (f32
  // promoted to double, i16 to int).
  let n = snprintf$variadic(buffer, 128, "%d %.3f %lld %s %.2f %d", -7, 2.5, 123456789012, "ok", 0.25, -300);
  if (text(buffer, n) !== "-7 2.500 123456789012 ok 0.25 -300") return 20;
  // Named stack arguments pack at natural alignment: two i32s share the
  // first 8-byte slot, two i16s and an i32 the second.
  n = snprintf$packed(buffer, 128, "%lld %lld %lld", 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, -7);
  if (text(buffer, n) !== "8589934593 21475098627 -7") return 21;
  // With the X registers used up, a 16-byte record goes wholly to the stack.
  n = snprintf$composite(buffer, 128, "%lld %lld %llu", 0, 0, 0, 0, 0, { a: -11, b: 12 }, 9007199254740991);
  if (text(buffer, n) !== "-11 12 9007199254740991") return 22;
  // With d0-d7 used up, an HFA goes wholly to the stack, then an f32 packs
  // after it (read back as the low half of a double slot).
  n = snprintf$hfa(buffer, 128, "%.2f %.2f", 0, 0, 0, 0, 0, 0, 0, 0, { re: 1.25, im: -3.5 }, 0);
  if (text(buffer, n) !== "1.25 -3.50") return 23;
  return 42;
}
`;
  return verifyHostedFixture(
    source,
    "ffi-abi-probes",
    [["probe", probeDeclarations.id]],
    [],
    [],
    [],
    {
      managedBytes: 4194304,
      allocationCapacity: 65536,
      foreignDeclarations: [probeDeclarations],
    },
  );
}
