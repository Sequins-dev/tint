import {
  nativeWeakSlotMarker,
  nativeWeakSlotByteLength,
  nativeWeakSlotFlagsOffset,
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

/** Header flags word of an evacuated source object; its marker word then holds
 * the destination. No live header uses this flags value (strings, arrays and
 * records use 0..2, weak slots 0..1). */
export const cheneyForwarded = 0x7e57f0d0;
/** Scratch flag on a destination weak slot whose ephemeron value was traced. */
const ephemeronTraced = 0x10;

/** One evacuation moves every reachable object of the source window and
 * returns the bytes copied. Destinations are packed from `toStart` within
 * the destination window; `starts` receives one bit per 16-byte destination
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

// Single host operations, so the inliner folds them into their callers.
// Headers, descriptors and references are trusted (see the contract below).
function read(address: number): number {
  return readMemoryWord(address, 8, 0);
}
function write(address: number, value: number): void {
  writeMemoryWord(address, 8, 0, value);
}

/** Aligned byte extent of the object whose header words are given. Object
 * sizes are below the managed capacity (< 2^31), so rounding to 16 bytes is
 * exact in 32-bit integer arithmetic. */
export function cheneyExtent(
  address: number,
  marker: number,
  flags: number,
): number {
  let size = 0;
  if (marker > 6) {
    if (marker === nativeWeakSlotMarker) size = nativeWeakSlotByteLength;
    else {
      if (marker % 8 !== 0 || flags !== 0) throw "CHENEY_HEADER";
      size = read(marker);
    }
  } else if (marker === 1) {
    if (flags !== 0) throw "CHENEY_HEADER";
    size = 24 + read(address + 16) * 2;
  } else if (marker === 6) size = 32 + read(address + 16) * 8;
  else if (marker >= 2) {
    if (flags === 2) size = 48;
    else if (flags === 1) size = 32;
    else if (flags === 0)
      size =
        32 +
        read(address + 16) *
          (marker === 2 ? 1 : marker === 3 ? 2 : marker === 4 ? 4 : 8);
    else throw "CHENEY_HEADER";
  } else throw "CHENEY_HEADER";
  return ((size + 15) >>> 4) << 4;
}

/** The destination of a source reference, copying it on first sight. The
 * caller has checked that the address lies in the source window. */
function evacuate(
  state: CheneyState,
  starts: Uint32Array,
  address: number,
): number {
  const marker = read(address),
    flags = read(address + 8);
  if (flags === cheneyForwarded) return marker;
  const size = cheneyExtent(address, marker, flags),
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
  // One start bit per 16-byte unit; offsets are below 2^31.
  const unit = (destination - state.startBase) >>> 4,
    word = unit >>> 5;
  starts[word] = (starts[word] ?? 0) | (1 << (unit & 31));
  write(address, destination);
  write(address + 8, cheneyForwarded);
  if (marker >= 2 && marker <= 5) {
    if (flags === 0) write(destination + 24, destination + 32);
    else if (flags === 2) {
      // The source still holds the original data and owner words.
      const owner = read(address + 32),
        moved =
          owner >= state.fromBase && owner < state.fromEnd
            ? evacuate(state, starts, owner)
            : owner,
        data = read(address + 24);
      write(
        destination + 24,
        moved === owner ? data : data + read(moved + 24) - read(owner + 24),
      );
      write(destination + 32, moved);
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
  const marker = read(address),
    flags = read(address + 8);
  if (marker > 6) {
    if (marker === nativeWeakSlotMarker) {
      if (strongWeak) {
        generalSlot(state, starts, address + nativeWeakSlotKeyOffset);
        generalSlot(state, starts, address + nativeWeakSlotValueOffset);
      }
      return nativeWeakSlotByteLength;
    }
    if (marker % 8 !== 0 || flags !== 0) throw "CHENEY_HEADER";
    scanFields(state, starts, marker + 8, address);
    return ((read(marker) + 15) >>> 4) << 4;
  }
  if (marker === 6) {
    const capacity = read(address + 16),
      fromBase = state.fromBase,
      fromEnd = state.fromEnd;
    for (let index = 0; index < capacity; index++) {
      const slot = address + 32 + index * 8,
        value = read(slot);
      if (value >= fromBase && value < fromEnd && value !== 0)
        write(slot, evacuate(state, starts, value));
    }
  } else if (marker >= 2 && marker <= 5 && flags === 2)
    // Copies fixed their owner when evacuated; this covers in-place scans.
    referenceSlot(state, starts, address + 32);
  return cheneyExtent(address, marker, flags);
}

function scanRoots(
  state: CheneyState,
  starts: Uint32Array,
  head: number,
): void {
  let frame = head;
  while (frame !== 0) {
    const previous = read(frame),
      descriptor = read(frame + 8);
    if (frame % 8 !== 0 || descriptor <= 0 || descriptor % 8 !== 0)
      throw "CHENEY_ROOT";
    scanFields(state, starts, descriptor, frame);
    frame = previous;
  }
}

/** Scans destinations copied since `from` until the frontier stops moving. */
function drain(state: CheneyState, starts: Uint32Array, from: number): number {
  const toBase = state.toBase;
  let scan = from;
  while (scan < state.free)
    scan += scanObject(state, starts, toBase + scan, false);
  return scan;
}

/** 1 live (or immortal), 0 dead or cleared; the key's reference is updated. */
function keyAlive(state: CheneyState, slot: number): number {
  const tag = read(slot + nativeWeakSlotKeyOffset);
  if (tag === 0) return 0;
  if (tag !== 3 && tag !== 5 && tag !== 6 && tag !== 7) return 1;
  const key = read(slot + nativeWeakSlotKeyPayloadOffset);
  if (key === 0) return 0;
  if (key < state.fromBase || key >= state.fromEnd) return 1;
  if (read(key + 8) !== cheneyForwarded) return 0;
  write(slot + nativeWeakSlotKeyPayloadOffset, read(key));
  return 1;
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
        marker = read(address),
        flags = read(address + 8);
      if (
        marker === nativeWeakSlotMarker &&
        flags === nativeWeakSlotEphemeron &&
        keyAlive(state, address) === 1
      ) {
        generalSlot(state, starts, address + nativeWeakSlotValueOffset);
        write(address + nativeWeakSlotFlagsOffset, flags | ephemeronTraced);
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

function finishWeakSlots(state: CheneyState, start: number): void {
  const toBase = state.toBase;
  let at = start;
  while (at < state.free) {
    const address = toBase + at,
      marker = read(address),
      rawFlags = read(address + 8),
      flags =
        marker === nativeWeakSlotMarker
          ? rawFlags & ~ephemeronTraced
          : rawFlags;
    if (marker === nativeWeakSlotMarker) {
      if (flags !== nativeWeakSlotWeak && flags !== nativeWeakSlotEphemeron)
        throw "CHENEY_WEAK";
      if (rawFlags !== flags) write(address + nativeWeakSlotFlagsOffset, flags);
      if (keyAlive(state, address) === 0) {
        clearPair(address + nativeWeakSlotKeyOffset);
        clearPair(address + nativeWeakSlotValueOffset);
      } else if (flags === nativeWeakSlotWeak)
        clearPair(address + nativeWeakSlotValueOffset);
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
      scanRoots(state, startBits, rootHead);
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
