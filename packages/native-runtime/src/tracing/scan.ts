import { transitionFrame, transitionTable } from "./transitions.ts";
import {
  nativeWeakSlotMarker,
  nativeWeakSlotByteLength,
  nativeWeakSlotWeak,
  nativeWeakSlotEphemeron,
  nativeWeakSlotKeyOffset,
  nativeWeakSlotValueOffset,
} from "@tint/abi/weak-slot";
import {
  nativeHeaderByteLength,
  nativeHeaderFlagUnit,
  nativeStringLengthOffset,
  nativeStringDataOffset,
  nativeArrayLengthOffset,
  nativeArrayInlineOffset,
  nativeArrayOwnerOffset,
  nativeArrayViewByteLength,
  nativeTypedArrayMarker,
  nativeTypedArrayElementBytes,
  nativeBuiltinMarkerLimit,
} from "@tint/abi/host";
/** Layout marker (or descriptor address) of a live header. */
export function headerMarker(header: number): number {
  return header < nativeHeaderFlagUnit ? header : header % nativeHeaderFlagUnit;
}
/** Kind flags of a live header. */
export function headerFlags(header: number): number {
  return header < nativeHeaderFlagUnit
    ? 0
    : Math.floor(header / nativeHeaderFlagUnit);
}
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
        offset < nativeHeaderByteLength ||
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
        offset < nativeHeaderByteLength ||
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
    byteLength < 8 ||
    !bounded(maxReferences) ||
    !natural(address + byteLength)
  )
    return "invalid";
  const header = read(address);
  if (header === undefined) return "read";
  const marker = headerMarker(header),
    flags = headerFlags(header);
  if (marker === nativeWeakSlotMarker) {
    if (
      // Region heaps round extents to their 16-byte granule.
      byteLength < nativeWeakSlotByteLength ||
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
    if (byteLength < nativeArrayInlineOffset || flags !== 0) return "invalid";
    const capacity = read(address + nativeArrayLengthOffset),
      reserved = read(address + nativeArrayInlineOffset - 8);
    if (capacity === undefined || reserved === undefined) return "read";
    if (
      !bounded(capacity) ||
      reserved !== 0 ||
      capacity > Math.floor((byteLength - nativeArrayInlineOffset) / 8)
    )
      return "invalid";
    if (capacity > maxReferences) return "limit";
    for (let index = 0; index < capacity; index++) {
      const status = reference(
        read,
        address + nativeArrayInlineOffset + index * 8,
        visit,
      );
      if (status !== "complete") return status;
    }
    return "complete";
  }
  if (marker === 1 || nativeTypedArrayMarker(marker)) {
    // Strings and arrays share the length offset.
    const length = read(address + nativeStringLengthOffset),
      payload = marker === 1 ? nativeStringDataOffset : nativeArrayInlineOffset;
    if (length === undefined) return "read";
    if (!bounded(length) || byteLength < payload) return "invalid";
    if (flags === 2 && marker !== 1) {
      if (byteLength < nativeArrayViewByteLength) return "invalid";
      if (maxReferences === 0) return "limit";
      return reference(read, address + nativeArrayOwnerOffset, visit);
    }
    if (flags !== 0 && flags !== 1) return "invalid";
    if (flags === 0) {
      const width = marker === 1 ? 2 : nativeTypedArrayElementBytes(marker);
      if (length * width > byteLength - payload) return "invalid";
    }
    return "complete";
  }
  if (marker < nativeBuiltinMarkerLimit || !pointer(marker) || flags !== 0)
    return "invalid";
  const extent = read(marker);
  if (extent === undefined) return "read";
  if (
    (!verifiedDescriptor && (!bounded(extent) || extent < 8)) ||
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
 *   function that last read the root head), +24 that function's save block
 *   (x19..x28 at +8i), or one plus the return address into it of a call
 *   whose map describes its saves, or 0 when unknown, then per entry
 *   +0 code start, +8 code byte length, +16 table address (0: a transparent
 *   range, e.g. diagnostics thunks, whose frames hold no roots and pass
 *   x19..x28 through without saving them).
 *
 * Tables start with magic, version and a count. A compact table
 * (stackMapCompactVersion) counts functions; a directory word per function,
 * sorted by start, holds start / 4 + record word index * 2^30. A record:
 * its byte distance from the function start, safepoint count * 4 + unit
 * width (0: three 16-bit units per word, 1: two 26-bit, 2: one per word),
 * the units (return offsets from the function start / 4, ascending, then
 * residual stream positions), then a varint stream six bytes per word:
 * frame bytes / 16, saved register mask, save offsets / 8; long word count
 * and per long word its key delta (key = sp-relative word index * 2 +
 * general), run count and runs (gap, length - 1) over safepoint indexes;
 * residual records (held register mask, count, key deltas). A safepoint
 * lists the long words whose runs contain its index and its residual words.
 *
 * Packed (stackMapVersion) and wide (stackMapWideVersion) tables count
 * safepoints, one word each (map word index * 2^32 + return offset) or two
 * (return offset, map word index), and maps of full words: frame bytes,
 * reference count and offsets, general count and offsets, the register word
 * (bit i < 10 when the prologue saved x(19 + i), bit 10 + i when x(19 + i)
 * holds a live reference) and the saved registers' save offsets.
 *
 * Offsets are relative to the frame's stack pointer (its frame pointer minus
 * frame bytes). A register's value during a call lives where the nearest
 * callee saved it, or in the walk start's save block. Codegen emits the same
 * constants (packages/abi/src/host.ts); they are repeated here because the
 * runtime is also compiled from frozen snapshots. */
export const stackMapMagic = 0x50414d53;
export const stackMapVersion = 2;
export const stackMapWideVersion = 3;
export const stackMapCompactVersion = 4;
export const stackMapRegistryHeaderBytes = 32;
export const stackMapRegistryEntryBytes = 24;
export const stackMapTableHeaderBytes = 24;
const recordShift = 1073741824;
const streamBytes = 6;
/** Called with each exact word a frame lists: a reference (frame slots and
 * the callee save slots of register-held references) or the tag word of a
 * tagged general value. */
export type VisitWord = (address: number) => boolean;
/** Bit i of a register mask names x(19 + i). */
const savedRegisterCount = 10;
const registerMaskLimit = 1024;
/** Powers of 256 for a stream byte's position in its word. */
function byteScale(index: number): number {
  return index === 0
    ? 1
    : index === 1
      ? 256
      : index === 2
        ? 65536
        : index === 3
          ? 16777216
          : index === 4
            ? 4294967296
            : 1099511627776;
}
/** The varint at stream position `position` (word address + byte index):
 * value * 8 + bytes consumed, or -3 unreadable / -4 malformed. Plain
 * arithmetic only: the walk must not allocate. */
function varint(read: ReadWord, position: number): number {
  let index = position % 8,
    address = position - index;
  if (index >= streamBytes) return -4;
  const first = read(address);
  if (first === undefined) return -3;
  if (!natural(first)) return -4;
  let word = Math.floor(first / byteScale(index)),
    value = 0,
    factor = 1;
  for (let consumed = 1; consumed <= 6; consumed++) {
    if (index === streamBytes) {
      address += 8;
      index = 0;
      const next = read(address);
      if (next === undefined) return -3;
      if (!natural(next)) return -4;
      word = next;
    }
    const byte = word % 256;
    word = (word - byte) / 256;
    index++;
    if (byte < 128) return (value + byte * factor) * 8 + consumed;
    value += (byte - 128) * factor;
    factor *= 128;
  }
  return -4;
}
/** The stream position `bytes` past `position`. */
function advance(position: number, bytes: number): number {
  const index = (position % 8) + bytes;
  return (
    position -
    (position % 8) +
    Math.floor(index / streamBytes) * 8 +
    (index % streamBytes)
  );
}
/** Unit `index` of a compact record, or -3 unreadable. */
function recordUnit(
  read: ReadWord,
  record: number,
  index: number,
  width: number,
): number {
  const perWord = width === 0 ? 3 : width === 1 ? 2 : 1,
    word = read(record + 16 + Math.floor(index / perWord) * 8);
  if (word === undefined) return -3;
  if (width === 2) return word;
  const scale = width === 0 ? 65536 : 67108864,
    part = index % perWord;
  return (
    Math.floor(word / (part === 0 ? 1 : part === 1 ? scale : scale * scale)) %
    scale
  );
}
/** A compact record's header word, validated: count * 4 + width, or -3 / -4. */
function recordHeader(read: ReadWord, record: number): number {
  const header = read(record + 8);
  if (header === undefined) return -3;
  if (!natural(header) || header % 4 > 2) return -4;
  return header;
}
/** The stream base of a compact record (word aligned), or -3 / -4. */
function recordStream(read: ReadWord, record: number): number {
  const header = recordHeader(read, record);
  if (header < 0) return header;
  const width = header % 4,
    perWord = width === 0 ? 3 : width === 1 ? 2 : 1;
  return record + 16 + Math.ceil((Math.floor(header / 4) * 2) / perWord) * 8;
}
/** The safepoint index of `returnAddress` in a compact record, or -2 for a
 * missing safepoint, -3 / -4. */
function recordIndex(
  read: ReadWord,
  record: number,
  returnAddress: number,
): number {
  const distance = read(record),
    header = recordHeader(read, record);
  if (distance === undefined) return -3;
  if (header < 0) return header;
  if (!natural(distance)) return -4;
  const delta = returnAddress - (record - distance);
  if (delta <= 0 || delta % 4 !== 0) return -2;
  const target = delta / 4,
    width = header % 4;
  let low = 0,
    high = Math.floor(header / 4);
  while (low < high) {
    const middle = Math.floor((low + high) / 2),
      unit = recordUnit(read, record, middle, width);
    if (unit < 0) return unit;
    if (unit === target) return middle;
    if (unit < target) low = middle + 1;
    else high = middle;
  }
  return -2;
}
/** The safepoint map of a return address: a full-word map's address, a
 * compact record's address plus 4, -1 for a transparent range, -2 for
 * unknown code or a missing safepoint, -3 for an unreadable or -4 for a
 * malformed table, -5 for a callback thunk (see transitions.ts). */
function safepointMap(
  read: ReadWord,
  registry: number,
  count: number,
  returnAddress: number,
): number {
  let table = -1,
    offset = 0;
  for (let index = 0; index < count; index++) {
    const entry = registry + stackMapRegistryHeaderBytes + index * 24,
      codeStart = read(entry),
      codeLength = read(entry + 8);
    if (codeStart === undefined || codeLength === undefined) return -3;
    if (returnAddress >= codeStart && returnAddress - codeStart < codeLength) {
      const address = read(entry + 16);
      if (address === undefined) return -3;
      table = address;
      offset = returnAddress - codeStart;
      break;
    }
  }
  // Unknown code: the walk cannot tell its frame layout.
  if (table < 0) return -2;
  if (table === 0) return -1;
  if (table === transitionTable) return -5;
  if (!pointer(table)) return -4;
  const magic = read(table),
    version = read(table + 8),
    entries = read(table + 16);
  if (magic === undefined || version === undefined || entries === undefined)
    return -3;
  if (magic !== stackMapMagic || !bounded(entries)) return -4;
  if (version === stackMapCompactVersion) {
    // The last function starting at or before the offset.
    let low = 0,
      high = entries;
    while (low < high) {
      const middle = Math.floor((low + high) / 2),
        word = read(table + stackMapTableHeaderBytes + middle * 8);
      if (word === undefined) return -3;
      if (!natural(word)) return -4;
      if ((word % recordShift) * 4 < offset) low = middle + 1;
      else high = middle;
    }
    // Return offsets lie past their function's start.
    if (low === 0) return -2;
    const word = read(table + stackMapTableHeaderBytes + (low - 1) * 8);
    if (word === undefined) return -3;
    if (!natural(word)) return -4;
    return table + Math.floor(word / recordShift) * 8 + 4;
  }
  const wide = version === stackMapWideVersion;
  if (version !== stackMapVersion && !wide) return -4;
  const entryBytes = wide ? 16 : 8;
  let low = 0,
    high = entries;
  while (low < high) {
    const middle = Math.floor((low + high) / 2),
      entry = table + stackMapTableHeaderBytes + middle * entryBytes,
      word = read(entry);
    if (word === undefined) return -3;
    if (!natural(word)) return -4;
    const key = wide ? word : word % 4294967296;
    if (key === offset) {
      if (!wide) return table + Math.floor(word / 4294967296) * 8;
      const index = read(entry + 8);
      if (index === undefined) return -3;
      if (!bounded(index)) return -4;
      return table + index * 8;
    }
    if (key < offset) low = middle + 1;
    else high = middle;
  }
  // A return address inside managed code without a safepoint.
  return -2;
}
function mapStatus(code: number): ScanStatus {
  return code === -3 ? "read" : "invalid";
}
/** The address of a full-word map's register word (after its reference and
 * general offsets), or -3 unreadable / -4 malformed. */
function registerWord(read: ReadWord, map: number, frameBytes: number): number {
  const referenceCount = read(map + 8);
  if (referenceCount === undefined) return -3;
  if (!bounded(referenceCount) || referenceCount > frameBytes / 8) return -4;
  const generalAt = map + 16 + referenceCount * 8,
    generalCount = read(generalAt);
  if (generalCount === undefined) return -3;
  if (!bounded(generalCount) || generalCount > frameBytes / 8) return -4;
  return generalAt + 8 + generalCount * 8;
}
/** Visits one listed frame word (word index * 2 + general) after checking it
 * lies inside the frame: "complete", or the failing status. */
function visitKey(
  key: number,
  base: number,
  frameBytes: number,
  visitReference: VisitWord,
  visitGeneral: VisitWord,
): ScanStatus {
  const general = key % 2,
    offset = ((key - general) / 2) * 8;
  if (offset > frameBytes - (general === 1 ? 16 : 8)) return "invalid";
  return (general === 1 ? visitGeneral : visitReference)(base + offset)
    ? "complete"
    : "visitor";
}
/** Walks the frame-pointer chain from the registry's walk start to the entry
 * record (a frame record whose saved frame pointer is 0), mapping each return
 * address to its safepoint. Each frame's listed words go to `visitReference`
 * and `visitGeneral` (tag words of tagged general values); references it
 * keeps in callee-saved registers go to `visitReference` as the save slot
 * holding them. The walk start's own saves come from its save block, or from
 * the map of the return address into it the registry names instead (odd:
 * that address plus one, when the root head was read by a called binding).
 * Return addresses outside every registered range, missing safepoints,
 * malformed tables, listed words outside their frame, frames whose size
 * disagrees with the chain and register references no frame saved are
 * invalid: the walk never guesses. Frames are bounded by maxFrames and each
 * frame's listed words by maxWordsPerFrame. The walk allocates nothing:
 * maps are decoded in place with plain locals. */
export function walkNativeStack(
  read: ReadWord,
  registry: number,
  visitReference: VisitWord,
  visitGeneral: VisitWord,
  maxFrames: number,
  maxWordsPerFrame: number = 1000000,
): ScanStatus {
  if (!natural(registry) || !bounded(maxFrames) || !bounded(maxWordsPerFrame))
    return "invalid";
  if (registry === 0) return "complete";
  if (registry % 8 !== 0) return "invalid";
  const count = read(registry),
    capacity = read(registry + 8),
    start = read(registry + 16),
    block = read(registry + 24);
  if (
    count === undefined ||
    capacity === undefined ||
    start === undefined ||
    block === undefined
  )
    return "read";
  if (!bounded(count) || !bounded(capacity) || count > capacity)
    return "invalid";
  if (start === 0) return "complete";
  if (!natural(block) || (block % 8 !== 0 && block % 4 !== 1)) return "invalid";
  // Where each of x19..x28 holds the value of the frame being visited: the
  // save slot of the nearest callee that saved it (0: unknown). Plain
  // locals: the walk must not allocate.
  const known = block % 8 === 0 && block !== 0;
  let at19 = known ? block : 0,
    at20 = known ? block + 8 : 0,
    at21 = known ? block + 16 : 0,
    at22 = known ? block + 24 : 0,
    at23 = known ? block + 32 : 0,
    at24 = known ? block + 40 : 0,
    at25 = known ? block + 48 : 0,
    at26 = known ? block + 56 : 0,
    at27 = known ? block + 64 : 0,
    at28 = known ? block + 72 : 0;
  // The frame whose saves apply to the next mapped frame: its saves (a
  // full-word map's register word, or a compact stream position at the
  // saved mask) and stack pointer (-1: none). Transparent frames save
  // nothing.
  let savesAt = -1,
    savesCompact = false,
    savesBase = 0,
    savesBytes = 0;
  if (block % 4 === 1) {
    const map = safepointMap(read, registry, count, block - 1);
    if (map < 0) return map === -1 ? "invalid" : mapStatus(map);
    let frameBytes = 0;
    if (map % 8 === 4) {
      const record = map - 4,
        index = recordIndex(read, record, block - 1),
        stream = index < 0 ? index : recordStream(read, record);
      if (stream < 0) return mapStatus(stream);
      const frame = varint(read, stream);
      if (frame < 0) return mapStatus(frame);
      frameBytes = Math.floor(frame / 8) * 16;
      savesAt = advance(stream, frame % 8);
      savesCompact = true;
    } else {
      const bytes = read(map);
      if (bytes === undefined) return "read";
      if (!bounded(bytes)) return "invalid";
      frameBytes = bytes;
      const word = registerWord(read, map, frameBytes);
      if (word < 0) return mapStatus(word);
      savesAt = word;
    }
    if (frameBytes % 16 !== 0 || frameBytes > start) return "invalid";
    savesBase = start - frameBytes;
    savesBytes = frameBytes;
  }
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
    const map = safepointMap(read, registry, count, returnAddress);
    if (map === -1) {
      current = caller;
      afterTransparent = true;
      continue;
    }
    if (map === -5) {
      // A callback thunk: resume at its transition record, past the C
      // frames. Register values below it are C's, so none is known.
      const record = transitionFrame(read, caller);
      if (record === -1) return "read";
      if (record < 0) return "invalid";
      current = record;
      afterTransparent = true;
      savesAt = -1;
      at19 = 0;
      at20 = 0;
      at21 = 0;
      at22 = 0;
      at23 = 0;
      at24 = 0;
      at25 = 0;
      at26 = 0;
      at27 = 0;
      at28 = 0;
      continue;
    }
    if (map < 0) return mapStatus(map);
    // This frame's map: frame bytes, then where its saves and listed words
    // are. Compact: the record, the safepoint's index and stream positions.
    const compact = map % 8 === 4,
      record = map - 4;
    let frameBytes = 0,
      index = 0,
      stream = 0,
      ownSaves = 0;
    if (compact) {
      index = recordIndex(read, record, returnAddress);
      if (index < 0) return mapStatus(index);
      stream = recordStream(read, record);
      if (stream < 0) return mapStatus(stream);
      const frame = varint(read, stream);
      if (frame < 0) return mapStatus(frame);
      frameBytes = Math.floor(frame / 8) * 16;
      ownSaves = advance(stream, frame % 8);
    } else {
      const bytes = read(map);
      if (bytes === undefined) return "read";
      if (!bounded(bytes)) return "invalid";
      frameBytes = bytes;
    }
    if (
      frameBytes % 16 !== 0 ||
      frameBytes > caller ||
      (!afterTransparent && caller - frameBytes !== current + 16)
    )
      return "invalid";
    // The callee's saves hold this frame's values.
    if (savesAt >= 0) {
      let registers = 0,
        offsetAt = 0;
      if (savesCompact) {
        const mask = varint(read, savesAt);
        if (mask < 0) return mapStatus(mask);
        registers = Math.floor(mask / 8);
        offsetAt = advance(savesAt, mask % 8);
      } else {
        const word = read(savesAt);
        if (word === undefined) return "read";
        if (!natural(word)) return "invalid";
        registers = word;
        offsetAt = savesAt + 8;
      }
      if (registers >= registerMaskLimit * registerMaskLimit) return "invalid";
      const saved = registers % registerMaskLimit;
      for (let bit = 0; bit < savedRegisterCount; bit++) {
        if ((saved & (1 << bit)) === 0) continue;
        let offset = 0;
        if (savesCompact) {
          const value = varint(read, offsetAt);
          if (value < 0) return mapStatus(value);
          offset = Math.floor(value / 8) * 8;
          offsetAt = advance(offsetAt, value % 8);
        } else {
          const value = read(offsetAt);
          if (value === undefined) return "read";
          if (!bounded(value) || value % 8 !== 0) return "invalid";
          offset = value;
          offsetAt += 8;
        }
        if (offset > savesBytes - 8) return "invalid";
        const slot = savesBase + offset;
        if (bit === 0) at19 = slot;
        else if (bit === 1) at20 = slot;
        else if (bit === 2) at21 = slot;
        else if (bit === 3) at22 = slot;
        else if (bit === 4) at23 = slot;
        else if (bit === 5) at24 = slot;
        else if (bit === 6) at25 = slot;
        else if (bit === 7) at26 = slot;
        else if (bit === 8) at27 = slot;
        else at28 = slot;
      }
    }
    const base = caller - frameBytes;
    let held = 0,
      listed = 0;
    if (compact) {
      // Skip the saves, then the long words whose runs hold this index.
      const mask = varint(read, ownSaves);
      if (mask < 0) return mapStatus(mask);
      const saved = Math.floor(mask / 8);
      if (saved >= registerMaskLimit) return "invalid";
      let at = advance(ownSaves, mask % 8);
      for (let bit = 0; bit < savedRegisterCount; bit++) {
        if ((saved & (1 << bit)) === 0) continue;
        const value = varint(read, at);
        if (value < 0) return mapStatus(value);
        at = advance(at, value % 8);
      }
      const longCount = varint(read, at);
      if (longCount < 0) return mapStatus(longCount);
      at = advance(at, longCount % 8);
      let key = -1;
      for (let word = Math.floor(longCount / 8); word > 0; word--) {
        const delta = varint(read, at);
        if (delta < 0) return mapStatus(delta);
        at = advance(at, delta % 8);
        key += Math.floor(delta / 8) + 1;
        const runs = varint(read, at);
        if (runs < 0) return mapStatus(runs);
        at = advance(at, runs % 8);
        let end = 0,
          live = false;
        for (let run = Math.floor(runs / 8); run > 0; run--) {
          const gap = varint(read, at);
          if (gap < 0) return mapStatus(gap);
          at = advance(at, gap % 8);
          const length = varint(read, at);
          if (length < 0) return mapStatus(length);
          at = advance(at, length % 8);
          const from = end + Math.floor(gap / 8);
          end = from + Math.floor(length / 8) + 1;
          if (index >= from && index < end) live = true;
        }
        if (live) {
          if (++listed > maxWordsPerFrame) return "limit";
          const status = visitKey(
            key,
            base,
            frameBytes,
            visitReference,
            visitGeneral,
          );
          if (status !== "complete") return status;
        }
      }
      // The residual record of this safepoint.
      const header = recordHeader(read, record);
      if (header < 0) return mapStatus(header);
      const position = recordUnit(
        read,
        record,
        Math.floor(header / 4) + index,
        header % 4,
      );
      if (position < 0) return mapStatus(position);
      at = advance(stream, position);
      const heldMask = varint(read, at);
      if (heldMask < 0) return mapStatus(heldMask);
      at = advance(at, heldMask % 8);
      held = Math.floor(heldMask / 8);
      const residual = varint(read, at);
      if (residual < 0) return mapStatus(residual);
      at = advance(at, residual % 8);
      key = -1;
      for (let word = Math.floor(residual / 8); word > 0; word--) {
        const delta = varint(read, at);
        if (delta < 0) return mapStatus(delta);
        at = advance(at, delta % 8);
        key += Math.floor(delta / 8) + 1;
        if (++listed > maxWordsPerFrame) return "limit";
        const status = visitKey(
          key,
          base,
          frameBytes,
          visitReference,
          visitGeneral,
        );
        if (status !== "complete") return status;
      }
      savesAt = ownSaves;
      savesCompact = true;
    } else {
      // A full-word map: reference then general offsets, register word.
      const references = read(map + 8);
      if (references === undefined) return "read";
      if (!bounded(references) || references > frameBytes / 8) return "invalid";
      for (let at = 0; at < references; at++) {
        const offset = read(map + 16 + at * 8);
        if (offset === undefined) return "read";
        if (!bounded(offset) || offset % 8 !== 0) return "invalid";
        if (++listed > maxWordsPerFrame) return "limit";
        const status = visitKey(
          (offset / 8) * 2,
          base,
          frameBytes,
          visitReference,
          visitGeneral,
        );
        if (status !== "complete") return status;
      }
      const generalAt = map + 16 + references * 8,
        generals = read(generalAt);
      if (generals === undefined) return "read";
      if (!bounded(generals) || generals > frameBytes / 8) return "invalid";
      for (let at = 0; at < generals; at++) {
        const offset = read(generalAt + 8 + at * 8);
        if (offset === undefined) return "read";
        if (!bounded(offset) || offset % 8 !== 0) return "invalid";
        if (++listed > maxWordsPerFrame) return "limit";
        const status = visitKey(
          (offset / 8) * 2 + 1,
          base,
          frameBytes,
          visitReference,
          visitGeneral,
        );
        if (status !== "complete") return status;
      }
      const word = generalAt + 8 + generals * 8,
        registers = read(word);
      if (registers === undefined) return "read";
      if (
        !natural(registers) ||
        registers >= registerMaskLimit * registerMaskLimit
      )
        return "invalid";
      held = Math.floor(registers / registerMaskLimit);
      savesAt = word;
      savesCompact = false;
    }
    // References this frame keeps in registers, where its callees left them.
    if (held >= registerMaskLimit) return "invalid";
    for (let bit = 0; bit < savedRegisterCount; bit++) {
      if ((held & (1 << bit)) === 0) continue;
      const slot =
        bit === 0
          ? at19
          : bit === 1
            ? at20
            : bit === 2
              ? at21
              : bit === 3
                ? at22
                : bit === 4
                  ? at23
                  : bit === 5
                    ? at24
                    : bit === 6
                      ? at25
                      : bit === 7
                        ? at26
                        : bit === 8
                          ? at27
                          : at28;
      // No frame between here and the walk start saved it.
      if (slot === 0) return "invalid";
      if (!visitReference(slot)) return "visitor";
    }
    savesBase = base;
    savesBytes = frameBytes;
    current = caller;
    afterTransparent = false;
  }
}
/** Scans the stack roots named by a stack-map registry (`head`). Stack
 * frames are external stack memory; their maps are immutable code metadata.
 * Both the frame count and each map's size are bounded; only a complete scan
 * may authorize a later sweep. */
export type NativeRootScan = (
  head: number,
  visit: VisitReference,
  maxFrames?: number,
  maxReferencesPerFrame?: number,
) => ScanStatus;
/** Collectors scan roots while the managed allocator refuses requests, so a
 * scan must not allocate: its frame and register visitors and their state are
 * allocated here, once, with the scanner (create it with the collector). A
 * scanner is not reentrant. */
function createRootScan(read: ReadWord): NativeRootScan {
  let visitor: VisitReference = (address, slot) => false,
    failure: ScanStatus = "complete";
  const visitWord: VisitWord = (slot) => {
    failure = reference(read, slot, visitor);
    return failure === "complete";
  };
  const visitTagged: VisitWord = (slot) => {
    failure = general(read, slot, visitor, true);
    return failure === "complete";
  };
  return (
    head,
    visit,
    maxFrames: number = 1000000,
    maxReferencesPerFrame: number = 1000000,
  ) => {
    if (
      !natural(head) ||
      !bounded(maxFrames) ||
      !bounded(maxReferencesPerFrame)
    )
      return "invalid";
    visitor = visit;
    failure = "complete";
    const status = walkNativeStack(
      read,
      head,
      visitWord,
      visitTagged,
      maxFrames,
      maxReferencesPerFrame,
    );
    return status === "visitor" ? failure : status;
  };
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
/** A root scanner for an embedding's or an unproved mutator's frames. The
 * walk checks every listed word against its frame for any scanner. */
export function createNativeRootScan(read: ReadWord): NativeRootScan {
  return createRootScan(read);
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
/** Same contract as scanNativeObjectWithVerifiedDescriptor, for
 * compiler-published stack maps. Stack walks check listed words against
 * their frames either way (it is cheap), so this scanner behaves as
 * createNativeRootScan. */
export function createVerifiedNativeRootScan(read: ReadWord): NativeRootScan {
  return createRootScan(read);
}
