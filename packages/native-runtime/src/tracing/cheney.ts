import {
  nativeHeaderFlagUnit,
  nativeHeaderForwarded,
  nativeStringLengthOffset,
  nativeStringDataOffset,
  nativeArrayLengthOffset,
  nativeArrayDataOffset,
  nativeArrayInlineOffset,
  nativeArrayOwnerOffset,
  nativeArrayBorrowedByteLength,
  nativeArrayViewByteLength,
  nativeTypedArrayMarker,
  nativeTypedArrayElementBytes,
  nativeBuiltinMarkerLimit,
} from "@tint/abi/host";
import {
  nativeWeakSlotMarker,
  nativeWeakSlotByteLength,
  nativeWeakSlotWeak,
  nativeWeakSlotEphemeron,
  nativeWeakSlotKeyOffset,
  nativeWeakSlotKeyPayloadOffset,
  nativeWeakSlotValueOffset,
  nativeWeakSlotValuePayloadOffset,
} from "@tint/abi/weak-slot";
import {
  readMemoryWord,
  writeMemoryWord,
  moveMemory,
} from "../intrinsics/memory.ts";
import {
  walkNativeStack,
  headerMarker,
  headerFlags,
  type ReadWord,
} from "./scan.ts";

/** Scratch kind flag on a destination weak slot whose ephemeron value was
 * traced (live weak slots use flags 0 and 1). */
const ephemeronTraced = 4;
/** The header of an evacuated source object is its destination plus
 * `nativeHeaderForwarded`; no live header reaches that bit. */
export function cheneyIsForwarded(header: number): boolean {
  return header >= nativeHeaderForwarded;
}

/** One evacuation moves every reachable object of the source window and
 * returns the bytes copied. Destinations are packed from `toStart` within
 * the destination window; `starts` receives one bit per 8-byte destination
 * unit, indexed from `startsBase`. `remembered`, when given, visits every
 * object outside the source window whose fields may refer into it, calling
 * its argument once per object start. Parameters are scalars and arrays the
 * caller already owns: a collection must not allocate. */
export interface CheneyCollector {
  readonly collect: (
    fromBase: number,
    fromLength: number,
    toBase: number,
    toStart: number,
    toLength: number,
    rootHead: number,
    starts: Uint32Array,
    startsBase: number,
    remembered: ((scan: (address: number) => void) => void) | undefined,
  ) => number;
}

/** Evacuation state, one record per collector. The hot paths are module
 * functions over this record rather than closures over mutable bindings, so
 * every access is a plain field load (one descriptor proof per function)
 * instead of a guarded cell read or a bounds-checked typed-array element,
 * and nothing on the per-slot path needs a closure environment. */
interface CheneyState {
  /** Source window [fromBase, fromEnd). */
  fromBase: number;
  fromEnd: number;
  /** Destination window base and limit, and the next free offset. */
  toBase: number;
  toLimit: number;
  free: number;
  /** Address of start-bit unit 0. */
  startBase: number;
  /** Weak slots copied in this collection. */
  weakCopied: number;
  readonly managedBase: number;
  readonly managedLength: number;
}

// Zeroes for bulk clears. `set` copies a block with one memmove where `fill`
// stores element by element (about ten times slower), and a collection
// must not allocate, so the blocks are permanent.
const zeroWords = new Uint32Array(512);
const zeroBytes = new Uint8Array(2048);
/** Zeroes elements [start, end) of `array`. */
export function clearWords(
  array: Uint32Array,
  start: number,
  end: number,
): void {
  let at = start;
  while (end - at >= 512) {
    array.set(zeroWords, at);
    at += 512;
  }
  if (at < end) array.fill(0, at, end);
}
/** Records the object starts of a gap-free run of objects [from, to) (a
 * bump-allocated nursery) as start bits relative to `base`: the bits the
 * allocation fast path does not keep, for a compaction that covers the run. */
export function recordObjectStarts(
  starts: Uint32Array,
  base: number,
  from: number,
  to: number,
): void {
  let address = from;
  while (address < to) {
    const granule = (address - base) >>> 3,
      word = granule >>> 5;
    starts[word] = ((starts[word] ?? 0) | (1 << (granule & 31))) >>> 0;
    address += compactObjectSize(address, read(address));
  }
  if (address !== to) throw "COMPACT_NURSERY_WALK";
}
/** Zeroes elements [start, end) of `array`. */
export function clearBytes(
  array: Uint8Array,
  start: number,
  end: number,
): void {
  let at = start;
  while (end - at >= 2048) {
    array.set(zeroBytes, at);
    at += 2048;
  }
  if (at < end) array.fill(0, at, end);
}

// Single host operations, so the inliner folds them into their callers.
// Headers, descriptors and references are trusted (see the contract below).
function read(address: number): number {
  return readMemoryWord(address, 8, 0);
}
function write(address: number, value: number): void {
  writeMemoryWord(address, 8, 0, value);
}

/** Aligned byte extent of the object whose decoded header is given. Object
 * sizes are below the managed capacity (< 2^31), so rounding to the 8-byte
 * allocation granule is exact in 32-bit integer arithmetic. */
export function cheneyExtent(
  address: number,
  marker: number,
  flags: number,
): number {
  let size = 0;
  if (marker === nativeWeakSlotMarker || marker >= nativeBuiltinMarkerLimit) {
    if (marker === nativeWeakSlotMarker) size = nativeWeakSlotByteLength;
    else {
      if (marker % 8 !== 0 || flags !== 0) throw "CHENEY_HEADER";
      size = read(marker);
    }
  } else if (marker === 1) {
    if (flags !== 0) throw "CHENEY_HEADER";
    size =
      nativeStringDataOffset +
      // At least four units' space (inline comparisons read them).
      Math.max(read(address + nativeStringLengthOffset), 4) * 2;
  } else if (marker === 6)
    size =
      nativeArrayInlineOffset + read(address + nativeArrayLengthOffset) * 8;
  else if (nativeTypedArrayMarker(marker)) {
    if (flags === 2) size = nativeArrayViewByteLength;
    else if (flags === 1) size = nativeArrayBorrowedByteLength;
    else if (flags === 0)
      size =
        nativeArrayInlineOffset +
        read(address + nativeArrayLengthOffset) *
          nativeTypedArrayElementBytes(marker);
    else throw "CHENEY_HEADER";
  } else throw "CHENEY_HEADER";
  return ((size + 7) >>> 3) << 3;
}

/** The destination of a source reference, copying it on first sight. The
 * caller has checked that the address lies in the source window. */
function evacuate(
  state: CheneyState,
  starts: Uint32Array,
  address: number,
): number {
  const header = read(address);
  if (header >= nativeHeaderForwarded) return header - nativeHeaderForwarded;
  const marker = headerMarker(header),
    flags = headerFlags(header),
    size = cheneyExtent(address, marker, flags),
    toBase = state.toBase,
    free = state.free,
    destination = toBase + free,
    managedBase = state.managedBase;
  if (destination + size > state.toLimit) throw "CHENEY_OVERFLOW";
  if (
    moveMemory(
      managedBase,
      state.managedLength,
      destination - managedBase,
      address - managedBase,
      size,
    ) !== 0
  )
    throw "CHENEY_MOVE";
  state.free = free + size;
  // One start bit per 8-byte unit; offsets are below 2^31.
  const unit = (destination - state.startBase) >>> 3,
    word = unit >>> 5;
  starts[word] = (starts[word] ?? 0) | (1 << (unit & 31));
  write(address, destination + nativeHeaderForwarded);
  if (nativeTypedArrayMarker(marker)) {
    if (flags === 0)
      write(
        destination + nativeArrayDataOffset,
        destination + nativeArrayInlineOffset,
      );
    else if (flags === 2) {
      // The source still holds the original data and owner words.
      const owner = read(address + nativeArrayOwnerOffset),
        moved =
          owner >= state.fromBase && owner < state.fromEnd
            ? evacuate(state, starts, owner)
            : owner,
        data = read(address + nativeArrayDataOffset);
      write(
        destination + nativeArrayDataOffset,
        moved === owner
          ? data
          : data +
              read(moved + nativeArrayDataOffset) -
              read(owner + nativeArrayDataOffset),
      );
      write(destination + nativeArrayOwnerOffset, moved);
    }
  } else if (marker === nativeWeakSlotMarker)
    state.weakCopied = state.weakCopied + 1;
  return destination;
}

/** Updates a reference slot that may point into the source window. */
function referenceSlot(
  state: CheneyState,
  starts: Uint32Array,
  slot: number,
): void {
  const value = read(slot);
  if (value >= state.fromBase && value < state.fromEnd && value !== 0)
    write(slot, evacuate(state, starts, value));
}

function generalSlot(
  state: CheneyState,
  starts: Uint32Array,
  slot: number,
): void {
  const tag = read(slot);
  if (tag === 3 || tag === 5 || tag === 6 || tag === 7)
    referenceSlot(state, starts, slot + 8);
  else if (tag > 7) throw "CHENEY_TAG";
}

/** Reference and general fields of a compact descriptor, relative to base. */
function scanFields(
  state: CheneyState,
  starts: Uint32Array,
  descriptor: number,
  base: number,
): void {
  const count = read(descriptor),
    fromBase = state.fromBase,
    fromEnd = state.fromEnd;
  for (let index = 0; index < count; index++) {
    const slot = base + read(descriptor + 8 + index * 8),
      value = read(slot);
    if (value >= fromBase && value < fromEnd && value !== 0)
      write(slot, evacuate(state, starts, value));
  }
  const generals = descriptor + 8 + count * 8,
    generalCount = read(generals);
  for (let index = 0; index < generalCount; index++)
    generalSlot(state, starts, base + read(generals + 8 + index * 8));
}

/** Updates the fields of one object; weak slots defer unless strong. */
function scanObject(
  state: CheneyState,
  starts: Uint32Array,
  address: number,
  strongWeak: boolean,
): number {
  const header = read(address),
    marker = headerMarker(header);
  if (marker === nativeWeakSlotMarker || marker >= nativeBuiltinMarkerLimit) {
    if (marker === nativeWeakSlotMarker) {
      if (strongWeak) {
        generalSlot(state, starts, address + nativeWeakSlotKeyOffset);
        generalSlot(state, starts, address + nativeWeakSlotValueOffset);
      }
      return nativeWeakSlotByteLength;
    }
    if (marker % 8 !== 0 || header !== marker) throw "CHENEY_HEADER";
    scanFields(state, starts, marker + 8, address);
    return ((read(marker) + 7) >>> 3) << 3;
  }
  const flags = headerFlags(header);
  if (marker === 6) {
    const capacity = read(address + nativeArrayLengthOffset),
      fromBase = state.fromBase,
      fromEnd = state.fromEnd;
    for (let index = 0; index < capacity; index++) {
      const slot = address + nativeArrayInlineOffset + index * 8,
        value = read(slot);
      if (value >= fromBase && value < fromEnd && value !== 0)
        write(slot, evacuate(state, starts, value));
    }
  } else if (nativeTypedArrayMarker(marker) && flags === 2)
    // Copies fixed their owner when evacuated; this covers in-place scans.
    referenceSlot(state, starts, address + nativeArrayOwnerOffset);
  return cheneyExtent(address, marker, flags);
}

/** Scans destinations copied since `from` until the frontier stops moving. */
function drain(state: CheneyState, starts: Uint32Array, from: number): number {
  const toBase = state.toBase;
  let scan = from;
  while (scan < state.free)
    scan += scanObject(state, starts, toBase + scan, false);
  return scan;
}

/** Whether the key of the evacuated weak slot `slot` survived an evacuation
 * of [fromBase, fromEnd): 1 live (or outside the source window, or not a
 * reference), 0 dead or cleared. A live key's reference is updated. Shared
 * with the parallel evacuator, which calls it once its pool is quiescent or
 * for slots only the calling worker touches. */
export function evacuatedKeyAlive(
  fromBase: number,
  fromEnd: number,
  slot: number,
): number {
  const tag = read(slot + nativeWeakSlotKeyOffset);
  if (tag === 0) return 0;
  if (tag !== 3 && tag !== 5 && tag !== 6 && tag !== 7) return 1;
  const key = read(slot + nativeWeakSlotKeyPayloadOffset);
  if (key === 0) return 0;
  if (key < fromBase || key >= fromEnd) return 1;
  const header = read(key);
  if (header < nativeHeaderForwarded) return 0;
  write(slot + nativeWeakSlotKeyPayloadOffset, header - nativeHeaderForwarded);
  return 1;
}
function keyAlive(state: CheneyState, slot: number): number {
  return evacuatedKeyAlive(state.fromBase, state.fromEnd, slot);
}

/** Traces ephemeron values whose keys survived, to a fixpoint. */
function traceEphemerons(
  state: CheneyState,
  starts: Uint32Array,
  start: number,
  scanned: number,
): number {
  const toBase = state.toBase;
  let frontier = scanned;
  while (true) {
    let traced = false,
      at = start;
    while (at < frontier) {
      const address = toBase + at,
        header = read(address),
        marker = headerMarker(header),
        flags = headerFlags(header);
      if (
        marker === nativeWeakSlotMarker &&
        flags === nativeWeakSlotEphemeron &&
        keyAlive(state, address) === 1
      ) {
        generalSlot(state, starts, address + nativeWeakSlotValueOffset);
        write(
          address,
          marker + (flags | ephemeronTraced) * nativeHeaderFlagUnit,
        );
        traced = true;
      }
      at += cheneyExtent(address, marker, flags & ~ephemeronTraced);
    }
    if (!traced && frontier === state.free) return frontier;
    frontier = drain(state, starts, frontier);
  }
}

function clearPair(address: number): void {
  write(address, 0);
  write(address + 8, 0);
}
/** Clears the pairs of the weak slot `slot` (kind `flags`) after the final
 * closure: a dead key clears both pairs, a weak cell drops its value pair. */
function clearWeakPairs(slot: number, flags: number, alive: number): void {
  if (alive === 0) {
    clearPair(slot + nativeWeakSlotKeyOffset);
    clearPair(slot + nativeWeakSlotValueOffset);
  } else if (flags === nativeWeakSlotWeak)
    clearPair(slot + nativeWeakSlotValueOffset);
}
/** Finishes an evacuated weak slot whose header carries no scratch flags
 * (the parallel evacuator's slots). */
export function finishEvacuatedWeak(
  fromBase: number,
  fromEnd: number,
  slot: number,
): void {
  const flags = headerFlags(read(slot));
  if (flags !== nativeWeakSlotWeak && flags !== nativeWeakSlotEphemeron)
    throw "CHENEY_WEAK";
  clearWeakPairs(slot, flags, evacuatedKeyAlive(fromBase, fromEnd, slot));
}

function finishWeakSlots(state: CheneyState, start: number): void {
  const toBase = state.toBase;
  let at = start;
  while (at < state.free) {
    const address = toBase + at,
      header = read(address),
      marker = headerMarker(header),
      rawFlags = headerFlags(header),
      flags =
        marker === nativeWeakSlotMarker
          ? rawFlags & ~ephemeronTraced
          : rawFlags;
    if (marker === nativeWeakSlotMarker) {
      if (flags !== nativeWeakSlotWeak && flags !== nativeWeakSlotEphemeron)
        throw "CHENEY_WEAK";
      if (rawFlags !== flags)
        write(address, marker + flags * nativeHeaderFlagUnit);
      clearWeakPairs(address, flags, keyAlive(state, address));
    }
    at += cheneyExtent(address, marker, flags);
  }
}

/** Single-pass copying evacuation (Cheney): each reachable source object is
 * copied once, its source header records the destination, and the destination
 * window is scanned in allocation order until no copies remain. Root slots and
 * remembered objects are updated in place.
 *
 * Contract: headers and descriptors are published only by the managed
 * allocator and the emitter, and every reference addresses an object start;
 * the mutator cannot forge them. A violation is an engine invariant failure,
 * thrown as a string, never a collection that silently drops objects. The
 * caller guarantees that the destination can hold every source object, so an
 * evacuation never fails half-way.
 *
 * Arrays relocate their data pointers as they are copied: inline backing moves
 * with its owner, borrowed backing stays, and a view is shifted by its owner's
 * data movement (the owner is evacuated first). Weak slots defer both values;
 * after the strong closure, an ephemeron whose key survived traces its value,
 * to a fixpoint, and then dead keys clear both pairs and weak cells drop their
 * value pair. */
export function createCheneyCollector(
  managedBase: number,
  managedLength: number,
): CheneyCollector {
  // Created once with the collector: a collection must not allocate.
  const state: CheneyState = {
    fromBase: 0,
    fromEnd: 0,
    toBase: 0,
    toLimit: 0,
    free: 0,
    startBase: 0,
    weakCopied: 0,
    managedBase,
    managedLength,
  };
  let currentStarts: Uint32Array = new Uint32Array(0);
  const scanRemembered = (address: number): void => {
    scanObject(state, currentStarts, address, true);
  };
  // Each managed frame's safepoint map, found by walking the stack.
  const readWord: ReadWord = (address: number): number | undefined =>
    read(address);
  const scanReference = (slot: number): boolean => {
    referenceSlot(state, currentStarts, slot);
    return true;
  };
  const scanGeneral = (slot: number): boolean => {
    generalSlot(state, currentStarts, slot);
    return true;
  };
  return {
    collect(
      sourceBase,
      sourceLength,
      destinationBase,
      destinationStart,
      destinationLength,
      rootHead,
      startBits,
      startBitsBase,
      remembered,
    ) {
      state.fromBase = sourceBase;
      state.fromEnd = sourceBase + sourceLength;
      state.toBase = destinationBase;
      state.toLimit = destinationBase + destinationLength;
      state.free = destinationStart;
      state.startBase = startBitsBase;
      state.weakCopied = 0;
      currentStarts = startBits;
      const start = destinationStart;
      if (
        walkNativeStack(
          readWord,
          rootHead,
          scanReference,
          scanGeneral,
          1000000,
        ) !== "complete"
      )
        throw "CHENEY_ROOT";
      if (remembered !== undefined) remembered(scanRemembered);
      let scanned = drain(state, startBits, start);
      if (state.weakCopied !== 0) {
        scanned = traceEphemerons(state, startBits, start, scanned);
        finishWeakSlots(state, start);
      }
      return state.free - start;
    },
  };
}

// Mark-compact (the generational heap's major collection). It shares this
// module's word access and extent decoding; frozen workloads link only the
// runtime files of their snapshot, so it lives beside the evacuator.

/** Sliding mark-compact over one region [base, base + used): the major
 * collection of the generational heap. It needs no second space, so peak
 * residency is about the live data plus the region's fill rather than two
 * copies of the survivors.
 *
 * 1. Mark: from the stack roots, every reachable object of the region sets
 *    one live bit per 8-byte granule it covers (a word of 32 bits per
 *    256-byte chunk). An explicit mark stack of granule indexes overflows
 *    into rescans of the marked objects.
 * 2. Offsets: each chunk records the live granules before it, so an
 *    object's destination is base + 8 * (chunk offset + live granules
 *    before it in its chunk): objects keep their order and slide down.
 * 3. Data pointers: owned arrays point at their new inline elements and
 *    views shift by their terminal owner's displacement (owner words are
 *    still the original ones), then
 * 4. References: every root and every field of a live object that refers
 *    into the region is rewritten to its destination.
 * 5. Move: live objects move in address order (each destination is at or
 *    below its source, past everything already moved), then the start bits
 *    are rebuilt by walking the now packed prefix.
 *
 * Headers never change, so heap tools and descriptor guards are unaffected.
 * Weak slots mark without their key and value; after the strong closure, an
 * ephemeron whose key is live marks its value, to a fixpoint, then a dead
 * key clears both pairs and a weak cell drops its value pair (as the copying
 * collector does), and phase 4 forwards the surviving pairs. A parallel mark
 * does all of this on the pool (see `CompactHelpers.mark`). A collection
 * must not allocate: every array is caller-owned permanent storage. */
export interface Compactor {
  /** Compacts [base, base + used) and returns the packed live bytes (which
   * the caller compares with its capacity). `starts` holds one start bit
   * per granule from `base`; `live` and `offsets` have at least as many
   * words; `stack` is the mark stack. */
  readonly collect: (
    base: number,
    used: number,
    rootHead: number,
    starts: Uint32Array,
    live: Uint32Array,
    offsets: Uint32Array,
    stack: Uint32Array,
  ) => number;
}

/** The region a compaction forwards into: its bounds, live bits and chunk
 * offsets. Forwarding reads nothing else, so parallel workers share it. */
export interface CompactRegion {
  base: number;
  end: number;
  live: Uint32Array;
  offsets: Uint32Array;
}
interface CompactState extends CompactRegion {
  starts: Uint32Array;
  stack: Uint32Array;
  depth: number;
  overflowed: boolean;
  liveBytes: number;
  /** A marked view: its data pointer needs its owner chain (phase 3). */
  sawView: boolean;
  /** A marked weak slot: ephemerons and clearing follow the mark. */
  sawWeak: boolean;
  readonly managedBase: number;
  readonly managedLength: number;
}

/** Set bits of a 32-bit word. */
function popcount(word: number): number {
  let v = word - ((word >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 63;
}
/** Aligned extent of the object with this header; records (most objects)
 * read their descriptor's extent directly. */
export function compactObjectSize(address: number, header: number): number {
  if (header > 7 && header < nativeHeaderFlagUnit)
    return ((read(header) + 7) >>> 3) << 3;
  return cheneyExtent(address, headerMarker(header), headerFlags(header));
}
function extentOf(address: number): number {
  return compactObjectSize(address, read(address));
}

/** Marks the object at `address` (inside the region) and queues it. */
function markObject(state: CompactState, address: number): void {
  const granule = (address - state.base) >>> 3,
    word = granule >>> 5,
    bit = 1 << (granule & 31),
    live = state.live;
  if (((live[word] ?? 0) & bit) !== 0) return;
  const size = extentOf(address);
  state.liveBytes += size;
  // Live bits for [granule, granule + size / 8).
  let first = granule;
  const end = granule + (size >>> 3);
  while (first < end) {
    const at = first >>> 5,
      shift = first & 31,
      count = Math.min(32 - shift, end - first),
      mask = count === 32 ? 0xffffffff : ((1 << count) - 1) << shift;
    live[at] = ((live[at] ?? 0) | mask) >>> 0;
    first += count;
  }
  const depth = state.depth;
  if (depth < state.stack.length) {
    state.stack[depth] = granule;
    state.depth = depth + 1;
  } else state.overflowed = true;
}
function markReference(state: CompactState, value: number): void {
  if (value >= state.base && value < state.end && value !== 0)
    markObject(state, value);
}
function markGeneral(state: CompactState, slot: number): void {
  const tag = read(slot);
  if (tag === 3 || tag === 5 || tag === 6 || tag === 7)
    markReference(state, read(slot + 8));
  else if (tag > 7) throw "COMPACT_TAG";
}
function markFields(
  state: CompactState,
  descriptor: number,
  base: number,
): void {
  const count = read(descriptor);
  for (let index = 0; index < count; index++)
    markReference(state, read(base + read(descriptor + 8 + index * 8)));
  const generals = descriptor + 8 + count * 8,
    generalCount = read(generals);
  for (let index = 0; index < generalCount; index++)
    markGeneral(state, base + read(generals + 8 + index * 8));
}
/** Marks the referents of one live object. */
function markChildren(state: CompactState, address: number): void {
  const header = read(address),
    marker = headerMarker(header);
  if (marker === nativeWeakSlotMarker || marker >= nativeBuiltinMarkerLimit) {
    // A weak slot's key and value wait for the strong closure.
    if (marker === nativeWeakSlotMarker) state.sawWeak = true;
    else markFields(state, marker + 8, address);
  } else if (marker === 6) {
    const capacity = read(address + nativeArrayLengthOffset);
    for (let index = 0; index < capacity; index++)
      markReference(state, read(address + nativeArrayInlineOffset + index * 8));
  } else if (nativeTypedArrayMarker(marker) && headerFlags(header) === 2) {
    state.sawView = true;
    markReference(state, read(address + nativeArrayOwnerOffset));
  }
}
function drainMarks(state: CompactState): void {
  const base = state.base,
    stack = state.stack;
  while (state.depth > 0) {
    const depth = state.depth - 1;
    state.depth = depth;
    markChildren(state, base + (stack[depth] ?? 0) * 8);
  }
}
/** Drains the mark stack, rescanning marked objects while it overflowed. */
function closeMarks(state: CompactState): void {
  drainMarks(state);
  while (state.overflowed) {
    // Rescan marked objects for referents the full stack dropped.
    state.overflowed = false;
    forEachLive(state, markChildren);
    drainMarks(state);
  }
}
/** 1 when weak slot `slot`'s key is live (marked, outside the region, or
 * not a reference), 0 when it is dead or cleared. */
export function compactKeyAlive(state: CompactRegion, slot: number): number {
  const tag = read(slot + nativeWeakSlotKeyOffset);
  if (tag === 0) return 0;
  if (tag !== 3 && tag !== 5 && tag !== 6 && tag !== 7) return 1;
  const key = read(slot + nativeWeakSlotKeyPayloadOffset);
  if (key === 0) return 0;
  if (key < state.base || key >= state.end) return 1;
  const granule = (key - state.base) >>> 3;
  return ((state.live[granule >>> 5] ?? 0) & (1 << (granule & 31))) !== 0
    ? 1
    : 0;
}
/** Marks the value of a live ephemeron whose key is live. */
function markEphemeron(state: CompactState, address: number): void {
  const header = read(address);
  if (
    headerMarker(header) === nativeWeakSlotMarker &&
    headerFlags(header) === nativeWeakSlotEphemeron &&
    compactKeyAlive(state, address) === 1
  )
    markGeneral(state, address + nativeWeakSlotValueOffset);
}
/** Clears the pairs of a live weak slot after the final mark (anything
 * else is left alone). */
export function finishCompactWeak(state: CompactRegion, address: number): void {
  const header = read(address);
  if (headerMarker(header) !== nativeWeakSlotMarker) return;
  const flags = headerFlags(header);
  if (flags !== nativeWeakSlotWeak && flags !== nativeWeakSlotEphemeron)
    throw "COMPACT_WEAK";
  clearWeakPairs(address, flags, compactKeyAlive(state, address));
}
/** Calls `visit` with every live object of the region in address order. */
function forEachLive(
  state: CompactState,
  visit: (state: CompactState, address: number) => void,
): void {
  const starts = state.starts,
    live = state.live,
    base = state.base,
    words = Math.ceil((state.end - base) / 256);
  for (let word = 0; word < words; word++) {
    let bits = ((starts[word] ?? 0) & (live[word] ?? 0)) >>> 0;
    while (bits !== 0) {
      const bit = 31 - Math.clz32(bits & -bits);
      bits = (bits & (bits - 1)) >>> 0;
      visit(state, base + (word * 32 + bit) * 8);
    }
  }
}

/** The destination of a live object of the region. */
export function compactForward(state: CompactRegion, address: number): number {
  const granule = (address - state.base) >>> 3,
    word = granule >>> 5,
    bit = granule & 31,
    below = bit === 0 ? 0 : ((state.live[word] ?? 0) << (32 - bit)) >>> 0;
  return state.base + ((state.offsets[word] ?? 0) + popcount(below)) * 8;
}
function forwardReference(state: CompactRegion, slot: number): void {
  const value = read(slot);
  if (value >= state.base && value < state.end && value !== 0)
    write(slot, compactForward(state, value));
}
function forwardGeneral(state: CompactRegion, slot: number): void {
  const tag = read(slot);
  if (tag === 3 || tag === 5 || tag === 6 || tag === 7)
    forwardReference(state, slot + 8);
}
function forwardFields(
  state: CompactRegion,
  descriptor: number,
  base: number,
): void {
  const count = read(descriptor);
  for (let index = 0; index < count; index++)
    forwardReference(state, base + read(descriptor + 8 + index * 8));
  const generals = descriptor + 8 + count * 8,
    generalCount = read(generals);
  for (let index = 0; index < generalCount; index++)
    forwardGeneral(state, base + read(generals + 8 + index * 8));
}
/** Phase 3: a view's data pointer, against original owner words (owned
 * arrays are relocated as they move). */
function relocateView(state: CompactState, address: number): void {
  const header = read(address),
    marker = headerMarker(header);
  if (!nativeTypedArrayMarker(marker)) return;
  if (headerFlags(header) === 2) {
    // A view's elements move with its terminal owning array.
    let owner = read(address + nativeArrayOwnerOffset);
    while (true) {
      const ownerHeader = read(owner);
      if (headerFlags(ownerHeader) !== 2) break;
      owner = read(owner + nativeArrayOwnerOffset);
    }
    if (
      owner >= state.base &&
      owner < state.end &&
      headerFlags(read(owner)) === 0
    ) {
      const data = read(address + nativeArrayDataOffset);
      write(
        address + nativeArrayDataOffset,
        data + compactForward(state, owner) - owner,
      );
    }
  }
}
/** Phase 4: the reference fields of one live object, in place. */
export function compactForwardChildren(
  state: CompactRegion,
  address: number,
  header: number,
): void {
  const marker = headerMarker(header);
  if (marker === nativeWeakSlotMarker) {
    forwardGeneral(state, address + nativeWeakSlotKeyOffset);
    forwardGeneral(state, address + nativeWeakSlotValueOffset);
  } else if (marker >= nativeBuiltinMarkerLimit)
    forwardFields(state, marker + 8, address);
  else if (marker === 6) {
    const capacity = read(address + nativeArrayLengthOffset);
    for (let index = 0; index < capacity; index++)
      forwardReference(state, address + nativeArrayInlineOffset + index * 8);
  } else if (nativeTypedArrayMarker(marker)) {
    const flags = headerFlags(header);
    if (flags === 2) forwardReference(state, address + nativeArrayOwnerOffset);
  }
}
/** Phase 4 for one live object: its fields, and an owned array's data
 * pointer (its elements move with it). */
export function compactForwardObject(
  state: CompactRegion,
  address: number,
  header: number,
): void {
  compactForwardChildren(state, address, header);
  if (header >= 2 && header <= 5)
    write(
      address + nativeArrayDataOffset,
      compactForward(state, address) + nativeArrayInlineOffset,
    );
}
/** Phases 4 and 5 in one address-ordered pass: each live object's fields
 * are forwarded in place (destinations come from the bitmaps alone), owned
 * arrays point at their new elements, then the object moves to the packed
 * cursor (at or below it, past everything already moved) and its start bit
 * is set there. Each start-bit word is cleared once its bits are taken, so
 * only new starts remain. Returns the packed bytes. With `fieldsPending`
 * false, a parallel pass has already forwarded fields and data pointers. */
function compactLive(
  state: CompactState,
  words: number,
  fieldsPending: boolean,
): number {
  const starts = state.starts,
    live = state.live,
    base = state.base,
    managedBase = state.managedBase;
  let cursor = base;
  for (let word = 0; word < words; word++) {
    let bits = ((starts[word] ?? 0) & (live[word] ?? 0)) >>> 0;
    starts[word] = 0;
    while (bits !== 0) {
      const bit = 31 - Math.clz32(bits & -bits);
      bits = (bits & (bits - 1)) >>> 0;
      const address = base + (word * 32 + bit) * 8,
        header = read(address),
        size = compactObjectSize(address, header),
        destination = cursor;
      if (fieldsPending) compactForwardChildren(state, address, header);
      if (fieldsPending && header >= 2 && header <= 5)
        write(
          address + nativeArrayDataOffset,
          destination + nativeArrayInlineOffset,
        );
      if (
        destination !== address &&
        moveMemory(
          managedBase,
          state.managedLength,
          destination - managedBase,
          address - managedBase,
          size,
        ) !== 0
      )
        throw "COMPACT_MOVE";
      const granule = (destination - base) >>> 3,
        at = granule >>> 5;
      starts[at] = ((starts[at] ?? 0) | (1 << (granule & 31))) >>> 0;
      cursor = destination + size;
    }
  }
  return cursor - base;
}

/** Parallel phases a compactor may delegate (to the evacuator's pool): the
 * mark from the roots, which returns the marked bytes (`markOverflowed`
 * then says whether children were dropped and need a serial rescan,
 * `markSawView` whether a view was marked and `markWeakPending` whether
 * weak slots still need the serial ephemeron fixpoint and clearing), and
 * phase 4 over every live object of [base, base + 256 * words). */
export interface CompactHelpers {
  /** Marks from the roots, then (when weak slots were met and nothing
   * overflowed) runs the ephemeron fixpoint and clears dead pairs. Returns
   * the marked bytes, or -1 when the pool cannot run (the compactor then
   * marks serially). */
  readonly mark: (region: CompactRegion, rootHead: number) => number;
  readonly markOverflowed: () => boolean;
  readonly markSawView: () => boolean;
  readonly markWeakPending: () => boolean;
  readonly forward: (region: CompactRegion, words: number) => void;
}
export function createCompactor(
  managedBase: number,
  managedLength: number,
  helpers?: CompactHelpers,
  parallelMinimum: number = 0,
): Compactor {
  // Created once with the collector: a collection must not allocate.
  const empty = new Uint32Array(0);
  const state: CompactState = {
    base: 0,
    end: 0,
    starts: empty,
    live: empty,
    offsets: empty,
    stack: empty,
    depth: 0,
    overflowed: false,
    liveBytes: 0,
    sawView: false,
    sawWeak: false,
    managedBase,
    managedLength,
  };
  const readWord: ReadWord = (address: number): number | undefined =>
    read(address);
  const markRoot = (slot: number): boolean => {
    markReference(state, read(slot));
    return true;
  };
  const markGeneralRoot = (slot: number): boolean => {
    markGeneral(state, slot);
    return true;
  };
  const forwardRoot = (slot: number): boolean => {
    forwardReference(state, slot);
    return true;
  };
  const forwardGeneralRoot = (slot: number): boolean => {
    forwardGeneral(state, slot);
    return true;
  };
  return {
    collect(base, used, rootHead, starts, live, offsets, stack) {
      const words = Math.ceil(used / 256);
      state.base = base;
      state.end = base + used;
      state.starts = starts;
      state.live = live;
      state.offsets = offsets;
      state.stack = stack;
      state.depth = 0;
      state.overflowed = false;
      state.liveBytes = 0;
      state.sawView = false;
      state.sawWeak = false;
      clearWords(live, 0, words);
      // 1. Mark (in parallel for large regions).
      const delegate = used >= parallelMinimum ? helpers : undefined;
      let parallel = false;
      if (delegate !== undefined) {
        const marked = delegate.mark(state, rootHead);
        if (marked >= 0) {
          parallel = true;
          state.liveBytes = marked;
          state.overflowed = delegate.markOverflowed();
          state.sawView = delegate.markSawView();
          // Weak slots the pool could not finish (its lists overflowed):
          // the serial fixpoint below covers every live slot. A mark
          // overflow leaves them to the rescan, which sets this too.
          state.sawWeak = delegate.markWeakPending();
        }
      }
      if (
        !parallel &&
        walkNativeStack(
          readWord,
          rootHead,
          markRoot,
          markGeneralRoot,
          1000000,
        ) !== "complete"
      )
        throw "COMPACT_ROOT";
      closeMarks(state);
      if (state.sawWeak) {
        // Ephemerons whose keys are live keep their values, to a fixpoint
        // (re-marking is idempotent: a pass that marks nothing ends it);
        // then dead keys clear their slots.
        let before = -1;
        while (before !== state.liveBytes) {
          before = state.liveBytes;
          forEachLive(state, markEphemeron);
          closeMarks(state);
        }
        forEachLive(state, finishCompactWeak);
      }
      // 2. Offsets: live granules before each chunk.
      let granules = 0;
      for (let word = 0; word < words; word++) {
        offsets[word] = granules;
        granules += popcount(live[word] ?? 0);
      }
      if (granules * 8 !== state.liveBytes) throw "COMPACT_LIVE";
      // 3. Views' data pointers against their unmodified owner chains.
      if (state.sawView) forEachLive(state, relocateView);
      // 4 and 5. Roots, then every live object's fields and position.
      if (
        walkNativeStack(
          readWord,
          rootHead,
          forwardRoot,
          forwardGeneralRoot,
          1000000,
        ) !== "complete"
      )
        throw "COMPACT_ROOT";
      if (delegate !== undefined && parallel) delegate.forward(state, words);
      const liveBytes = compactLive(state, words, !parallel);
      if (liveBytes !== state.liveBytes) throw "COMPACT_PACK";
      return liveBytes;
    },
  };
}
