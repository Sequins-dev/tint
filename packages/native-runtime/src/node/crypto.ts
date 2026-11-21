/** Node crypto over the system OpenSSL 3 default provider. */
import { encodeUTF8 } from "@tint/foundation/text/text-encoding";
import {
  ERR_clear_error,
  EVP_MD_CTX_new,
  EVP_MD_CTX_free,
  EVP_DigestInit_ex2,
  EVP_DigestUpdate,
  EVP_DigestFinal_ex,
  HMAC_CTX_new,
  HMAC_CTX_free,
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
  readonly owner: unknown;
}

let lifetimes: DigestLifetime[] = [];
let sweepAt = 256;
const digests = new Map<string, number>();

function disposeContext(address: number, hmac: boolean): void {
  if (hmac) HMAC_CTX_free(address);
  else EVP_MD_CTX_free(address);
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

/** A digest has at most 64 bytes. Emit several code units per string
 * allocation, with at most eight concatenations before the short tail. */
function digestHex(bytes: Uint8Array, length: number): string {
  let text = "";
  let i = 0;
  for (; i + 8 <= length; i += 8) {
    const a = bytes[i] ?? 0,
      b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0,
      d = bytes[i + 3] ?? 0;
    const e = bytes[i + 4] ?? 0,
      f = bytes[i + 5] ?? 0;
    const g = bytes[i + 6] ?? 0,
      h = bytes[i + 7] ?? 0;
    text += String.fromCharCode(
      hexDigit(a >>> 4),
      hexDigit(a & 15),
      hexDigit(b >>> 4),
      hexDigit(b & 15),
      hexDigit(c >>> 4),
      hexDigit(c & 15),
      hexDigit(d >>> 4),
      hexDigit(d & 15),
      hexDigit(e >>> 4),
      hexDigit(e & 15),
      hexDigit(f >>> 4),
      hexDigit(f & 15),
      hexDigit(g >>> 4),
      hexDigit(g & 15),
      hexDigit(h >>> 4),
      hexDigit(h & 15),
    );
  }
  for (; i < length; i++) {
    const byte = bytes[i] ?? 0;
    text += String.fromCharCode(hexDigit(byte >>> 4), hexDigit(byte & 15));
  }
  return text;
}

function beginDigest(algorithm: string, key: Uint8Array | undefined): Hash {
  sweepDigests();
  const ffi = systemOpenSSL();
  const name = digestName(algorithm);
  const cached = digests.get(name);
  const digest = cached ?? fetchDigest(ffi, name);
  if (digest === 0) {
    if (key !== undefined)
      throw codedError(
        "Invalid digest: " + algorithm,
        "ERR_CRYPTO_INVALID_DIGEST",
      );
    throw new Error("Digest method not supported");
  }
  const cacheNew = cached === undefined && digests.size < 64;
  if (cacheNew) digests.set(name, digest);
  const releaseDigest = cached === undefined && !cacheNew;

  const hmac = key !== undefined;
  let context = 0;
  try {
    context = hmac ? HMAC_CTX_new() : EVP_MD_CTX_new();
    if (context === 0) throw failure("Failed to allocate digest context");
    const status =
      key === undefined
        ? EVP_DigestInit_ex2(context, digest, 0)
        : HMAC_Init_ex(
            context,
            key.length === 0 ? new Uint8Array(1) : key,
            key.length,
            digest,
            0,
          );
    if (status !== 1)
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
      requireActive();
      const bytes =
        typeof data === "string" ? encodeUpdate(data, encoding) : data;
      const status = hmac
        ? HMAC_Update(context, bytes, bytes.length)
        : EVP_DigestUpdate(context, bytes, bytes.length);
      if (status !== 1) throw failure("Hash update failed");
      return hash;
    },
    digest(encoding?: string): string | Uint8Array {
      if (!hmac) requireActive();
      const bytes = lifetime.address === 0 ? new Uint8Array(0) : finish();
      if (encoding === "hex") return digestHex(bytes, bytes.length);
      const name =
        encoding === undefined ? undefined : bufferEncoding(encoding);
      return name === undefined ? bytes : bufferText(bytes, name);
    },
  };
  const lifetime: DigestLifetime = {
    address: context,
    hmac,
    owner: createWeakSlot(hash, undefined, false),
  };
  lifetimes.push(lifetime);
  function requireActive(): void {
    if (lifetime.address === 0)
      throw codedError("Digest already called", "ERR_CRYPTO_HASH_FINALIZED");
  }
  function finish(): Uint8Array {
    const bytes = new Uint8Array(64);
    const size = new Uint8Array(4);
    try {
      const status = hmac
        ? HMAC_Final(context, bytes, size)
        : EVP_DigestFinal_ex(context, bytes, size);
      if (status !== 1) throw failure("Hash digest failed");
      return bytes.subarray(0, size[0] ?? 0);
    } finally {
      disposeContext(lifetime.address, hmac);
      lifetime.address = 0;
    }
  }
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
