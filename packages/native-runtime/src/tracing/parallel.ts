import { nativeWeakSlotMarker } from "@tint/abi/weak-slot";
import {
  readMemoryWord,
  writeMemoryWord,
  moveMemory,
  mapMemory,
  compareExchangeMemoryWord,
  fetchAddMemoryWord,
  loadAcquireMemoryWord,
  storeReleaseMemoryWord,
  collectorWorkerEntry,
  permanentFunctionAddress,
  permanentArrayAddress,
  compareExchangeMemoryUnsigned,
  spinPause,
  startNativeThread,
  parkNativeWord,
  wakeNativeWord,
} from "../intrinsics/memory.ts";
import { cheneyForwarded, cheneyExtent } from "./cheney.ts";
import { walkNativeStack, type ReadWord, type VisitFrame } from "./scan.ts";

/** Parallel stop-the-world evacuation (see docs/parallel-gc.md).
 *
 * A collection is described entirely by the shared raw record and the
 * per-worker state records below, never by the requesting mutator's context,
 * so a pool thread can evacuate any heap whose owner is stopped. Workers run
 * compiled runtime code that allocates nothing and touches no mutator objects:
 * their state records, the start bitmap and the remembered set are permanent
 * control storage created while the runtime initializes.
 *
 * Objects are claimed by a compare-exchange of their flags word to `claimed`;
 * the winner copies the object into its local allocation buffer, restores the
 * flags in the copy, writes the destination into the marker word and then
 * store-releases `cheneyForwarded`. Losers wait for the release.
 *
 * Reservations are exact. A start-bit word wholly inside the current LAB has
 * one writer and is updated plainly; boundary words, which a neighbouring LAB,
 * a large object or (in a minor) old objects may share, are updated with an
 * atomic compare-exchange. LAB tails stay unused holes: nothing walks survivor
 * space linearly (start bits identify objects). A LAB retires only when an
 * object of at most `largeBytes` does not fit, so holes waste at most
 * largeBytes / labBytes of the destination. */

/** Flags of an object whose evacuation is in progress. */
const claimed = cheneyForwarded + 1;
const labBytes = 32768;
/** Objects above this size are reserved directly from the shared cursor. */
const largeBytes = 1024;
/** Destination bytes per copied byte that LAB holes can waste, as a divisor:
 * holes are below largeBytes per labBytes LAB. */
const wasteDivisor = 30;
const rememberedChunk = 256;
const dirtyChunk = 4096;
/** Local unscanned bytes worth exporting to hungry workers. */
const shareBytes = 4096;

// Shared record words (byte offsets).
const recordWorker = 0,
  recordEpoch = 8,
  recordCommand = 16,
  recordActive = 24,
  recordFinished = 32,
  recordFailure = 40,
  recordLock = 48,
  recordCount = 56,
  recordCursor = 64,
  recordRemembered = 72,
  recordNextIndex = 80,
  recordWorkers = 88,
  recordSegments = 4096;
/** Outstanding scan segments are bounded by retired LABs plus large objects,
 * at most heap / 4 KiB: 2^20 pairs cover a 4 GiB space. */
const segmentCapacity = 1048576;
const recordBytes = recordSegments + segmentCapacity * 16;
const commandEvacuate = 1;

interface Worker {
  readonly index: number;
  /** Source window [fromBase, fromEnd) and destination window. */
  fromBase: number;
  fromEnd: number;
  toBase: number;
  toLimit: number;
  /** Address of start-bit unit 0. */
  startBase: number;
  /** Start-bit words wholly inside the current LAB: (first, last) exclusive,
   * so only words strictly between them have this worker as sole writer. */
  firstWord: number;
  lastWord: number;
  /** Current LAB: next free byte, limit, and local Cheney scan pointer. */
  free: number;
  limit: number;
  scan: number;
  readonly record: number;
  /** Raw address of the start bitmap's data. */
  readonly startsData: number;
  readonly managedBase: number;
  readonly managedLength: number;
  /** The next worker's state (the runtime module has no list helpers). */
  readonly next: Worker | undefined;
}

function read(address: number): number {
  return readMemoryWord(address, 8, 0);
}
function write(address: number, value: number): void {
  writeMemoryWord(address, 8, 0, value);
}
function fail(w: Worker, code: number): never {
  compareExchangeMemoryWord(w.record + recordFailure, 8, 0, 0, code);
  throw "PARALLEL_COLLECTOR_FAILED";
}
/** One spin-wait step; a failed worker may never release what is awaited,
 * so every waiter gives up once a failure is recorded. */
function spin(w: Worker): void {
  if (read(w.record + recordFailure) !== 0) throw "PARALLEL_COLLECTOR_FAILED";
  spinPause();
}

/** Destination bytes for one object: a LAB slice, or for a large object an
 * exact reservation of its own (which the caller exports for scanning once
 * copied). A retired LAB's unscanned remainder becomes a shared segment. */
function reserve(w: Worker, size: number): number {
  const free = w.free;
  if (free + size <= w.limit) {
    w.free = free + size;
    return free;
  }
  const record = w.record;
  if (size > largeBytes) {
    const offset = fetchAddMemoryWord(record + recordCursor, 8, 0, size);
    if (offset < 0 || w.toBase + offset + size > w.toLimit) fail(w, 1);
    return w.toBase + offset;
  }
  if (w.scan < free) push(w, w.scan, free);
  const offset = fetchAddMemoryWord(record + recordCursor, 8, 0, labBytes);
  if (offset < 0 || w.toBase + offset + labBytes > w.toLimit) fail(w, 1);
  const lab = w.toBase + offset;
  w.firstWord = (lab - w.startBase) >>> 9;
  w.lastWord = (lab + labBytes - w.startBase) >>> 9;
  w.scan = lab;
  w.free = lab + size;
  w.limit = lab + labBytes;
  return lab;
}

/** Sets the start bit of a copy. `owned` copies lie in the current LAB, whose
 * interior bitmap words have no other writer; every other word is shared. */
function markStart(
  w: Worker,
  starts: Uint32Array,
  destination: number,
  owned: boolean,
): void {
  const startBase = w.startBase,
    unit = (destination - startBase) >>> 4,
    word = unit >>> 5,
    bit = 1 << (unit & 31);
  if (owned && word > w.firstWord && word < w.lastWord) {
    starts[word] = (starts[word] ?? 0) | bit;
    return;
  }
  const address = w.startsData + word * 4;
  while (true) {
    const old = starts[word] ?? 0,
      next = (old | bit) >>> 0;
    if (next === old) return;
    const seen = compareExchangeMemoryUnsigned(address, 4, 0, 4, old, next);
    if (seen === old) return;
    if (seen < 0) fail(w, 9);
  }
}

function lock(record: number): void {
  while (compareExchangeMemoryWord(record + recordLock, 8, 0, 0, 1) !== 0)
    spinPause();
}
function unlock(record: number): void {
  storeReleaseMemoryWord(record + recordLock, 8, 0, 0);
}
function push(w: Worker, start: number, end: number): void {
  const record = w.record;
  lock(record);
  const count = read(record + recordCount);
  if (count >= segmentCapacity) {
    unlock(record);
    fail(w, 2);
  }
  const at = record + recordSegments + count * 16;
  write(at, start);
  write(at + 8, end);
  storeReleaseMemoryWord(record + recordCount, 8, 0, count + 1);
  unlock(record);
}
/** Scans one popped segment; false when the stack was empty. */
function popAndScan(w: Worker, starts: Uint32Array): boolean {
  const record = w.record;
  if (read(record + recordCount) === 0) return false;
  lock(record);
  const count = read(record + recordCount);
  if (count === 0) {
    unlock(record);
    return false;
  }
  const at = record + recordSegments + (count - 1) * 16,
    start = read(at),
    end = read(at + 8);
  storeReleaseMemoryWord(record + recordCount, 8, 0, count - 1);
  unlock(record);
  let scan = start;
  while (scan < end) scan += scanObject(w, starts, scan);
  return true;
}

/** The destination of a source reference, claiming and copying it on first
 * sight. The caller has checked that the address lies in the source window. */
function evacuate(w: Worker, starts: Uint32Array, address: number): number {
  const flagsAddress = address + 8;
  while (true) {
    const flags = loadAcquireMemoryWord(flagsAddress, 8, 0);
    if (flags === cheneyForwarded) return read(address);
    if (flags === claimed) {
      spin(w);
      continue;
    }
    const marker = read(address);
    if (compareExchangeMemoryWord(flagsAddress, 8, 0, flags, claimed) !== flags)
      continue;
    const size = cheneyExtent(address, marker, flags),
      destination = reserve(w, size),
      managedBase = w.managedBase;
    if (
      moveMemory(
        managedBase,
        w.managedLength,
        destination - managedBase,
        address - managedBase,
        size,
      ) !== 0
    )
      fail(w, 3);
    write(destination + 8, flags);
    markStart(w, starts, destination, size <= largeBytes);
    if (marker >= 2 && marker <= 5) {
      if (flags === 0) write(destination + 24, destination + 32);
      else if (flags === 2) {
        // The source still holds the original data and owner words.
        const owner = read(address + 32),
          moved =
            owner >= w.fromBase && owner < w.fromEnd
              ? evacuate(w, starts, owner)
              : owner,
          data = read(address + 24);
        write(
          destination + 24,
          moved === owner ? data : data + read(moved + 24) - read(owner + 24),
        );
        write(destination + 32, moved);
      }
    } else if (marker === nativeWeakSlotMarker) fail(w, 10);
    write(address, destination);
    storeReleaseMemoryWord(flagsAddress, 8, 0, cheneyForwarded);
    if (size > largeBytes) push(w, destination, destination + size);
    return destination;
  }
}

function referenceSlot(w: Worker, starts: Uint32Array, slot: number): void {
  const value = read(slot);
  if (value >= w.fromBase && value < w.fromEnd && value !== 0)
    write(slot, evacuate(w, starts, value));
}
function generalSlot(w: Worker, starts: Uint32Array, slot: number): void {
  const tag = read(slot);
  if (tag === 3 || tag === 5 || tag === 6 || tag === 7)
    referenceSlot(w, starts, slot + 8);
  else if (tag > 7) fail(w, 4);
}
function scanFields(
  w: Worker,
  starts: Uint32Array,
  descriptor: number,
  base: number,
): void {
  const count = read(descriptor),
    fromBase = w.fromBase,
    fromEnd = w.fromEnd;
  for (let index = 0; index < count; index++) {
    const slot = base + read(descriptor + 8 + index * 8),
      value = read(slot);
    if (value >= fromBase && value < fromEnd && value !== 0)
      write(slot, evacuate(w, starts, value));
  }
  const generals = descriptor + 8 + count * 8,
    generalCount = read(generals);
  for (let index = 0; index < generalCount; index++)
    generalSlot(w, starts, base + read(generals + 8 + index * 8));
}
/** Updates the fields of one object and returns its extent. */
function scanObject(w: Worker, starts: Uint32Array, address: number): number {
  const marker = read(address),
    flags = read(address + 8);
  scanHeaded(w, starts, address, marker, flags);
  return cheneyExtent(address, marker, flags);
}
/** Updates the fields of one object whose header words were read. */
function scanHeaded(
  w: Worker,
  starts: Uint32Array,
  address: number,
  marker: number,
  flags: number,
): void {
  if (marker > 6) {
    if (marker === nativeWeakSlotMarker) fail(w, 10);
    if (marker % 8 !== 0 || flags !== 0) fail(w, 5);
    scanFields(w, starts, marker + 8, address);
    return;
  }
  if (marker === 6) {
    const capacity = read(address + 16),
      fromBase = w.fromBase,
      fromEnd = w.fromEnd;
    for (let index = 0; index < capacity; index++) {
      const slot = address + 32 + index * 8,
        value = read(slot);
      if (value >= fromBase && value < fromEnd && value !== 0)
        write(slot, evacuate(w, starts, value));
    }
  } else if (marker >= 2 && marker <= 5 && flags === 2)
    referenceSlot(w, starts, address + 32);
}

/** Scans this worker's LAB and shared segments until every worker is idle
 * and no segment remains. A worker goes idle only after failing to pop, and
 * becomes active again (before popping) only after seeing a segment, so an
 * active count of zero means no segment can appear. */
function drain(w: Worker, starts: Uint32Array): void {
  const record = w.record;
  let sinceShare = 0;
  while (true) {
    const scan = w.scan;
    if (scan < w.free) {
      // Advance first: a LAB retired while this object is scanned exports
      // only the objects after it.
      const marker = read(scan),
        flags = read(scan + 8);
      w.scan = scan + cheneyExtent(scan, marker, flags);
      scanHeaded(w, starts, scan, marker, flags);
      if (++sinceShare >= 32) {
        sinceShare = 0;
        if (
          w.free - w.scan >= shareBytes &&
          read(record + recordCount) === 0 &&
          read(record + recordActive) < read(record + recordWorkers)
        ) {
          push(w, w.scan, w.free);
          w.scan = w.free;
        }
      }
      continue;
    }
    if (popAndScan(w, starts)) continue;
    fetchAddMemoryWord(record + recordActive, 8, 0, -1);
    while (true) {
      if (loadAcquireMemoryWord(record + recordActive, 8, 0) === 0) return;
      if (read(record + recordCount) > 0) {
        fetchAddMemoryWord(record + recordActive, 8, 0, 1);
        break;
      }
      spin(w);
    }
  }
}

function scanRemembered(
  w: Worker,
  starts: Uint32Array,
  shared: ParallelShared,
): void {
  const record = w.record;
  if (shared.rememberedCount >= 0) {
    const count = shared.rememberedCount,
      remembered = shared.remembered;
    while (true) {
      const first = fetchAddMemoryWord(
        record + recordRemembered,
        8,
        0,
        rememberedChunk,
      );
      if (first < 0) fail(w, 6);
      if (first >= count) return;
      const end = Math.min(count, first + rememberedChunk);
      for (let i = first; i < end; i++) {
        const offset = remembered[i];
        if (offset === undefined) fail(w, 6);
        scanObject(w, starts, shared.oldBase + offset);
      }
    }
  }
  // Overflowed remembered set: dirty cards over the old prefix, by chunks.
  const dirty = shared.dirty,
    end = Math.ceil(shared.oldTop / 128);
  while (true) {
    const first = fetchAddMemoryWord(
      record + recordRemembered,
      8,
      0,
      dirtyChunk,
    );
    if (first < 0) fail(w, 6);
    if (first >= end) return;
    const last = Math.min(end, first + dirtyChunk);
    for (let byte = first; byte < last; byte++) {
      const flags = dirty[byte] ?? 0;
      if (flags !== 0)
        for (let bit = 0; bit < 8; bit++)
          if ((flags & (1 << bit)) !== 0) {
            const offset = byte * 128 + bit * 16,
              unit = offset >>> 4;
            if (
              offset < shared.oldTop &&
              ((starts[unit >>> 5] ?? 0) & (1 << (unit & 31))) !== 0
            )
              scanObject(w, starts, shared.oldBase + offset);
          }
    }
  }
}

/** Collection parameters every worker reads; written by the requesting
 * thread before the epoch is published. */
interface ParallelShared {
  workers: number;
  rootHead: number;
  /** Remembered old offsets (count >= 0), or -1 to scan dirty cards. */
  rememberedCount: number;
  readonly remembered: Float64Array;
  readonly dirty: Uint8Array;
  /** Old-prefix base address and the top offset scanned for dirty cards. */
  oldBase: number;
  oldTop: number;
}

/** One worker's share: optional roots (each stack frame's safepoint map, for
 * the caller's worker), remembered objects, then the drain. */
function share(
  w: Worker,
  starts: Uint32Array,
  shared: ParallelShared,
  roots: VisitFrame | undefined,
  readWord: ReadWord,
): void {
  if (
    roots !== undefined &&
    walkNativeStack(readWord, shared.rootHead, roots, 1000000) !== "complete"
  )
    fail(w, 7);
  if (shared.rememberedCount !== -2) scanRemembered(w, starts, shared);
  drain(w, starts);
}

function waitEpoch(record: number, seen: number): number {
  while (true) {
    const epoch = loadAcquireMemoryWord(record + recordEpoch, 8, 0);
    if (epoch !== seen) return epoch;
    parkNativeWord(record + recordEpoch, seen, 0);
  }
}

export interface ParallelEvacuator {
  /** Worker count including the caller (worker 0). */
  readonly workers: number;
  /** Evacuates every object of [fromBase, fromBase + fromLength) reachable
   * from the root chain and, when `remembered` is true, the remembered set
   * (`rememberedCount` offsets, or -1 for dirty cards below `oldTop`) into
   * [toBase + toStart, toBase + toLength). Returns the destination's new top
   * offset (LAB holes included), or -1 when `survivorLimit` survivors plus
   * the bounded LAB waste might not fit (the caller then evacuates serially).
   * More survivors than `survivorLimit` must already mean exhaustion: they
   * can overflow the destination, which is fatal. Weak slots are not
   * supported (the generational emitter rejects weak cells); copying one is
   * fatal. */
  readonly collect: (
    fromBase: number,
    fromLength: number,
    toBase: number,
    toStart: number,
    toLength: number,
    survivorLimit: number,
    rootHead: number,
    startBase: number,
    remembered: boolean,
    rememberedCount: number,
    oldTop: number,
  ) => number;
}

/** Creates the shared record, per-worker state and (lazily) the pool threads.
 * Must run while the runtime initializes: every object created here is
 * permanent control storage that workers may touch. */
export function createParallelEvacuator(
  managedBase: number,
  managedLength: number,
  workers: number,
  starts: Uint32Array,
  remembered: Float64Array,
  dirty: Uint8Array,
): ParallelEvacuator | undefined {
  if (!Number.isInteger(workers) || workers < 2 || workers > 64)
    return undefined;
  const record = mapMemory(recordBytes),
    startsData = permanentArrayAddress(starts);
  if (
    !Number.isSafeInteger(record) ||
    record <= 0 ||
    !Number.isSafeInteger(startsData) ||
    startsData <= 0
  )
    return undefined;
  let states: Worker | undefined = undefined;
  for (let index = workers - 1; index >= 0; index--)
    states = {
      index,
      fromBase: 0,
      fromEnd: 0,
      toBase: 0,
      toLimit: 0,
      startBase: 0,
      firstWord: 0,
      lastWord: 0,
      free: 0,
      limit: 0,
      scan: 0,
      record,
      startsData,
      managedBase,
      managedLength,
      next: states,
    };
  const head = states;
  if (head === undefined) return undefined;
  // Created here, so permanent: the caller (worker 0) scans the stack.
  const mainState: Worker = head;
  const scanFrame = (
    descriptor: number,
    base: number,
    extent: number,
  ): boolean => {
    scanFields(mainState, starts, descriptor, base);
    return true;
  };
  const readWord: ReadWord = (address: number): number | undefined =>
    read(address);
  const shared: ParallelShared = {
    workers,
    rootHead: 0,
    rememberedCount: -2,
    remembered,
    dirty,
    oldBase: 0,
    oldTop: 0,
  };
  // Created here, so permanent: pool threads enter through it.
  const worker = (address: number): number => {
    const index = fetchAddMemoryWord(address + recordNextIndex, 8, 0, 1);
    let found: Worker | undefined = head,
      state: Worker = head;
    while (true) {
      const current: Worker | undefined = found;
      if (current === undefined) return 2;
      if (current.index === index) {
        state = current;
        break;
      }
      found = current.next;
    }
    let seen = 0;
    while (true) {
      seen = waitEpoch(address, seen);
      if (read(address + recordCommand) !== commandEvacuate) return 0;
      try {
        share(state, starts, shared, undefined, readWord);
      } catch {
        compareExchangeMemoryWord(address + recordFailure, 8, 0, 0, 8);
        // Leave the active count consistent so the others terminate.
        fetchAddMemoryWord(address + recordActive, 8, 0, -1);
      }
      fetchAddMemoryWord(address + recordFinished, 8, 0, 1);
      wakeNativeWord(address + recordFinished, 1);
    }
  };
  write(record + recordWorker, permanentFunctionAddress(worker));
  write(record + recordNextIndex, 1);
  write(record + recordWorkers, workers);
  let started = false;
  function start(): boolean {
    const entry = collectorWorkerEntry();
    for (let index = 1; index < workers; index++)
      if (startNativeThread(entry, record) <= 0) return false;
    started = true;
    return true;
  }
  let epoch = 0;
  return {
    workers,
    collect(
      fromBase,
      fromLength,
      toBase,
      toStart,
      toLength,
      survivorLimit,
      rootHead,
      startBase,
      rememberedObjects,
      rememberedCount,
      oldTop,
    ) {
      // Refuse when survivors and LAB holes (including every worker's last,
      // partly used LAB) might not fit.
      const first = toStart;
      if (
        first +
          survivorLimit +
          Math.ceil(survivorLimit / wasteDivisor) +
          workers * labBytes >
        toLength
      )
        return -1;
      if (!started && !start()) return -1;
      let cursor: Worker | undefined = head;
      while (cursor !== undefined) {
        const state: Worker = cursor;
        cursor = state.next;
        state.fromBase = fromBase;
        state.fromEnd = fromBase + fromLength;
        state.toBase = toBase;
        state.toLimit = toBase + toLength;
        state.startBase = startBase;
        state.firstWord = 0;
        state.lastWord = 0;
        state.free = 0;
        state.limit = 0;
        state.scan = 0;
      }
      shared.rootHead = rootHead;
      shared.rememberedCount = rememberedObjects ? rememberedCount : -2;
      shared.oldBase = toBase;
      shared.oldTop = oldTop;
      write(record + recordCommand, commandEvacuate);
      write(record + recordActive, workers);
      write(record + recordFinished, 0);
      write(record + recordFailure, 0);
      write(record + recordCount, 0);
      write(record + recordCursor, first);
      write(record + recordRemembered, 0);
      epoch = epoch + 1;
      storeReleaseMemoryWord(record + recordEpoch, 8, 0, epoch);
      wakeNativeWord(record + recordEpoch, 1);
      const main = head;
      let failed = false;
      try {
        share(main, starts, shared, scanFrame, readWord);
      } catch {
        failed = true;
        fetchAddMemoryWord(record + recordActive, 8, 0, -1);
      }
      while (true) {
        const finished = loadAcquireMemoryWord(record + recordFinished, 8, 0);
        if (finished >= workers - 1) break;
        parkNativeWord(record + recordFinished, finished, 0);
      }
      if (failed || read(record + recordFailure) !== 0)
        throw "PARALLEL_COLLECTOR_FAILED";
      return read(record + recordCursor);
    },
  };
}
