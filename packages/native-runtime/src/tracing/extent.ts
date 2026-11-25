import {
  nativeWeakSlotMarker,
  nativeWeakSlotByteLength,
  nativeWeakSlotWeak,
  nativeWeakSlotEphemeron,
} from "@tint/abi/weak-slot";
import {
  nativeStringLengthOffset,
  nativeStringDataOffset,
  nativeArrayLengthOffset,
  nativeArrayInlineOffset,
  nativeArrayBorrowedByteLength,
  nativeArrayViewByteLength,
  nativeTypedArrayElementBytes,
  nativeTypedArrayMarker,
  nativeBuiltinMarkerLimit,
} from "@tint/abi/host";
import { headerMarker, headerFlags, type ReadWord } from "./scan.ts";
/** Decode a 16-byte-aligned allocation extent from an original object header.
 * The caller proves that address is an object start, headers are initialized and
 * immutable, and read authorizes descriptor memory. This does not prove liveness
 * or validate edges/backing pointers. end is the exclusive containing limit.
 * Optional caller-owned one-byte classification receives the marker (a typed
 * array's width class; plus 8 for array views) for built-in headers, or zero
 * for records, only after successful validation. */
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
  } else if (marker === 1 || nativeTypedArrayMarker(marker)) {
    if (end - address < nativeStringDataOffset) return undefined;
    const length = read(address + nativeStringLengthOffset);
    if (
      length === undefined ||
      !Number.isInteger(length) ||
      length < 0 ||
      length > 0xffffffff
    )
      return undefined;
    if (marker === 1) {
      // Managed strings own their UTF-16 payload. Borrowed strings are not part
      // of this allocation domain; accepting them would invent an extent.
      if (flags !== 0) return undefined;
      // At least four units' space (inline comparisons read them).
      size = nativeStringDataOffset + Math.max(length, 4) * 2;
    } else if (flags === 2) size = nativeArrayViewByteLength;
    else if (flags === 1) size = nativeArrayBorrowedByteLength;
    else if (flags === 0) {
      const width = nativeTypedArrayElementBytes(marker);
      size = nativeArrayInlineOffset + length * width;
    } else return undefined;
  } else {
    if (marker < nativeBuiltinMarkerLimit || (marker & 7) !== 0 || flags !== 0)
      return undefined;
    const extent = read(marker);
    if (
      extent === undefined ||
      !Number.isInteger(extent) ||
      extent < 8 ||
      (extent & 7) !== 0
    )
      return undefined;
    size = extent;
  }
  size = Math.ceil(size / 16) * 16;
  if (size > 0xffffffff || size > end - address) return undefined;
  // Typed arrays classify by width class, which fits the caller's four bits.
  if (classification !== undefined) {
    const view = flags === 2 ? 8 : 0;
    let kind = 0;
    if (nativeTypedArrayMarker(marker)) kind = (marker & 7) + view;
    else if (marker <= nativeWeakSlotMarker) kind = marker + view;
    classification[0] = kind;
  }
  return size;
}
