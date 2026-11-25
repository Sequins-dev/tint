import {
  nativeWeakSlotMarker,
  nativeWeakSlotByteLength,
  nativeWeakSlotWeak,
  nativeWeakSlotEphemeron,
} from "@tint/abi/weak-slot";
import {
  nativeStringLengthOffset,
  nativeStringDataOffset,
  nativeStringOneByteFlag,
  nativeStringDataBytes,
  nativeStringSlicedFlag,
  nativeStringSlicedByteLength,
  nativeArrayLengthOffset,
  nativeArrayInlineOffset,
  nativeArrayBorrowedByteLength,
  nativeArrayViewByteLength,
} from "@tint/abi/host";
import { headerMarker, headerFlags, type ReadWord } from "./scan.ts";
/** Decode a 16-byte-aligned allocation extent from an original object header.
 * The caller proves that address is an object start, headers are initialized and
 * immutable, and read authorizes descriptor memory. This does not prove liveness
 * or validate edges/backing pointers. end is the exclusive containing limit.
 * Optional caller-owned one-byte classification receives the marker (plus 8 for views: array views and sliced strings) for
 * built-in headers, or zero for records, only after successful validation. */
export function nativeObjectExtent(
  read: ReadWord,
  address: number,
  end: number,
  classification?: Uint8Array,
): number | undefined {
  if (
    !Number.isSafeInteger(address) ||
    address <= 0 ||
    address % 16 !== 0 ||
    !Number.isSafeInteger(end) ||
    end < address ||
    end - address < 16
  )
    return undefined;
  const header = read(address);
  if (header === undefined || !Number.isSafeInteger(header) || header <= 0)
    return undefined;
  const marker = headerMarker(header),
    flags = headerFlags(header);
  if (marker <= 0) return undefined;
  let size = 0;
  if (marker === nativeWeakSlotMarker) {
    if (flags !== nativeWeakSlotWeak && flags !== nativeWeakSlotEphemeron)
      return undefined;
    size = nativeWeakSlotByteLength;
  } else if (marker === 6) {
    if (end - address < nativeArrayInlineOffset || flags !== 0)
      return undefined;
    const capacity = read(address + nativeArrayLengthOffset),
      reserved = read(address + nativeArrayInlineOffset - 8);
    if (
      capacity === undefined ||
      !Number.isInteger(capacity) ||
      capacity < 0 ||
      capacity > 536870906 ||
      reserved !== 0
    )
      return undefined;
    size = nativeArrayInlineOffset + capacity * 8;
  } else if (marker <= 5) {
    if (end - address < nativeStringDataOffset) return undefined;
    const word = read(address + nativeStringLengthOffset);
    // A string's length is the word's low 32 bits (above it, its index
    // field); arrays share the offset.
    const length =
      word === undefined || marker !== 1 ? word : word % 4294967296;
    if (
      length === undefined ||
      !Number.isInteger(length) ||
      length < 0 ||
      length > 0xffffffff
    )
      return undefined;
    if (marker === 1 && flags >= nativeStringSlicedFlag) {
      // A sliced string views its flat parent's units.
      if (flags > nativeStringSlicedFlag + nativeStringOneByteFlag)
        return undefined;
      size = nativeStringSlicedByteLength;
    } else if (marker === 1) {
      // Flat strings own their payload: two-byte (flags 0) or one-byte.
      if (flags !== 0 && flags !== nativeStringOneByteFlag) return undefined;
      size =
        nativeStringDataOffset +
        nativeStringDataBytes(length, flags === nativeStringOneByteFlag);
    } else if (flags === 2) size = nativeArrayViewByteLength;
    else if (flags === 1) size = nativeArrayBorrowedByteLength;
    else if (flags === 0) {
      const width = marker === 2 ? 1 : marker === 3 ? 2 : marker === 4 ? 4 : 8;
      size = nativeArrayInlineOffset + length * width;
    } else return undefined;
  } else {
    if (marker % 8 !== 0 || flags !== 0) return undefined;
    const extent = read(marker);
    if (
      extent === undefined ||
      !Number.isInteger(extent) ||
      extent < 8 ||
      extent % 8 !== 0
    )
      return undefined;
    size = extent;
  }
  size = Math.ceil(size / 16) * 16;
  if (size > 0xffffffff || size > end - address) return undefined;
  if (classification !== undefined)
    classification[0] =
      marker <= nativeWeakSlotMarker
        ? marker +
          (flags === 2 || (marker === 1 && flags >= nativeStringSlicedFlag)
            ? 8
            : 0)
        : 0;
  return size;
}
