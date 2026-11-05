import {
  nativeWeakSlotMarker,
  nativeWeakSlotByteLength,
  nativeWeakSlotWeak,
  nativeWeakSlotEphemeron,
} from "@tint/abi/weak-slot";
import type { ReadWord } from "./scan.ts";
/** Decode a 16-byte-aligned allocation extent from an original object header.
 * The caller proves that address is an object start, headers are initialized and
 * immutable, and read authorizes descriptor memory. This does not prove liveness
 * or validate edges/backing pointers. end is the exclusive containing limit.
 * Optional caller-owned one-byte classification receives the marker (plus 8 for array views) for
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
  const marker = read(address),
    flags = read(address + 8);
  if (
    marker === undefined ||
    flags === undefined ||
    !Number.isSafeInteger(marker) ||
    marker <= 0
  )
    return undefined;
  let size = 0;
  if (marker === nativeWeakSlotMarker) {
    if (flags !== nativeWeakSlotWeak && flags !== nativeWeakSlotEphemeron)
      return undefined;
    size = nativeWeakSlotByteLength;
  } else if (marker === 6) {
    if (end - address < 32 || flags !== 0) return undefined;
    const capacity = read(address + 16),
      reserved = read(address + 24);
    if (
      capacity === undefined ||
      !Number.isInteger(capacity) ||
      capacity < 0 ||
      capacity > 536870906 ||
      reserved !== 0
    )
      return undefined;
    size = 32 + capacity * 8;
  } else if (marker <= 5) {
    if (end - address < 24) return undefined;
    const length = read(address + 16);
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
      size = 24 + length * 2;
    } else if (flags === 2) size = 48;
    else if (flags === 1) size = 32;
    else if (flags === 0) {
      const width = marker === 2 ? 1 : marker === 3 ? 2 : marker === 4 ? 4 : 8;
      size = 32 + length * width;
    } else return undefined;
  } else {
    if (marker % 8 !== 0 || flags !== 0) return undefined;
    const extent = read(marker);
    if (
      extent === undefined ||
      !Number.isInteger(extent) ||
      extent < 16 ||
      extent % 8 !== 0
    )
      return undefined;
    size = extent;
  }
  size = Math.ceil(size / 16) * 16;
  if (size > 0xffffffff || size > end - address) return undefined;
  if (classification !== undefined)
    classification[0] =
      marker <= nativeWeakSlotMarker ? marker + (flags === 2 ? 8 : 0) : 0;
  return size;
}
