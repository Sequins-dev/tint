import {
  nativeWeakSlotMarker,
  nativeWeakSlotByteLength,
  nativeWeakSlotWeak,
  nativeWeakSlotEphemeron,
  nativeWeakSlotKeyOffset,
  nativeWeakSlotValueOffset,
} from "@tint/abi/weak-slot";
/** Reads an unsigned word only from caller-authorized memory. Values outside
 * the exact integer address domain must report undefined, never round. */
export type ReadWord = (address: number) => number | undefined;
/** The second argument is the exact word containing this reference. Visitors
 * must not mutate memory while validation or marking is still in progress. */
export type VisitReference = (address: number, slot: number) => boolean;
export type ScanStatus = "complete" | "invalid" | "read" | "limit" | "visitor";
function natural(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
function pointer(value: number): boolean {
  return natural(value) && value > 0 && value % 8 === 0;
}
function bounded(value: number): boolean {
  return natural(value) && value <= 0xffffffff;
}
function reference(
  read: ReadWord,
  address: number,
  visit: VisitReference,
  trace: boolean = true,
): ScanStatus {
  const value = read(address);
  if (value === undefined) return "read";
  if (value === 0) return "complete";
  if (!pointer(value)) return "invalid";
  return !trace || visit(value, address) ? "complete" : "visitor";
}
/** Validate a tagged slot even when a collector deliberately defers its edge. */
function general(
  read: ReadWord,
  slot: number,
  visit: VisitReference,
  trace: boolean,
): ScanStatus {
  const tag = read(slot);
  if (tag === undefined) return "read";
  if (!natural(tag) || tag > 7) return "invalid";
  return tag === 3 || tag === 5 || tag === 6 || tag === 7
    ? reference(read, slot + 8, visit, trace)
    : "complete";
}
/** Compact descriptor: reference count/offsets, then general count/offsets.
 * Offsets refer to the object or root header. No allocation occurs in the scan. */
function scanFields(
  read: ReadWord,
  descriptor: number,
  base: number,
  extent: number,
  visit: VisitReference,
  maxReferences: number,
  verifiedDescriptor: boolean,
): ScanStatus {
  const count = read(descriptor);
  if (count === undefined) return "read";
  if (!verifiedDescriptor && !bounded(count)) return "invalid";
  if (count > maxReferences) return "limit";
  for (let index = 0; index < count; index++) {
    const offset = read(descriptor + 8 + index * 8);
    if (offset === undefined) return "read";
    if (
      !verifiedDescriptor &&
      (!bounded(offset) ||
        offset < 16 ||
        offset % 8 !== 0 ||
        offset > extent - 8)
    )
      return "invalid";
    const status = reference(read, base + offset, visit);
    if (status !== "complete") return status;
  }
  const generalBase = descriptor + 8 + count * 8,
    generalCount = read(generalBase);
  if (generalCount === undefined) return "read";
  if (!verifiedDescriptor && !bounded(generalCount)) return "invalid";
  if (generalCount > maxReferences - count) return "limit";
  for (let index = 0; index < generalCount; index++) {
    const offset = read(generalBase + 8 + index * 8);
    if (offset === undefined) return "read";
    if (
      !verifiedDescriptor &&
      (!bounded(offset) ||
        offset < 16 ||
        offset % 8 !== 0 ||
        offset > extent - 16)
    )
      return "invalid";
    const status = general(read, base + offset, visit, true);
    if (status !== "complete") return status;
  }
  return "complete";
}
/** Scans one exact allocation. Descriptor storage is external immutable memory;
 * the reader, not an unchecked native dereference, authorizes all reads. */
function scanObject(
  read: ReadWord,
  address: number,
  byteLength: number,
  visit: VisitReference,
  maxReferences: number,
  verifiedDescriptor: boolean,
  traceWeakReferences: boolean,
): ScanStatus {
  if (
    !pointer(address) ||
    !bounded(byteLength) ||
    byteLength < 16 ||
    !bounded(maxReferences) ||
    !natural(address + byteLength)
  )
    return "invalid";
  const marker = read(address),
    flags = read(address + 8);
  if (marker === undefined || flags === undefined) return "read";
  if (marker === nativeWeakSlotMarker) {
    if (
      byteLength !== nativeWeakSlotByteLength ||
      (flags !== nativeWeakSlotWeak && flags !== nativeWeakSlotEphemeron)
    )
      return "invalid";
    if (maxReferences < 2) return "limit";
    const key = general(
      read,
      address + nativeWeakSlotKeyOffset,
      visit,
      traceWeakReferences,
    );
    return key === "complete"
      ? general(
          read,
          address + nativeWeakSlotValueOffset,
          visit,
          traceWeakReferences,
        )
      : key;
  }
  if (marker === 6) {
    if (byteLength < 32 || flags !== 0) return "invalid";
    const capacity = read(address + 16),
      reserved = read(address + 24);
    if (capacity === undefined || reserved === undefined) return "read";
    if (
      !bounded(capacity) ||
      reserved !== 0 ||
      capacity > Math.floor((byteLength - 32) / 8)
    )
      return "invalid";
    if (capacity > maxReferences) return "limit";
    for (let index = 0; index < capacity; index++) {
      const status = reference(read, address + 32 + index * 8, visit);
      if (status !== "complete") return status;
    }
    return "complete";
  }
  if (marker >= 1 && marker <= 5) {
    const length = read(address + 16);
    if (length === undefined) return "read";
    if (!bounded(length) || byteLength < (marker === 1 ? 24 : 32))
      return "invalid";
    if (flags === 2 && marker !== 1) {
      if (byteLength < 40) return "invalid";
      if (maxReferences === 0) return "limit";
      return reference(read, address + 32, visit);
    }
    if (flags !== 0 && flags !== 1) return "invalid";
    if (flags === 0) {
      const width =
        marker === 1 || marker === 3
          ? 2
          : marker === 2
            ? 1
            : marker === 4
              ? 4
              : 8;
      if (length * width > byteLength - (marker === 1 ? 24 : 32))
        return "invalid";
    }
    return "complete";
  }
  if (!pointer(marker) || flags !== 0) return "invalid";
  const extent = read(marker);
  if (extent === undefined) return "read";
  if (
    (!verifiedDescriptor && (!bounded(extent) || extent < 16)) ||
    extent > byteLength
  )
    return "invalid";
  return scanFields(
    read,
    marker + 8,
    address,
    extent,
    visit,
    maxReferences,
    verifiedDescriptor,
  );
}
/** Root frames are external stack memory. Bound both chain length and per-frame
 * descriptor size; only a complete scan may authorize a later sweep. */
function scanRoots(
  read: ReadWord,
  head: number,
  visit: VisitReference,
  maxFrames: number,
  maxReferencesPerFrame: number,
  verifiedDescriptor: boolean,
): ScanStatus {
  if (!natural(head) || !bounded(maxFrames) || !bounded(maxReferencesPerFrame))
    return "invalid";
  let frame = head;
  for (let count = 0; frame !== 0; count++) {
    if (count >= maxFrames) return "limit";
    if (!pointer(frame)) return "invalid";
    const previous = read(frame),
      descriptor = read(frame + 8);
    if (previous === undefined || descriptor === undefined) return "read";
    if (!natural(previous) || !pointer(descriptor)) return "invalid";
    const status = scanFields(
      read,
      descriptor,
      frame,
      0xffffffff,
      visit,
      maxReferencesPerFrame,
      verifiedDescriptor,
    );
    if (status !== "complete") return status;
    frame = previous;
  }
  return "complete";
}

/** Checked scanner for descriptors supplied by an embedding or an unproved mutator. */
export function scanNativeObject(
  read: ReadWord,
  address: number,
  byteLength: number,
  visit: VisitReference,
  maxReferences: number = 1000000,
  traceWeakReferences: boolean = true,
): ScanStatus {
  return scanObject(
    read,
    address,
    byteLength,
    visit,
    maxReferences,
    false,
    traceWeakReferences,
  );
}
export function scanNativeRoots(
  read: ReadWord,
  head: number,
  visit: VisitReference,
  maxFrames: number = 1000000,
  maxReferencesPerFrame: number = 1000000,
): ScanStatus {
  return scanRoots(read, head, visit, maxFrames, maxReferencesPerFrame, false);
}
/** Requires compiler-verified, immutable descriptors and headers published only by
 * the managed allocator/emitter. Counts, offsets, alignment and descriptor extent
 * have already been proved. Runtime addresses, payload tags, reference values,
 * reader authorization and resource limits remain checked. This capability must
 * not be used for arbitrary FFI objects, raw-memory mutators or unverified images. */
export function scanNativeObjectWithVerifiedDescriptor(
  read: ReadWord,
  address: number,
  byteLength: number,
  visit: VisitReference,
  maxReferences: number = 1000000,
  traceWeakReferences: boolean = true,
): ScanStatus {
  return scanObject(
    read,
    address,
    byteLength,
    visit,
    maxReferences,
    true,
    traceWeakReferences,
  );
}
/** Same descriptor proof contract as scanNativeObjectWithVerifiedDescriptor,
 * including compiler-published root frames and immutable root descriptors. */
export function scanNativeRootsWithVerifiedDescriptors(
  read: ReadWord,
  head: number,
  visit: VisitReference,
  maxFrames: number = 1000000,
  maxReferencesPerFrame: number = 1000000,
): ScanStatus {
  return scanRoots(read, head, visit, maxFrames, maxReferencesPerFrame, true);
}
