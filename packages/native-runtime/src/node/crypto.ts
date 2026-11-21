/** Node crypto over the system OpenSSL 3 default provider. */
import { encodeUTF8 } from "@tint/foundation/text/text-encoding";
import { encodeHex, encodeBase64 } from "@tint/foundation/text/base-encoding";
import {
  invoke,
  resultNumber,
  setBytes,
  setNumber,
  type ForeignFunction,
} from "tint:ffi/unsafe";
import {
  disposeAddress,
  fetchDigest,
  systemOpenSSL,
  type OpenSSL,
} from "./openssl.ts";
import { codedError, codedRangeError } from "./errors.ts";
import { createWeakSlot, weakSlotKey } from "../intrinsics/weak.ts";
export { pbkdf2 } from "./crypto-jobs.ts";

export interface Hash {
  update(data: string | Uint8Array): Hash;
  digest(encoding?: string): string | Uint8Array;
}

interface DigestLifetime {
  address: number;
  readonly free: ForeignFunction;
  readonly owner: unknown;
}

let lifetimes: DigestLifetime[] = [];
let sweepAt = 256;

function sweepDigests(): void {
  if (lifetimes.length < sweepAt) return;
  const live: DigestLifetime[] = [];
  for (const lifetime of lifetimes) {
    if (lifetime === undefined) throw "digest lifetime invariant";
    if (lifetime.address === 0) continue;
    if (weakSlotKey(lifetime.owner) === undefined)
      disposeAddress(lifetime.free, lifetime.address);
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

function failure(ffi: OpenSSL, message: string): Error {
  invoke(ffi.clearErrors);
  return new Error(message);
}

function beginDigest(algorithm: string, key: Uint8Array | undefined): Hash {
  sweepDigests();
  const ffi = systemOpenSSL();
  const digest = fetchDigest(ffi, algorithm);
  if (digest === 0) {
    if (key !== undefined)
      throw codedError(
        "Invalid digest: " + algorithm,
        "ERR_CRYPTO_INVALID_DIGEST",
      );
    throw new Error("Digest method not supported");
  }

  const hmac = key !== undefined;
  const create = hmac ? ffi.hmacNew : ffi.contextNew;
  const free = hmac ? ffi.hmacFree : ffi.contextFree;
  const update = hmac ? ffi.hmacUpdate : ffi.digestUpdate;
  const final = hmac ? ffi.hmacFinal : ffi.digestFinal;
  let context = 0;
  try {
    invoke(create);
    context = resultNumber(create);
    if (context === 0) throw failure(ffi, "Failed to allocate digest context");
    if (key === undefined) {
      setNumber(ffi.digestInit, 0, context);
      setNumber(ffi.digestInit, 1, digest);
      setNumber(ffi.digestInit, 2, 0);
      invoke(ffi.digestInit);
      if (resultNumber(ffi.digestInit) !== 1)
        throw failure(ffi, "Digest method not supported");
    } else {
      setNumber(ffi.hmacInit, 0, context);
      // An empty key still needs a non-null address to request a fresh key.
      setBytes(ffi.hmacInit, 1, key.length === 0 ? new Uint8Array(1) : key);
      setNumber(ffi.hmacInit, 2, key.length);
      setNumber(ffi.hmacInit, 3, digest);
      setNumber(ffi.hmacInit, 4, 0);
      try {
        invoke(ffi.hmacInit);
        if (resultNumber(ffi.hmacInit) !== 1)
          throw failure(ffi, "HMAC initialization failed");
      } finally {
        setNumber(ffi.hmacInit, 1, 0);
      }
    }
  } catch (error) {
    if (context !== 0) disposeAddress(free, context);
    throw error;
  } finally {
    disposeAddress(ffi.digestFree, digest);
  }

  const hash: Hash = {
    update(data: string | Uint8Array): Hash {
      requireActive();
      const bytes = typeof data === "string" ? encodeUTF8(data) : data;
      setNumber(update, 0, context);
      setBytes(update, 1, bytes);
      setNumber(update, 2, bytes.length);
      try {
        invoke(update);
        if (resultNumber(update) !== 1)
          throw failure(ffi, "Hash update failed");
        return hash;
      } finally {
        setNumber(update, 1, 0);
      }
    },
    digest(encoding?: string): string | Uint8Array {
      if (!hmac) requireActive();
      const bytes = lifetime.address === 0 ? new Uint8Array(0) : finish();
      if (
        encoding !== "hex" &&
        encoding !== "base64" &&
        encoding !== "base64url"
      )
        return bytes;
      const output =
        encoding === "hex"
          ? encodeHex(bytes, 0, bytes.length)
          : encodeBase64(
              bytes,
              0,
              bytes.length,
              encoding,
              encoding === "base64url",
            );
      if (output === undefined) throw new Error("digest encoding invariant");
      return output;
    },
  };
  const lifetime: DigestLifetime = {
    address: context,
    free,
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
      setNumber(final, 0, context);
      setBytes(final, 1, bytes);
      setBytes(final, 2, size);
      invoke(final);
      if (resultNumber(final) !== 1) throw failure(ffi, "Hash digest failed");
      return bytes.subarray(0, size[0] ?? 0);
    } finally {
      setNumber(final, 1, 0);
      setNumber(final, 2, 0);
      disposeAddress(free, lifetime.address);
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
  invoke(ffi.clearErrors);
  setNumber(ffi.random, 0, ffi.libraryContext);
  setBytes(ffi.random, 1, bytes);
  setNumber(ffi.random, 2, bytes.length);
  setNumber(ffi.random, 3, 0);
  try {
    invoke(ffi.random);
    if (resultNumber(ffi.random) !== 1)
      throw failure(ffi, "Random generation failed");
    return bytes;
  } finally {
    setNumber(ffi.random, 1, 0);
  }
}
