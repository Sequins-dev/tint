/** Node crypto over the system OpenSSL 3 default provider. */
import {
  encodeUTF8,
  encodeUTF8Into,
  utf8WindowBytes,
} from "@tint/foundation/text/text-encoding";
import {
  ERR_clear_error,
  EVP_get_digestbyname,
  EVP_md_null,
  EVP_MD_CTX_new,
  EVP_MD_CTX_free,
  EVP_MD_get_flags,
  EVP_MD_FLAG_XOF,
  EVP_DigestInit_ex2,
  EVP_DigestUpdate,
  EVP_DigestFinal_ex,
  HMAC_CTX_new,
  HMAC_CTX_free,
  HMAC_CTX_reset,
  HMAC_Init_ex,
  HMAC_Update,
  HMAC_Final,
  RAND_bytes_ex,
} from "tint:c/openssl3";
import {
  digestName,
  disposeAddress,
  fetchDigest,
  findDigestAlias,
  registeredDigestName,
  systemOpenSSL,
} from "./openssl.ts";
import { codedError, codedRangeError } from "./errors.ts";
import { createWeakSlot, weakSlotKey } from "../intrinsics/weak.ts";
import {
  bufferBytes,
  bufferEncoding,
  bufferText,
  type NodeBufferEncoding,
} from "./buffer-codecs.ts";
export { pbkdf2 } from "./crypto-jobs.ts";

export interface Hash {
  update(data: string | Uint8Array, encoding?: string): Hash;
  digest(encoding?: string): string | Uint8Array;
}

/** One OpenSSL digest or HMAC context. Typed Hash objects and node:crypto
 * views both own one; the context returns to the spare slot when the digest
 * finishes, or is freed after its owner is collected. */
export interface DigestLifetime {
  address: number;
  readonly hmac: boolean;
  readonly digest: number;
  owner: unknown;
}

let lifetimes: DigestLifetime[] = [];
let sweepAt = 256;
// The newest digest and its owner stay strongly held until the next digest
// opens. Most digests finish by then and never need a weak owner slot.
let pendingLifetime: DigestLifetime | undefined = undefined;
let pendingOwner: unknown = undefined;
let digests = new Map<string, number>();
let fetchedDigests: number[] = [];
let recentAlgorithm: string | undefined = undefined;
let recentDigest = 0;
const encodedDigest = new Uint8Array(64);
const finalizedSize = new Uint8Array(4);
const updateScratch = new Uint8Array(utf8WindowBytes);
let spareHash = 0;
let spareHashDigest = 0;
let spareHmac = 0;

function disposeContext(address: number, hmac: boolean): void {
  if (hmac) HMAC_CTX_free(address);
  else EVP_MD_CTX_free(address);
}

function borrowContext(hmac: boolean): number {
  if (hmac) {
    const context = spareHmac;
    spareHmac = 0;
    return context === 0 ? HMAC_CTX_new() : context;
  }
  const context = spareHash;
  spareHash = 0;
  return context === 0 ? EVP_MD_CTX_new() : context;
}

function recycleContext(address: number, hmac: boolean, digest: number): void {
  if ((hmac ? spareHmac : spareHash) !== 0) {
    disposeContext(address, hmac);
    return;
  }
  // Reinitialize the same digest in place to keep its provider allocation.
  // HMAC must discard its key before its context can become idle.
  const reset = hmac
    ? HMAC_CTX_reset(address)
    : EVP_DigestInit_ex2(address, 0, 0);
  if (reset !== 1) {
    ERR_clear_error();
    disposeContext(address, hmac);
  } else if (hmac) spareHmac = address;
  else {
    spareHash = address;
    spareHashDigest = digest;
  }
}

export function closeDigestContexts(): void {
  const pending = pendingLifetime;
  pendingLifetime = undefined;
  pendingOwner = undefined;
  if (pending !== undefined && pending.address !== 0) {
    disposeContext(pending.address, pending.hmac);
    pending.address = 0;
  }
  for (const lifetime of lifetimes) {
    if (lifetime === undefined) throw "digest lifetime invariant";
    if (lifetime.address === 0) continue;
    disposeContext(lifetime.address, lifetime.hmac);
    lifetime.address = 0;
  }
  lifetimes = [];
  sweepAt = 256;
  if (spareHash !== 0) EVP_MD_CTX_free(spareHash);
  if (spareHmac !== 0) HMAC_CTX_free(spareHmac);
  spareHash = 0;
  spareHashDigest = 0;
  spareHmac = 0;
  recentAlgorithm = undefined;
  recentDigest = 0;
  if (fetchedDigests.length !== 0) {
    const ffi = systemOpenSSL();
    for (const digest of fetchedDigests) {
      if (digest === undefined) throw "digest cache invariant";
      disposeAddress(ffi.digestFree, digest);
    }
    fetchedDigests = [];
    digests = new Map<string, number>();
  }
}

function sweepDigests(): void {
  if (lifetimes.length < sweepAt) return;
  const live: DigestLifetime[] = [];
  for (const lifetime of lifetimes) {
    if (lifetime === undefined) throw "digest lifetime invariant";
    if (lifetime.address === 0) continue;
    if (weakSlotKey(lifetime.owner) === undefined)
      disposeContext(lifetime.address, lifetime.hmac);
    else live.push(lifetime);
  }
  lifetimes = live;
  sweepAt = Math.max(256, live.length * 2);
}

export function createHash(algorithm: string): Hash {
  return digestObject(openDigest(algorithm, undefined));
}

export function createHmac(algorithm: string, key: string | Uint8Array): Hash {
  return digestObject(
    openDigest(algorithm, typeof key === "string" ? encodeUTF8(key) : key),
  );
}

function digestObject(lifetime: DigestLifetime): Hash {
  const hash: Hash = {
    update(data: string | Uint8Array, encoding?: string): Hash {
      updateDigest(lifetime, data, encoding);
      return hash;
    },
    digest(encoding?: string): string | Uint8Array {
      return finishDigestAs(lifetime, encoding);
    },
  };
  trackDigest(lifetime, hash);
  return hash;
}

function failure(message: string): Error {
  ERR_clear_error();
  return new Error(message);
}

function updateBytes(
  address: number,
  hmac: boolean,
  bytes: Uint8Array,
  length: number,
): void {
  const status = hmac
    ? HMAC_Update(address, bytes, length)
    : EVP_DigestUpdate(address, bytes, length);
  if (status !== 1) throw failure("Hash update failed");
}

function updateString(
  address: number,
  hmac: boolean,
  data: string,
  encoding: string | undefined,
): void {
  const name: NodeBufferEncoding =
    encoding === undefined || encoding === "utf8"
      ? "utf8"
      : (bufferEncoding(encoding) ?? "utf8");
  if (name === "utf8") {
    // The encoder splits only between scalars. OpenSSL consumes the scratch
    // window synchronously and cannot reenter JavaScript.
    let read = 0;
    do {
      const result = encodeUTF8Into(data, updateScratch, read);
      updateBytes(address, hmac, updateScratch, result.written);
      read += result.read;
    } while (read < data.length);
    return;
  }
  if (name === "hex" && data.length % 2 !== 0)
    throw codedError(
      "The argument 'encoding' is invalid for data of length " +
        String(data.length) +
        ". Received '" +
        (encoding ?? "") +
        "'",
      "ERR_INVALID_ARG_VALUE",
    );
  const bytes = bufferBytes(data, name);
  updateBytes(address, hmac, bytes, bytes.length);
}

function hexDigit(value: number): number {
  return value < 10 ? value + 48 : value + 87;
}

function createPackedHexPairs(): Uint16Array {
  const pairs = new Uint16Array(256);
  for (let byte = 0; byte < 256; byte++) {
    pairs[byte] = hexDigit(byte >>> 4) | (hexDigit(byte & 15) << 8);
  }
  return pairs;
}

const packedHexPairs = createPackedHexPairs();

/** Fixed arity lets the typed fromCharCode operation write one final string. */
function digestHex64(bytes: Uint8Array): string {
  const pair0 = packedHexPairs[bytes[0] ?? 0] ?? 0;
  const pair1 = packedHexPairs[bytes[1] ?? 0] ?? 0;
  const pair2 = packedHexPairs[bytes[2] ?? 0] ?? 0;
  const pair3 = packedHexPairs[bytes[3] ?? 0] ?? 0;
  const pair4 = packedHexPairs[bytes[4] ?? 0] ?? 0;
  const pair5 = packedHexPairs[bytes[5] ?? 0] ?? 0;
  const pair6 = packedHexPairs[bytes[6] ?? 0] ?? 0;
  const pair7 = packedHexPairs[bytes[7] ?? 0] ?? 0;
  const pair8 = packedHexPairs[bytes[8] ?? 0] ?? 0;
  const pair9 = packedHexPairs[bytes[9] ?? 0] ?? 0;
  const pair10 = packedHexPairs[bytes[10] ?? 0] ?? 0;
  const pair11 = packedHexPairs[bytes[11] ?? 0] ?? 0;
  const pair12 = packedHexPairs[bytes[12] ?? 0] ?? 0;
  const pair13 = packedHexPairs[bytes[13] ?? 0] ?? 0;
  const pair14 = packedHexPairs[bytes[14] ?? 0] ?? 0;
  const pair15 = packedHexPairs[bytes[15] ?? 0] ?? 0;
  const pair16 = packedHexPairs[bytes[16] ?? 0] ?? 0;
  const pair17 = packedHexPairs[bytes[17] ?? 0] ?? 0;
  const pair18 = packedHexPairs[bytes[18] ?? 0] ?? 0;
  const pair19 = packedHexPairs[bytes[19] ?? 0] ?? 0;
  const pair20 = packedHexPairs[bytes[20] ?? 0] ?? 0;
  const pair21 = packedHexPairs[bytes[21] ?? 0] ?? 0;
  const pair22 = packedHexPairs[bytes[22] ?? 0] ?? 0;
  const pair23 = packedHexPairs[bytes[23] ?? 0] ?? 0;
  const pair24 = packedHexPairs[bytes[24] ?? 0] ?? 0;
  const pair25 = packedHexPairs[bytes[25] ?? 0] ?? 0;
  const pair26 = packedHexPairs[bytes[26] ?? 0] ?? 0;
  const pair27 = packedHexPairs[bytes[27] ?? 0] ?? 0;
  const pair28 = packedHexPairs[bytes[28] ?? 0] ?? 0;
  const pair29 = packedHexPairs[bytes[29] ?? 0] ?? 0;
  const pair30 = packedHexPairs[bytes[30] ?? 0] ?? 0;
  const pair31 = packedHexPairs[bytes[31] ?? 0] ?? 0;
  const pair32 = packedHexPairs[bytes[32] ?? 0] ?? 0;
  const pair33 = packedHexPairs[bytes[33] ?? 0] ?? 0;
  const pair34 = packedHexPairs[bytes[34] ?? 0] ?? 0;
  const pair35 = packedHexPairs[bytes[35] ?? 0] ?? 0;
  const pair36 = packedHexPairs[bytes[36] ?? 0] ?? 0;
  const pair37 = packedHexPairs[bytes[37] ?? 0] ?? 0;
  const pair38 = packedHexPairs[bytes[38] ?? 0] ?? 0;
  const pair39 = packedHexPairs[bytes[39] ?? 0] ?? 0;
  const pair40 = packedHexPairs[bytes[40] ?? 0] ?? 0;
  const pair41 = packedHexPairs[bytes[41] ?? 0] ?? 0;
  const pair42 = packedHexPairs[bytes[42] ?? 0] ?? 0;
  const pair43 = packedHexPairs[bytes[43] ?? 0] ?? 0;
  const pair44 = packedHexPairs[bytes[44] ?? 0] ?? 0;
  const pair45 = packedHexPairs[bytes[45] ?? 0] ?? 0;
  const pair46 = packedHexPairs[bytes[46] ?? 0] ?? 0;
  const pair47 = packedHexPairs[bytes[47] ?? 0] ?? 0;
  const pair48 = packedHexPairs[bytes[48] ?? 0] ?? 0;
  const pair49 = packedHexPairs[bytes[49] ?? 0] ?? 0;
  const pair50 = packedHexPairs[bytes[50] ?? 0] ?? 0;
  const pair51 = packedHexPairs[bytes[51] ?? 0] ?? 0;
  const pair52 = packedHexPairs[bytes[52] ?? 0] ?? 0;
  const pair53 = packedHexPairs[bytes[53] ?? 0] ?? 0;
  const pair54 = packedHexPairs[bytes[54] ?? 0] ?? 0;
  const pair55 = packedHexPairs[bytes[55] ?? 0] ?? 0;
  const pair56 = packedHexPairs[bytes[56] ?? 0] ?? 0;
  const pair57 = packedHexPairs[bytes[57] ?? 0] ?? 0;
  const pair58 = packedHexPairs[bytes[58] ?? 0] ?? 0;
  const pair59 = packedHexPairs[bytes[59] ?? 0] ?? 0;
  const pair60 = packedHexPairs[bytes[60] ?? 0] ?? 0;
  const pair61 = packedHexPairs[bytes[61] ?? 0] ?? 0;
  const pair62 = packedHexPairs[bytes[62] ?? 0] ?? 0;
  const pair63 = packedHexPairs[bytes[63] ?? 0] ?? 0;
  // prettier-ignore
  return String.fromCharCode(
    pair0 & 255, pair0 >>> 8, pair1 & 255, pair1 >>> 8,
    pair2 & 255, pair2 >>> 8, pair3 & 255, pair3 >>> 8,
    pair4 & 255, pair4 >>> 8, pair5 & 255, pair5 >>> 8,
    pair6 & 255, pair6 >>> 8, pair7 & 255, pair7 >>> 8,
    pair8 & 255, pair8 >>> 8, pair9 & 255, pair9 >>> 8,
    pair10 & 255, pair10 >>> 8, pair11 & 255, pair11 >>> 8,
    pair12 & 255, pair12 >>> 8, pair13 & 255, pair13 >>> 8,
    pair14 & 255, pair14 >>> 8, pair15 & 255, pair15 >>> 8,
    pair16 & 255, pair16 >>> 8, pair17 & 255, pair17 >>> 8,
    pair18 & 255, pair18 >>> 8, pair19 & 255, pair19 >>> 8,
    pair20 & 255, pair20 >>> 8, pair21 & 255, pair21 >>> 8,
    pair22 & 255, pair22 >>> 8, pair23 & 255, pair23 >>> 8,
    pair24 & 255, pair24 >>> 8, pair25 & 255, pair25 >>> 8,
    pair26 & 255, pair26 >>> 8, pair27 & 255, pair27 >>> 8,
    pair28 & 255, pair28 >>> 8, pair29 & 255, pair29 >>> 8,
    pair30 & 255, pair30 >>> 8, pair31 & 255, pair31 >>> 8,
    pair32 & 255, pair32 >>> 8, pair33 & 255, pair33 >>> 8,
    pair34 & 255, pair34 >>> 8, pair35 & 255, pair35 >>> 8,
    pair36 & 255, pair36 >>> 8, pair37 & 255, pair37 >>> 8,
    pair38 & 255, pair38 >>> 8, pair39 & 255, pair39 >>> 8,
    pair40 & 255, pair40 >>> 8, pair41 & 255, pair41 >>> 8,
    pair42 & 255, pair42 >>> 8, pair43 & 255, pair43 >>> 8,
    pair44 & 255, pair44 >>> 8, pair45 & 255, pair45 >>> 8,
    pair46 & 255, pair46 >>> 8, pair47 & 255, pair47 >>> 8,
    pair48 & 255, pair48 >>> 8, pair49 & 255, pair49 >>> 8,
    pair50 & 255, pair50 >>> 8, pair51 & 255, pair51 >>> 8,
    pair52 & 255, pair52 >>> 8, pair53 & 255, pair53 >>> 8,
    pair54 & 255, pair54 >>> 8, pair55 & 255, pair55 >>> 8,
    pair56 & 255, pair56 >>> 8, pair57 & 255, pair57 >>> 8,
    pair58 & 255, pair58 >>> 8, pair59 & 255, pair59 >>> 8,
    pair60 & 255, pair60 >>> 8, pair61 & 255, pair61 >>> 8,
    pair62 & 255, pair62 >>> 8, pair63 & 255, pair63 >>> 8,
  );
}

/** Fixed arity writes SHA-256 and SHA3-256 output as one final string. */
function digestHex32(bytes: Uint8Array): string {
  const pair0 = packedHexPairs[bytes[0] ?? 0] ?? 0;
  const pair1 = packedHexPairs[bytes[1] ?? 0] ?? 0;
  const pair2 = packedHexPairs[bytes[2] ?? 0] ?? 0;
  const pair3 = packedHexPairs[bytes[3] ?? 0] ?? 0;
  const pair4 = packedHexPairs[bytes[4] ?? 0] ?? 0;
  const pair5 = packedHexPairs[bytes[5] ?? 0] ?? 0;
  const pair6 = packedHexPairs[bytes[6] ?? 0] ?? 0;
  const pair7 = packedHexPairs[bytes[7] ?? 0] ?? 0;
  const pair8 = packedHexPairs[bytes[8] ?? 0] ?? 0;
  const pair9 = packedHexPairs[bytes[9] ?? 0] ?? 0;
  const pair10 = packedHexPairs[bytes[10] ?? 0] ?? 0;
  const pair11 = packedHexPairs[bytes[11] ?? 0] ?? 0;
  const pair12 = packedHexPairs[bytes[12] ?? 0] ?? 0;
  const pair13 = packedHexPairs[bytes[13] ?? 0] ?? 0;
  const pair14 = packedHexPairs[bytes[14] ?? 0] ?? 0;
  const pair15 = packedHexPairs[bytes[15] ?? 0] ?? 0;
  const pair16 = packedHexPairs[bytes[16] ?? 0] ?? 0;
  const pair17 = packedHexPairs[bytes[17] ?? 0] ?? 0;
  const pair18 = packedHexPairs[bytes[18] ?? 0] ?? 0;
  const pair19 = packedHexPairs[bytes[19] ?? 0] ?? 0;
  const pair20 = packedHexPairs[bytes[20] ?? 0] ?? 0;
  const pair21 = packedHexPairs[bytes[21] ?? 0] ?? 0;
  const pair22 = packedHexPairs[bytes[22] ?? 0] ?? 0;
  const pair23 = packedHexPairs[bytes[23] ?? 0] ?? 0;
  const pair24 = packedHexPairs[bytes[24] ?? 0] ?? 0;
  const pair25 = packedHexPairs[bytes[25] ?? 0] ?? 0;
  const pair26 = packedHexPairs[bytes[26] ?? 0] ?? 0;
  const pair27 = packedHexPairs[bytes[27] ?? 0] ?? 0;
  const pair28 = packedHexPairs[bytes[28] ?? 0] ?? 0;
  const pair29 = packedHexPairs[bytes[29] ?? 0] ?? 0;
  const pair30 = packedHexPairs[bytes[30] ?? 0] ?? 0;
  const pair31 = packedHexPairs[bytes[31] ?? 0] ?? 0;
  // prettier-ignore
  return String.fromCharCode(
    pair0 & 255, pair0 >>> 8, pair1 & 255, pair1 >>> 8,
    pair2 & 255, pair2 >>> 8, pair3 & 255, pair3 >>> 8,
    pair4 & 255, pair4 >>> 8, pair5 & 255, pair5 >>> 8,
    pair6 & 255, pair6 >>> 8, pair7 & 255, pair7 >>> 8,
    pair8 & 255, pair8 >>> 8, pair9 & 255, pair9 >>> 8,
    pair10 & 255, pair10 >>> 8, pair11 & 255, pair11 >>> 8,
    pair12 & 255, pair12 >>> 8, pair13 & 255, pair13 >>> 8,
    pair14 & 255, pair14 >>> 8, pair15 & 255, pair15 >>> 8,
    pair16 & 255, pair16 >>> 8, pair17 & 255, pair17 >>> 8,
    pair18 & 255, pair18 >>> 8, pair19 & 255, pair19 >>> 8,
    pair20 & 255, pair20 >>> 8, pair21 & 255, pair21 >>> 8,
    pair22 & 255, pair22 >>> 8, pair23 & 255, pair23 >>> 8,
    pair24 & 255, pair24 >>> 8, pair25 & 255, pair25 >>> 8,
    pair26 & 255, pair26 >>> 8, pair27 & 255, pair27 >>> 8,
    pair28 & 255, pair28 >>> 8, pair29 & 255, pair29 >>> 8,
    pair30 & 255, pair30 >>> 8, pair31 & 255, pair31 >>> 8,
  );
}

/** Other digest lengths (at most 64 bytes) append eight bytes per string
 * allocation, then the short tail. Packed pairs keep code units integral. */
function digestHex(bytes: Uint8Array, length: number): string {
  if (length === 64) return digestHex64(bytes);
  if (length === 32) return digestHex32(bytes);
  let text = "";
  let i = 0;
  for (; i + 8 <= length; i += 8) {
    const a = packedHexPairs[bytes[i] ?? 0] ?? 0,
      b = packedHexPairs[bytes[i + 1] ?? 0] ?? 0;
    const c = packedHexPairs[bytes[i + 2] ?? 0] ?? 0,
      d = packedHexPairs[bytes[i + 3] ?? 0] ?? 0;
    const e = packedHexPairs[bytes[i + 4] ?? 0] ?? 0,
      f = packedHexPairs[bytes[i + 5] ?? 0] ?? 0;
    const g = packedHexPairs[bytes[i + 6] ?? 0] ?? 0,
      h = packedHexPairs[bytes[i + 7] ?? 0] ?? 0;
    // prettier-ignore
    text += String.fromCharCode(
      a & 255, a >>> 8, b & 255, b >>> 8, c & 255, c >>> 8, d & 255, d >>> 8,
      e & 255, e >>> 8, f & 255, f >>> 8, g & 255, g >>> 8, h & 255, h >>> 8,
    );
  }
  for (; i < length; i++) {
    const pair = packedHexPairs[bytes[i] ?? 0] ?? 0;
    text += String.fromCharCode(pair & 255, pair >>> 8);
  }
  return text;
}

function activeContext(lifetime: DigestLifetime): number {
  const address = lifetime.address;
  if (address === 0)
    throw codedError("Digest already called", "ERR_CRYPTO_HASH_FINALIZED");
  return address;
}

function finishDigest(lifetime: DigestLifetime, bytes: Uint8Array): number {
  const address = lifetime.address;
  const hmac = lifetime.hmac;
  try {
    const status = hmac
      ? HMAC_Final(address, bytes, finalizedSize)
      : EVP_DigestFinal_ex(address, bytes, finalizedSize);
    if (status !== 1) throw failure("Hash digest failed");
    return finalizedSize[0] ?? 0;
  } finally {
    recycleContext(address, hmac, lifetime.digest);
    lifetime.address = 0;
  }
}

function asciiLower(name: string): string {
  let lower = "";
  for (let index = 0; index < name.length; index++) {
    const code = name.charCodeAt(index);
    lower += String.fromCharCode(code >= 65 && code <= 90 ? code + 32 : code);
  }
  return lower;
}

function resolveDigest(algorithm: string, hmac: boolean): number {
  if (algorithm === recentAlgorithm) return recentDigest;
  let digest = digests.get(algorithm);
  if (digest === undefined) {
    const name = asciiLower(digestName(algorithm));
    digest = digests.get(name);
    if (digest === undefined) {
      digest = loadDigest(algorithm, name, hmac);
      digests.set(name, digest);
    }
  }
  recentAlgorithm = algorithm;
  recentDigest = digest;
  return digest;
}

function loadDigest(algorithm: string, name: string, hmac: boolean): number {
  const ffi = systemOpenSSL();
  const nameBytes = encodeUTF8(name + "\0");
  const alias = findDigestAlias(ffi, fetchedDigests, nameBytes);
  if (alias !== 0) return alias;

  // The registry resolves historical aliases such as RSA-SHA512.
  // Resolve implementations only in the default provider.
  const known = EVP_get_digestbyname(nameBytes);
  const registered = known !== 0 && known !== EVP_md_null();
  const canonical = registered
    ? (registeredDigestName(ffi, known) ?? name)
    : name;
  if (canonical !== name) {
    const match = findDigestAlias(
      ffi,
      fetchedDigests,
      encodeUTF8(canonical + "\0"),
    );
    if (match !== 0) return match;
  }
  const digest = fetchDigest(ffi, canonical);
  if (digest === 0) {
    if (registered)
      throw codedError(
        "error:0308010C:digital envelope routines::unsupported",
        "ERR_OSSL_EVP_UNSUPPORTED",
      );
    if (hmac)
      throw codedError(
        "Invalid digest: " + algorithm,
        "ERR_CRYPTO_INVALID_DIGEST",
      );
    throw new Error("Digest method not supported");
  }
  if ((EVP_MD_get_flags(digest) & EVP_MD_FLAG_XOF) !== 0) {
    disposeAddress(ffi.digestFree, digest);
    throw codedError(
      "node:crypto XOF hashing is outside Tint's crypto proof of concept",
      "ERR_CRYPTO_UNSUPPORTED_OPERATION",
    );
  }
  fetchedDigests.push(digest);
  return digest;
}

/** Open a context for `algorithm`, keyed for HMAC. The caller must hand the
 * lifetime to trackDigest before anything can throw, or the context leaks. */
export function openDigest(
  algorithm: string,
  key: Uint8Array | undefined,
): DigestLifetime {
  sweepDigests();
  const hmac = key !== undefined;
  const digest = resolveDigest(algorithm, hmac);
  let context = 0;
  try {
    const ready = !hmac && spareHash !== 0 && spareHashDigest === digest;
    context = borrowContext(hmac);
    if (context === 0) throw failure("Failed to allocate digest context");
    const initialized =
      key === undefined
        ? ready || EVP_DigestInit_ex2(context, digest, 0) === 1
        : HMAC_Init_ex(
            context,
            key.length === 0 ? new Uint8Array(1) : key,
            key.length,
            digest,
            0,
          ) === 1;
    if (!initialized)
      throw failure(
        hmac ? "HMAC initialization failed" : "Digest method not supported",
      );
  } catch (error) {
    if (context !== 0) disposeContext(context, hmac);
    throw error;
  }
  return { address: context, hmac, digest, owner: undefined };
}

/** Free the context with `owner` if the owner is collected before digest().
 * The owner is held until the next digest opens; only a digest still open
 * then gets a weak owner slot and joins the swept lifetimes. */
export function trackDigest(lifetime: DigestLifetime, owner: unknown): void {
  settlePendingDigest();
  pendingLifetime = lifetime;
  pendingOwner = owner;
}

function settlePendingDigest(): void {
  const lifetime = pendingLifetime;
  if (lifetime === undefined) return;
  const owner = pendingOwner;
  pendingLifetime = undefined;
  pendingOwner = undefined;
  if (lifetime.address === 0) return;
  lifetime.owner = createWeakSlot(owner, undefined, false);
  // Replace a finished tail entry instead of growing the tracking vector.
  const last = lifetimes.length - 1;
  const previous = last < 0 ? undefined : lifetimes[last];
  if (previous !== undefined && previous.address === 0)
    lifetimes[last] = lifetime;
  else lifetimes.push(lifetime);
}

/** digest() has run, or its context was released at isolate exit. */
export function digestFinished(lifetime: DigestLifetime): boolean {
  return lifetime.address === 0;
}

export function updateDigest(
  lifetime: DigestLifetime,
  data: string | Uint8Array,
  encoding: string | undefined,
): void {
  const address = activeContext(lifetime);
  if (typeof data === "string")
    updateString(address, lifetime.hmac, data, encoding);
  else updateBytes(address, lifetime.hmac, data, data.length);
}

/** Node returns an empty HMAC after the first digest(); Hash throws. */
export function finishDigestAs(
  lifetime: DigestLifetime,
  encoding: string | undefined,
): string | Uint8Array {
  if (!lifetime.hmac) activeContext(lifetime);
  if (encoding === "hex") {
    if (lifetime.address === 0) return "";
    // Leaf calls cannot re-enter JavaScript. The string owns its data.
    return digestHex(encodedDigest, finishDigest(lifetime, encodedDigest));
  }
  const bytes = lifetime.address === 0 ? new Uint8Array(0) : new Uint8Array(64);
  const output =
    bytes.length === 0
      ? bytes
      : bytes.subarray(0, finishDigest(lifetime, bytes));
  const name = encoding === undefined ? undefined : bufferEncoding(encoding);
  return name === undefined ? output : bufferText(output, name);
}

export function randomBytes(size: number): Uint8Array {
  if (!(size >= 0 && size <= 2147483647))
    throw codedRangeError(
      'The value of "size" is out of range. It must be >= 0 && <= 2147483647. Received ' +
        String(size),
      "ERR_OUT_OF_RANGE",
    );
  const ffi = systemOpenSSL();
  const bytes = new Uint8Array(Math.floor(size));
  if (bytes.length === 0) return bytes;
  if (RAND_bytes_ex(ffi.libraryContext, bytes, bytes.length, 0) !== 1)
    throw failure("Random generation failed");
  return bytes;
}
