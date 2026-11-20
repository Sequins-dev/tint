/** `node:crypto` message digests (docs/native-ffi.md, "node:crypto").
 * SHA-256 is Tint's own (`@tint/foundation/binary/sha256-stream`) on every
 * target: its compression binds the `sha256-rounds` intrinsic (the ARMv8
 * SHA-256 instructions) in native builds, so it needs no system library —
 * CommonCrypto exists only on Darwin, and Linux would otherwise need
 * OpenSSL's libcrypto for one digest. */
import {
  createSha256Stream,
  finishSha256Stream,
  updateSha256Stream,
} from "@tint/foundation/binary/sha256-stream";
import { encodeUTF8 } from "@tint/foundation/text/text-encoding";
import { encodeHex, encodeBase64 } from "@tint/foundation/text/base-encoding";
import { codedError } from "./errors.ts";

/** A message digest in progress (Node's Hash). */
export interface Hash {
  /** Add `data` (UTF-8 for strings, as Node's default encoding). */
  update(data: string | Uint8Array): Hash;
  /** Node's `digest([encoding])`: the 32 digest bytes (Node returns a
   * Buffer; Tint returns a Uint8Array), or `hex`, `base64` or `base64url`
   * text. A hash can be digested once. */
  digest(encoding?: string): string | Uint8Array;
}
/** `crypto.createHash(algorithm)`; SHA-256 (any letter case) for now.
 * KNOWN DEFECT (typed-pipeline gap, docs/native-ffi.md#known-defects): the hash is a closure-backed
 * object because the typed pipeline rejects classes in this module context
 * ("module instance classes require scoped contract..."); Node's Hash is a
 * class. */
export function createHash(algorithm: string): Hash {
  if (!sameAsciiLetters(algorithm, "sha256"))
    throw new Error("Digest method not supported");
  const stream = createSha256Stream();
  let finalized = false;
  const hash: Hash = {
    update(data: string | Uint8Array): Hash {
      requireActive();
      updateSha256Stream(
        stream,
        typeof data === "string" ? encodeUTF8(data) : data,
      );
      return hash;
    },
    digest(encoding?: string): string | Uint8Array {
      requireActive();
      if (encoding === undefined) return finish();
      if (
        encoding !== "hex" &&
        encoding !== "base64" &&
        encoding !== "base64url"
      )
        throw new TypeError("unsupported digest encoding: " + encoding);
      const digest = finish();
      const text =
        encoding === "hex"
          ? encodeHex(digest, 0, digest.length)
          : encodeBase64(
              digest,
              0,
              digest.length,
              encoding === "base64url" ? "base64url" : "base64",
              encoding === "base64url",
            );
      if (text === undefined) throw new RangeError("digest encoding invariant");
      return text;
    },
  };
  function requireActive(): void {
    if (finalized)
      throw codedError("Digest already called", "ERR_CRYPTO_HASH_FINALIZED");
  }
  function finish(): Uint8Array {
    finalized = true;
    return finishSha256Stream(stream);
  }
  return hash;
}
/** ASCII case-insensitive equality with a lowercase `name`.
 * KNOWN DEFECT (typed-pipeline gap, docs/native-ffi.md#known-defects): stands in for
 * `algorithm.toLowerCase()`, which the typed pipeline does not support. */
function sameAsciiLetters(text: string, name: string): boolean {
  if (text.length !== name.length) return false;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    const lower = code >= 65 && code <= 90 ? code + 32 : code;
    if (lower !== name.charCodeAt(index)) return false;
  }
  return true;
}
