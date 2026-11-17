/** `node:crypto` message digests over CommonCrypto (docs/native-ffi.md).
 * Node throws plain Errors with these messages; typed runtime code can
 * construct only TypeError and RangeError so far, so they are TypeErrors.
 * Every call into CommonCrypto is a leaf c-call: no collection can start
 * while one runs, so the context and data views it borrows stay put for
 * the call. Between calls the context lives in an ordinary (movable) byte
 * array, which is sound because CC_SHA256_CTX holds plain words and no
 * pointers into itself. */
import {
  CC_SHA256_CTX,
  CC_SHA256_Init,
  CC_SHA256_Update,
  CC_SHA256_Final,
} from "tint:c/commoncrypto";
import { encodeUTF8 } from "@tint/foundation/text/text-encoding";
import { encodeHex, encodeBase64 } from "@tint/foundation/text/base-encoding";

/** Largest byte count one CC_SHA256_Update takes (CC_LONG is 32 bits). */
const updateChunkBytes = 1073741824;

/** A message digest in progress (Node's Hash). */
export interface Hash {
  /** Add `data` (UTF-8 for strings, as Node's default encoding). */
  update(data: string | Uint8Array): Hash;
  /** Node's `digest([encoding])`: the 32 digest bytes (Node returns a
   * Buffer; Tint returns a Uint8Array), or `hex`, `base64` or `base64url`
   * text. A hash can be digested once. */
  digest(encoding?: string): string | Uint8Array;
}
/** `crypto.createHash(algorithm)`; SHA-256 (any letter case) for now. */
export function createHash(algorithm: string): Hash {
  if (!sameAsciiLetters(algorithm, "sha256"))
    throw new TypeError("Digest method not supported");
  const context = new Uint8Array(CC_SHA256_CTX.size);
  let finalized = false;
  CC_SHA256_Init(context);
  const hash: Hash = {
    update(data: string | Uint8Array): Hash {
      if (finalized) throw new TypeError("Digest already called");
      const bytes = typeof data === "string" ? encodeUTF8(data) : data;
      let offset = 0;
      while (bytes.length - offset > updateChunkBytes) {
        CC_SHA256_Update(
          context,
          bytes.subarray(offset, offset + updateChunkBytes),
          updateChunkBytes,
        );
        offset += updateChunkBytes;
      }
      CC_SHA256_Update(
        context,
        offset === 0 ? bytes : bytes.subarray(offset),
        bytes.length - offset,
      );
      return hash;
    },
    digest(encoding?: string): string | Uint8Array {
      if (encoding === undefined) return finish();
      if (
        encoding !== undefined &&
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
  function finish(): Uint8Array {
    if (finalized) throw new TypeError("Digest already called");
    finalized = true;
    const digest = new Uint8Array(32);
    CC_SHA256_Final(digest, context);
    return digest;
  }
  return hash;
}
/** ASCII case-insensitive equality with a lowercase `name`. */
function sameAsciiLetters(text: string, name: string): boolean {
  if (text.length !== name.length) return false;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    const lower = code >= 65 && code <= 90 ? code + 32 : code;
    if (lower !== name.charCodeAt(index)) return false;
  }
  return true;
}
