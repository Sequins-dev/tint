import { readUnsigned, writeUnsigned } from "@tint/foundation/binary/bytes";
import { sha256 } from "@tint/foundation/binary/sha256";
/** A complete serialized embedded blob, including its big-endian magic/length header.
 * Slots below 0x1000 are bound through CodeDirectory's negative hash indices. */
export interface SignatureBlob {
  readonly slot: number;
  readonly bytes: Uint8Array;
}
export interface SignatureOptions {
  readonly specialBlobs?: readonly SignatureBlob[] | undefined;
  readonly identifier: string;
  readonly executableOffset: number;
  readonly executableLength: number;
  readonly mainExecutable: boolean;
}
export type SignatureError =
  | "INVALID_LENGTH"
  | "INVALID_IDENTIFIER"
  | "INVALID_EXECUTABLE_RANGE"
  | "INVALID_FLAGS"
  | "INVALID_BLOB";
export type SignatureResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SignatureError };
function uint32(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
}
function put32(bytes: Uint8Array, offset: number, value: number): void {
  if (!writeUnsigned(bytes, offset, 4, value, "big").ok)
    throw "CodeDirectory serialization invariant";
}
function put64(bytes: Uint8Array, offset: number, value: number): void {
  put32(bytes, offset, 0);
  put32(bytes, offset + 4, value);
}
export function signatureSize(
  codeLength: number,
  identifier: string,
  specialBlobs?: readonly SignatureBlob[],
): SignatureResult<number> {
  if (!uint32(codeLength)) return { ok: false, error: "INVALID_LENGTH" };
  if (identifier.length === 0 || identifier.length > 255)
    return { ok: false, error: "INVALID_IDENTIFIER" };
  for (let i = 0; i < identifier.length; i++) {
    const c = identifier.charCodeAt(i);
    if (c < 32 || c > 126) return { ok: false, error: "INVALID_IDENTIFIER" };
  }
  let specialSlots = 0,
    blobBytes = 0;
  if (specialBlobs !== undefined) {
    const blobs = specialBlobs;
    for (let index = 0; index < blobs.length; index++) {
      const blob = blobs[index];
      if (
        blob === undefined ||
        !Number.isInteger(blob.slot) ||
        blob.slot < 1 ||
        blob.slot >= 0x1000 ||
        blob.bytes.length < 8
      )
        return { ok: false, error: "INVALID_BLOB" };
      const length = readUnsigned(blob.bytes, 4, 4, "big");
      if (!length.ok || length.value !== blob.bytes.length)
        return { ok: false, error: "INVALID_BLOB" };
      for (let previous = 0; previous < index; previous++)
        if (blobs[previous]?.slot === blob.slot)
          return { ok: false, error: "INVALID_BLOB" };
      specialSlots = Math.max(specialSlots, blob.slot);
      blobBytes += blob.bytes.length;
    }
  }
  const value =
    20 +
    (specialBlobs?.length ?? 0) * 8 +
    88 +
    identifier.length +
    1 +
    specialSlots * 32 +
    Math.ceil(codeLength / 4096) * 32 +
    blobBytes;
  return uint32(value)
    ? { ok: true, value }
    : { ok: false, error: "INVALID_LENGTH" };
}
/** Embedded ad-hoc signature over the exact supplied prefix; no certificate/CMS. */
export function signCode(
  code: Uint8Array,
  options: SignatureOptions,
): SignatureResult<Uint8Array> {
  const size = signatureSize(
    code.length,
    options.identifier,
    options.specialBlobs,
  );
  if (!size.ok) return size;
  if (
    !uint32(options.executableOffset) ||
    !uint32(options.executableLength) ||
    options.executableOffset > code.length ||
    options.executableLength > code.length - options.executableOffset
  )
    return { ok: false, error: "INVALID_EXECUTABLE_RANGE" };
  if (typeof options.mainExecutable !== "boolean")
    return { ok: false, error: "INVALID_FLAGS" };
  const blobs = options.specialBlobs;
  const count = blobs?.length ?? 0;
  let specialSlots = 0;
  if (blobs !== undefined)
    for (const blob of blobs) {
      if (blob === undefined) throw "SIGNATURE_BLOB_INVARIANT";
      specialSlots = Math.max(specialSlots, blob.slot);
    }
  const bytes = new Uint8Array(size.value),
    cd = 20 + count * 8;
  const hashOffset = 88 + options.identifier.length + 1 + specialSlots * 32;
  const slots = Math.ceil(code.length / 4096);
  const directorySize = hashOffset + slots * 32;
  put32(bytes, 0, 0xfade0cc0);
  put32(bytes, 4, bytes.length);
  put32(bytes, 8, count + 1);
  put32(bytes, 12, 0);
  put32(bytes, 16, cd);
  put32(bytes, cd, 0xfade0c02);
  put32(bytes, cd + 4, directorySize);
  put32(bytes, cd + 8, 0x20400);
  put32(bytes, cd + 12, 2);
  put32(bytes, cd + 16, hashOffset);
  put32(bytes, cd + 20, 88);
  put32(bytes, cd + 24, specialSlots);
  put32(bytes, cd + 28, slots);
  put32(bytes, cd + 32, code.length);
  bytes[cd + 36] = 32;
  bytes[cd + 37] = 2;
  bytes[cd + 38] = 0;
  bytes[cd + 39] = 12;
  put64(bytes, cd + 64, options.executableOffset);
  put64(bytes, cd + 72, options.executableLength);
  put64(bytes, cd + 80, options.mainExecutable ? 1 : 0);
  // Zero-initialization supplies spare/scatter/team/codeLimit64 fields and the NUL.
  for (let i = 0; i < options.identifier.length; i++)
    bytes[cd + 88 + i] = options.identifier.charCodeAt(i);
  if (blobs !== undefined) {
    let offset = cd + directorySize;
    for (let index = 0; index < blobs.length; index++) {
      const blob = blobs[index];
      if (blob === undefined) throw "SIGNATURE_BLOB_INVARIANT";
      put32(bytes, 20 + index * 8, blob.slot);
      put32(bytes, 24 + index * 8, offset);
      bytes.set(blob.bytes, offset);
      bytes.set(sha256(blob.bytes), cd + hashOffset - blob.slot * 32);
      offset += blob.bytes.length;
    }
  }
  for (let page = 0; page < slots; page++) {
    const begin = page * 4096;
    const end = begin + 4096 < code.length ? begin + 4096 : code.length;
    bytes.set(sha256(code.subarray(begin, end)), cd + hashOffset + page * 32);
  }
  return { ok: true, value: bytes };
}
