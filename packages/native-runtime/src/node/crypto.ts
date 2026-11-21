/** Node crypto over the system OpenSSL 3 default provider. */
import { encodeUTF8 } from "@tint/foundation/text/text-encoding";
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
  systemOpenSSL,
} from "./openssl.ts";
import { codedError, codedRangeError } from "./errors.ts";
import { createWeakSlot, weakSlotKey } from "../intrinsics/weak.ts";
import { bufferBytes, bufferEncoding, bufferText } from "./buffer-codecs.ts";
export { pbkdf2 } from "./crypto-jobs.ts";

export interface Hash {
  update(data: string | Uint8Array, encoding?: string): Hash;
  digest(encoding?: string): string | Uint8Array;
}

interface DigestLifetime {
  address: number;
  readonly hmac: boolean;
  readonly digest: number;
  readonly owner: unknown;
}

let lifetimes: DigestLifetime[] = [];
let sweepAt = 256;
let digests = new Map<string, number>();
let recentAlgorithm: string | undefined = undefined;
let recentDigest: number | undefined = undefined;
const encodedDigest = new Uint8Array(64);
const finalizedSize = new Uint8Array(4);
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
  recentDigest = undefined;
  if (digests.size !== 0) {
    const ffi = systemOpenSSL();
    for (const [_name, digest] of digests) {
      if (digest === undefined) throw "digest cache invariant";
      disposeAddress(ffi.digestFree, digest);
    }
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
  return beginDigest(algorithm, undefined);
}

export function createHmac(algorithm: string, key: string | Uint8Array): Hash {
  return beginDigest(
    algorithm,
    typeof key === "string" ? encodeUTF8(key) : key,
  );
}

function failure(message: string): Error {
  ERR_clear_error();
  return new Error(message);
}

function encodeUpdate(data: string, encoding: string | undefined): Uint8Array {
  const name = encoding === undefined ? undefined : bufferEncoding(encoding);
  if (name === "hex" && data.length % 2 !== 0)
    throw codedError(
      "The argument 'encoding' is invalid for data of length " +
        String(data.length) +
        ". Received '" +
        (encoding ?? "") +
        "'",
      "ERR_INVALID_ARG_VALUE",
    );
  return bufferBytes(data, name ?? "utf8");
}

function hexDigit(value: number): number {
  return value < 10 ? value + 48 : value + 87;
}

function createHexPairs(): Uint8Array {
  const pairs = new Uint8Array(512);
  for (let byte = 0; byte < 256; byte++) {
    pairs[byte * 2] = hexDigit(byte >>> 4);
    pairs[byte * 2 + 1] = hexDigit(byte & 15);
  }
  return pairs;
}

const hexPairs = createHexPairs();

/** A digest has at most 64 bytes. Emit several code units per string
 * allocation, with at most eight concatenations before the short tail. */
function digestHex(bytes: Uint8Array, length: number): string {
  let text = "";
  let i = 0;
  for (; i + 8 <= length; i += 8) {
    const a = (bytes[i] ?? 0) * 2,
      b = (bytes[i + 1] ?? 0) * 2;
    const c = (bytes[i + 2] ?? 0) * 2,
      d = (bytes[i + 3] ?? 0) * 2;
    const e = (bytes[i + 4] ?? 0) * 2,
      f = (bytes[i + 5] ?? 0) * 2;
    const g = (bytes[i + 6] ?? 0) * 2,
      h = (bytes[i + 7] ?? 0) * 2;
    text += String.fromCharCode(
      hexPairs[a] ?? 0,
      hexPairs[a + 1] ?? 0,
      hexPairs[b] ?? 0,
      hexPairs[b + 1] ?? 0,
      hexPairs[c] ?? 0,
      hexPairs[c + 1] ?? 0,
      hexPairs[d] ?? 0,
      hexPairs[d + 1] ?? 0,
      hexPairs[e] ?? 0,
      hexPairs[e + 1] ?? 0,
      hexPairs[f] ?? 0,
      hexPairs[f + 1] ?? 0,
      hexPairs[g] ?? 0,
      hexPairs[g + 1] ?? 0,
      hexPairs[h] ?? 0,
      hexPairs[h + 1] ?? 0,
    );
  }
  for (; i < length; i++) {
    const pair = (bytes[i] ?? 0) * 2;
    text += String.fromCharCode(hexPairs[pair] ?? 0, hexPairs[pair + 1] ?? 0);
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

function beginDigest(algorithm: string, key: Uint8Array | undefined): Hash {
  sweepDigests();
  const ffi = systemOpenSSL();
  const recent = algorithm === recentAlgorithm;
  const name = recent ? algorithm : digestName(algorithm);
  const cached = recent ? recentDigest : digests.get(name);
  const digest = cached ?? fetchDigest(ffi, name);
  if (digest === 0) {
    // The name registry also recognizes algorithms unavailable in the
    // default provider. Querying it does not initialize those algorithms.
    const known = EVP_get_digestbyname(encodeUTF8(name + "\0"));
    if (known !== 0 && known !== EVP_md_null())
      throw codedError(
        "error:0308010C:digital envelope routines::unsupported",
        "ERR_OSSL_EVP_UNSUPPORTED",
      );
    if (key !== undefined)
      throw codedError(
        "Invalid digest: " + algorithm,
        "ERR_CRYPTO_INVALID_DIGEST",
      );
    throw new Error("Digest method not supported");
  }
  if (
    cached === undefined &&
    (EVP_MD_get_flags(digest) & EVP_MD_FLAG_XOF) !== 0
  ) {
    disposeAddress(ffi.digestFree, digest);
    throw codedError(
      "node:crypto XOF hashing is outside Tint's crypto proof of concept",
      "ERR_CRYPTO_UNSUPPORTED_OPERATION",
    );
  }
  const cacheNew = cached === undefined && digests.size < 64;
  if (cacheNew) digests.set(name, digest);
  const releaseDigest = cached === undefined && !cacheNew;
  if (!recent && !releaseDigest && name === algorithm) {
    recentAlgorithm = algorithm;
    recentDigest = digest;
  }

  const hmac = key !== undefined;
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
  } finally {
    if (releaseDigest) disposeAddress(ffi.digestFree, digest);
  }

  const hash: Hash = {
    update(data: string | Uint8Array, encoding?: string): Hash {
      const address = activeContext(lifetime);
      const bytes =
        typeof data === "string" ? encodeUpdate(data, encoding) : data;
      const status = lifetime.hmac
        ? HMAC_Update(address, bytes, bytes.length)
        : EVP_DigestUpdate(address, bytes, bytes.length);
      if (status !== 1) throw failure("Hash update failed");
      return hash;
    },
    digest(encoding?: string): string | Uint8Array {
      if (!lifetime.hmac) activeContext(lifetime);
      if (encoding === "hex") {
        if (lifetime.address === 0) return "";
        // Leaf calls cannot re-enter JavaScript. The string owns its data.
        return digestHex(encodedDigest, finishDigest(lifetime, encodedDigest));
      }
      const bytes =
        lifetime.address === 0 ? new Uint8Array(0) : new Uint8Array(64);
      const output =
        bytes.length === 0
          ? bytes
          : bytes.subarray(0, finishDigest(lifetime, bytes));
      const name =
        encoding === undefined ? undefined : bufferEncoding(encoding);
      return name === undefined ? output : bufferText(output, name);
    },
  };
  const lifetime: DigestLifetime = {
    address: context,
    hmac,
    digest,
    owner: createWeakSlot(hash, undefined, false),
  };
  lifetimes.push(lifetime);
  return hash;
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
