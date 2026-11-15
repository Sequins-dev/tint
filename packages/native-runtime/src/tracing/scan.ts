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
/** Stack-map registry and tables (see docs/gc-stack-maps.md). The registry
 * is permanent control memory published in hosted context word 0:
 *   +0 entry count, +8 capacity, +16 walk start (the frame pointer of the
 *   function that last read the root head), +24 reserved, then per entry
 *   +0 code start, +8 code byte length, +16 table address (0: a transparent
 *   range, e.g. diagnostics thunks, whose frames hold no roots).
 * A table: magic, version, entry count, then one word per safepoint, sorted by
 * return offset (relative to the code start): map word index * 2^32 + return
 * offset. A map: frame bytes, then a compact descriptor (reference count and
 * offsets, general count and offsets) relative to the frame's stack pointer,
 * which is its frame pointer minus frame bytes. Codegen emits the same
 * constants (packages/abi/src/host.ts); they are repeated here because the
 * runtime is also compiled from frozen snapshots. */
export const stackMapMagic = 0x50414d53;
export const stackMapVersion = 1;
export const stackMapRegistryHeaderBytes = 32;
export const stackMapRegistryEntryBytes = 24;
export const stackMapTableHeaderBytes = 24;
/** Called once per managed frame with its map's descriptor (the word after
 * frame bytes) and the frame's stack pointer. */
export type VisitFrame = (
  descriptor: number,
  base: number,
  extent: number,
) => boolean;
/** Walks the frame-pointer chain from the registry's walk start to the entry
 * record (a frame record whose saved frame pointer is 0), mapping each return address to its
 * safepoint. Return addresses outside every registered range, missing
 * safepoints, malformed tables and frames whose size disagrees with the chain
 * are invalid: the walk never guesses. Frames are bounded by maxFrames. */
export function walkNativeStack(
  read: ReadWord,
  registry: number,
  visit: VisitFrame,
  maxFrames: number,
): ScanStatus {
  if (!natural(registry) || !bounded(maxFrames)) return "invalid";
  if (registry === 0) return "complete";
  if (registry % 8 !== 0) return "invalid";
  const count = read(registry),
    capacity = read(registry + 8),
    start = read(registry + 16);
  if (count === undefined || capacity === undefined || start === undefined)
    return "read";
  if (!bounded(count) || !bounded(capacity) || count > capacity)
    return "invalid";
  if (start === 0) return "complete";
  let current = start,
    afterTransparent = false;
  for (let frames = 0; ; frames++) {
    if (frames >= maxFrames) return "limit";
    if (!pointer(current) || current % 16 !== 0) return "invalid";
    const caller = read(current),
      returnAddress = read(current + 8);
    if (caller === undefined || returnAddress === undefined) return "read";
    if (caller === 0) return "complete";
    if (!pointer(caller) || caller % 16 !== 0 || caller <= current)
      return "invalid";
    // The entry's own record (saved frame pointer 0): this frame returns
    // into startup code, which holds no references.
    const entry = read(caller);
    if (entry === undefined) return "read";
    if (entry === 0) return "complete";
    if (!natural(returnAddress)) return "invalid";
    let table = -1,
      offset = 0;
    for (let index = 0; index < count; index++) {
      const entry = registry + stackMapRegistryHeaderBytes + index * 24,
        codeStart = read(entry),
        codeLength = read(entry + 8);
      if (codeStart === undefined || codeLength === undefined) return "read";
      if (
        returnAddress >= codeStart &&
        returnAddress - codeStart < codeLength
      ) {
        const address = read(entry + 16);
        if (address === undefined) return "read";
        table = address;
        offset = returnAddress - codeStart;
        break;
      }
    }
    // Unknown code: the walk cannot tell its frame layout.
    if (table < 0) return "invalid";
    if (table === 0) {
      current = caller;
      afterTransparent = true;
      continue;
    }
    if (!pointer(table)) return "invalid";
    const magic = read(table),
      version = read(table + 8),
      entries = read(table + 16);
    if (magic === undefined || version === undefined || entries === undefined)
      return "read";
    if (
      magic !== stackMapMagic ||
      version !== stackMapVersion ||
      !bounded(entries)
    )
      return "invalid";
    let low = 0,
      high = entries,
      map = -1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2),
        word = read(table + stackMapTableHeaderBytes + middle * 8);
      if (word === undefined) return "read";
      if (!natural(word)) return "invalid";
      const key = word % 4294967296;
      if (key === offset) {
        map = table + Math.floor(word / 4294967296) * 8;
        break;
      }
      if (key < offset) low = middle + 1;
      else high = middle;
    }
    // A return address inside managed code without a safepoint.
    if (map < 0) return "invalid";
    const frameBytes = read(map);
    if (frameBytes === undefined) return "read";
    if (
      !bounded(frameBytes) ||
      frameBytes % 16 !== 0 ||
      frameBytes > caller ||
      (!afterTransparent && caller - frameBytes !== current + 16)
    )
      return "invalid";
    if (!visit(map + 8, caller - frameBytes, frameBytes)) return "visitor";
    current = caller;
    afterTransparent = false;
  }
}
/** Stack frames are external stack memory; their maps are immutable code
 * metadata. Bound both the frame count and each map's size; only a complete
 * scan may authorize a later sweep. `head` is the stack-map registry. */
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
  let failure: ScanStatus = "complete";
  const status = walkNativeStack(
    read,
    head,
    (descriptor, base, extent) => {
      failure = scanFields(
        read,
        descriptor,
        base,
        extent,
        visit,
        maxReferencesPerFrame,
        verifiedDescriptor,
      );
      return failure === "complete";
    },
    maxFrames,
  );
  return status === "visitor" ? failure : status;
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
