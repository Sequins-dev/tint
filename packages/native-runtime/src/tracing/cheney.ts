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
  let fromBase = 0,
    fromEnd = 0,
    toBase = 0,
    toLimit = 0,
    free = 0,
    weakSlots = 0,
    starts: Uint32Array = new Uint32Array(0),
    startsBase = 0;
  // Single host operations, so the inliner folds them into their callers.
  // Headers, descriptors and references are trusted (see the contract above).
  function read(address: number): number {
    return readMemoryWord(address, 8, 0);
  }
  function write(address: number, value: number): void {
    writeMemoryWord(address, 8, 0, value);
  }
  /** Aligned byte extent of the object whose header words are given. */
  function extent(address: number, marker: number, flags: number): number {
    let size = 0;
    if (marker === 1) {
      if (flags !== 0) throw "CHENEY_HEADER";
      size = 24 + read(address + 16) * 2;
    } else if (marker >= 2 && marker <= 5) {
      if (flags === 2) size = 48;
      else if (flags === 1) size = 32;
      else if (flags === 0) {
        const width =
          marker === 2 ? 1 : marker === 3 ? 2 : marker === 4 ? 4 : 8;
        size = 32 + read(address + 16) * width;
      } else throw "CHENEY_HEADER";
    } else if (marker === 6) size = 32 + read(address + 16) * 8;
    else if (marker === nativeWeakSlotMarker) size = nativeWeakSlotByteLength;
    else {
      if (marker <= 0 || marker % 8 !== 0 || flags !== 0) throw "CHENEY_HEADER";
      size = read(marker);
    }
    return Math.ceil(size / 16) * 16;
  }
  function inSource(address: number): boolean {
    return address >= fromBase && address < fromEnd;
  }
  function markStart(address: number): void {
    const unit = (address - startsBase) / 16,
      word = Math.floor(unit / 32);
    starts[word] = (starts[word] ?? 0) | (1 << (unit % 32));
  }
  /** The destination of a source reference, copying it on first sight. */
  function evacuate(address: number): number {
    if (address < fromBase || address >= fromEnd) return address;
    const marker = read(address),
      flags = read(address + 8);
    if (flags === cheneyForwarded) return marker;
    const size = extent(address, marker, flags),
      destination = toBase + free;
    if (destination + size > toLimit) throw "CHENEY_OVERFLOW";
    if (
      moveMemory(
        managedBase,
        managedLength,
        destination - managedBase,
        address - managedBase,
        size,
      ) !== 0
    )
      throw "CHENEY_MOVE";
    free += size;
    markStart(destination);
    write(address, destination);
    write(address + 8, cheneyForwarded);
    if (marker >= 2 && marker <= 5) {
      if (flags === 0) write(destination + 24, destination + 32);
      else if (flags === 2) {
        // The source still holds the original data and owner words.
        const owner = read(address + 32),
          moved = evacuate(owner),
          data = read(address + 24);
        write(
          destination + 24,
          moved === owner ? data : data + read(moved + 24) - read(owner + 24),
        );
        write(destination + 32, moved);
      }
    } else if (marker === nativeWeakSlotMarker) weakSlots++;
    return destination;
  }
  function referenceSlot(slot: number): void {
    const value = read(slot);
    if (value !== 0 && value >= fromBase && value < fromEnd)
      write(slot, evacuate(value));
  }
  function generalSlot(slot: number): void {
    const tag = read(slot);
    if (tag === 3 || tag === 5 || tag === 6 || tag === 7)
      referenceSlot(slot + 8);
    else if (tag > 7) throw "CHENEY_TAG";
  }
  /** Reference and general fields of a compact descriptor, relative to base. */
  function scanFields(descriptor: number, base: number): void {
    const count = read(descriptor);
    for (let index = 0; index < count; index++)
      referenceSlot(base + read(descriptor + 8 + index * 8));
    const generals = descriptor + 8 + count * 8,
      generalCount = read(generals);
    for (let index = 0; index < generalCount; index++)
      generalSlot(base + read(generals + 8 + index * 8));
  }
  /** Updates the fields of one object; weak slots defer unless strong. */
  function scanObject(address: number, strongWeak: boolean): number {
    const marker = read(address),
      flags = read(address + 8);
    const size = extent(address, marker, flags);
    if (marker === 6) {
      const capacity = read(address + 16);
      for (let index = 0; index < capacity; index++)
        referenceSlot(address + 32 + index * 8);
    } else if (marker === nativeWeakSlotMarker) {
      if (strongWeak) {
        generalSlot(address + nativeWeakSlotKeyOffset);
        generalSlot(address + nativeWeakSlotValueOffset);
      }
    } else if (marker > 6) scanFields(marker + 8, address);
    else if (marker >= 2 && marker <= 5 && flags === 2)
      // Copies fixed their owner when evacuated; this covers in-place scans.
      referenceSlot(address + 32);
    return size;
  }
  function scanRoots(head: number): void {
    let frame = head;
    while (frame !== 0) {
      const previous = read(frame),
        descriptor = read(frame + 8);
      if (frame % 8 !== 0 || descriptor <= 0 || descriptor % 8 !== 0)
        throw "CHENEY_ROOT";
      scanFields(descriptor, frame);
      frame = previous;
    }
  }
  /** Scans destinations copied since `from` until the frontier stops moving. */
  function drain(from: number): number {
    let scan = from;
    while (scan < free) scan += scanObject(toBase + scan, false);
    return scan;
  }
  /** 1 live (or immortal), 0 dead or cleared; the key's reference is updated. */
  function keyAlive(slot: number): number {
    const tag = read(slot + nativeWeakSlotKeyOffset);
    if (tag === 0) return 0;
    if (tag !== 3 && tag !== 5 && tag !== 6 && tag !== 7) return 1;
    const key = read(slot + nativeWeakSlotKeyPayloadOffset);
    if (key === 0) return 0;
    if (!inSource(key)) return 1;
    if (read(key + 8) !== cheneyForwarded) return 0;
    write(slot + nativeWeakSlotKeyPayloadOffset, read(key));
    return 1;
  }
  /** Traces ephemeron values whose keys survived, to a fixpoint. */
  function traceEphemerons(start: number, scanned: number): number {
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
          keyAlive(address) === 1
        ) {
          generalSlot(address + nativeWeakSlotValueOffset);
          write(address + nativeWeakSlotFlagsOffset, flags | ephemeronTraced);
          traced = true;
        }
        at += extent(address, marker, flags & ~ephemeronTraced);
      }
      if (!traced && frontier === free) return frontier;
      frontier = drain(frontier);
    }
  }
  function clearPair(address: number): void {
    write(address, 0);
    write(address + 8, 0);
  }
  function finishWeakSlots(start: number): void {
    let at = start;
    while (at < free) {
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
        if (rawFlags !== flags)
          write(address + nativeWeakSlotFlagsOffset, flags);
        if (keyAlive(address) === 0) {
          clearPair(address + nativeWeakSlotKeyOffset);
          clearPair(address + nativeWeakSlotValueOffset);
        } else if (flags === nativeWeakSlotWeak)
          clearPair(address + nativeWeakSlotValueOffset);
      }
      at += extent(address, marker, flags);
    }
  }
  // Created once with the collector: a collection must not allocate.
  const scanRemembered = (address: number): void => {
    scanObject(address, true);
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
      fromBase = sourceBase;
      fromEnd = sourceBase + sourceLength;
      toBase = destinationBase;
      toLimit = destinationBase + destinationLength;
      free = destinationStart;
      weakSlots = 0;
      starts = startBits;
      startsBase = startBitsBase;
      const start = free;
      scanRoots(rootHead);
      if (remembered !== undefined) remembered(scanRemembered);
      let scanned = drain(start);
      if (weakSlots !== 0) {
        scanned = traceEphemerons(start, scanned);
        finishWeakSlots(start);
      }
      return free - start;
    },
  };
}
