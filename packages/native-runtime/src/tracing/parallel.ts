import {
  nativeWeakSlotMarker,
  nativeWeakSlotEphemeron,
  nativeWeakSlotKeyOffset,
  nativeWeakSlotValueOffset,
} from "@tint/abi/weak-slot";
import {
  nativeHeaderClaimed,
  nativeHeaderForwarded,
  nativeArrayLengthOffset,
  nativeArrayDataOffset,
  nativeArrayInlineOffset,
  nativeArrayOwnerOffset,
  nativeStringSlicedFlag,
  nativeStringParentOffset,
} from "@tint/abi/host";
import {
  readMemoryWord,
  writeMemoryWord,
  moveMemory,
  mapMemory,
  unmapMemory,
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
  joinNativeThread,
  parkNativeWord,
  wakeNativeWord,
} from "../intrinsics/memory.ts";
import {
  cheneyExtent,
  compactObjectSize,
  compactForwardObject,
  compactKeyAlive,
  evacuatedKeyAlive,
  finishCompactWeak,
  finishEvacuatedWeak,
  type CompactRegion,
  type CompactHelpers,
} from "./cheney.ts";
import {
  walkNativeStack,
  headerMarker,
  headerFlags,
  type ReadWord,
  type VisitWord,
} from "./scan.ts";

/** Parallel stop-the-world evacuation (see docs/parallel-gc.md).
 *
 * A collection is described entirely by the shared raw record and the
 * per-worker state records below, never by the requesting mutator's context,
 * so a pool thread can evacuate any heap whose owner is stopped. Workers run
 * compiled runtime code that allocates nothing and touches no mutator objects:
 * their state records, the start bitmap and the remembered set are permanent
 * control storage created while the runtime initializes.
 *
 * Objects are claimed by a compare-exchange of their header word to
 * `nativeHeaderClaimed`; the winner copies the object into its local
 * allocation buffer, restores the header in the copy and then store-releases
 * the destination plus `nativeHeaderForwarded` into the source header.
 * Losers wait for the release.
 *
 * Reservations are exact. A start-bit word wholly inside the current LAB has
 * one writer and is updated plainly; boundary words, which a neighbouring LAB,
 * a large object or (in a minor) old objects may share, are updated with an
 * atomic compare-exchange. LAB tails stay unused holes: nothing walks survivor
 * space linearly (start bits identify objects). A LAB retires only when an
 * object of at most `largeBytes` does not fit, so holes waste at most
 * largeBytes / labBytes of the destination.
 *
 * Weak slots (docs/parallel-gc.md#weak-slots) are deferred per worker: an
 * evacuation links each copied slot into its winner's lists through the
 * source's dead payload, and the mark records each marked slot in its
 * marker's bounded list. After the strong closure, ephemeron rounds run on
 * the pool (each worker traces the values of its own pending ephemerons
 * whose keys are live, then the pool drains) until a round traces nothing;
 * the requesting thread then clears dead keys' pairs and weak cells' values
 * over every list. A round cannot miss a key that becomes live during it:
 * keys become live only through tracing, and a round that traced anything
 * is followed by another. */

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
  recordMarkOverflow = 96,
  recordSawView = 104,
  recordWake = 112,
  recordParked = 120,
  recordSegments = 4096;
/** Mark-compact weak slots each worker can record before the serial
 * fixpoint takes over (raw words, mapped once per worker). */
const weakListCapacity = 65536;
/** Outstanding scan segments are bounded by retired LABs plus large objects,
 * at most heap / 4 KiB: 2^20 pairs cover a 4 GiB space. */
const segmentCapacity = 1048576;
const recordBytes = recordSegments + segmentCapacity * 16;
const commandEvacuate = 1;
/** Mark-compact phases (see createCompactor in cheney.ts). */
const commandMark = 2;
const commandForward = 3;
/** Ephemeron rounds: a minor's (evacuating values) and a major's (marking
 * them). */
const commandEvacuateEphemerons = 4;
const commandMarkEphemerons = 5;
/** Per-worker mark stack entries (granule indexes, one word each). */
const markStackCapacity = 262144;
/** The shared mark stack reuses the segment area, one granule per word. */
const sharedMarkCapacity = segmentCapacity * 2;
/** Granules moved between a worker's stack and the shared one at a time. */
const markBatch = 256;
/** Start-bit words a forwarding worker claims at a time (64 KiB of heap). */
const forwardChunk = 256;

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
  record: number;
  /** Raw address of the start bitmap's data. */
  readonly startsData: number;
  readonly managedBase: number;
  readonly managedLength: number;
  /** Mark-compact: the region's live bits' raw address, this worker's
   * mark stack (raw words) and depth, and the bytes it marked. */
  liveData: number;
  markStack: number;
  markDepth: number;
  liveBytes: number;
  /** Evacuation: the weak slots this worker copied, as lists of source
   * addresses (0 ends a list) linked through each source's first payload
   * word, dead once copied: ephemerons whose values are not yet traced, and
   * every other slot. */
  weakPending: number;
  weakDone: number;
  /** Mark: the weak slots this worker marked (raw words: pending
   * ephemerons first, then the rest), their count and whether a slot did
   * not fit. */
  weakList: number;
  weakCount: number;
  weakOverflowed: boolean;
  /** Pending ephemerons (either phase). */
  weakPendingCount: number;
  /** Ephemeron values this worker traced in the current round. */
  traced: number;
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
  w.firstWord = (lab - w.startBase) >>> 8;
  w.lastWord = (lab + labBytes - w.startBase) >>> 8;
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
    unit = (destination - startBase) >>> 3,
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
  announceWork(record);
}
/** Publishes new shared work: wakes parked workers, if any. A waiter
 * counts itself parked before reading the wake sequence, so either this
 * sees it or it sees the bumped sequence. */
function announceWork(record: number): void {
  fetchAddMemoryWord(record + recordWake, 8, 0, 1);
  if (loadAcquireMemoryWord(record + recordParked, 8, 0) > 0)
    wakeNativeWord(record + recordWake, 1);
}
/** An idle worker's wait (it has left the active count): true when shared
 * work appeared (it is active again), false when every worker is idle (the
 * phase is over). It spins briefly, then parks on the wake sequence, which
 * every export and the final idle transition bump, so a busy host is not
 * charged for waiting workers. */
function waitForWork(w: Worker): boolean {
  const record = w.record;
  if (fetchAddMemoryWord(record + recordActive, 8, 0, -1) === 1) {
    // The last active worker: release every waiter.
    fetchAddMemoryWord(record + recordWake, 8, 0, 1);
    wakeNativeWord(record + recordWake, 1);
    return false;
  }
  let spins = 0;
  while (true) {
    if (spins >= 64) fetchAddMemoryWord(record + recordParked, 8, 0, 1);
    const sequence = loadAcquireMemoryWord(record + recordWake, 8, 0);
    if (loadAcquireMemoryWord(record + recordActive, 8, 0) === 0) {
      if (spins >= 64) fetchAddMemoryWord(record + recordParked, 8, 0, -1);
      return false;
    }
    if (read(record + recordCount) > 0) {
      if (spins >= 64) fetchAddMemoryWord(record + recordParked, 8, 0, -1);
      fetchAddMemoryWord(record + recordActive, 8, 0, 1);
      return true;
    }
    if (spins < 64) {
      spins++;
      spin(w);
      continue;
    }
    if (read(record + recordFailure) !== 0) throw "PARALLEL_COLLECTOR_FAILED";
    // A bounded park: a missed wake only delays this worker.
    parkNativeWord(record + recordWake, sequence % 4294967296, 1000000);
    fetchAddMemoryWord(record + recordParked, 8, 0, -1);
  }
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
  while (true) {
    const header = loadAcquireMemoryWord(address, 8, 0);
    if (header >= nativeHeaderForwarded) return header - nativeHeaderForwarded;
    if (header >= nativeHeaderClaimed) {
      spin(w);
      continue;
    }
    if (
      compareExchangeMemoryWord(address, 8, 0, header, nativeHeaderClaimed) !==
      header
    )
      continue;
    const marker = headerMarker(header),
      flags = headerFlags(header),
      size = cheneyExtent(address, marker, flags),
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
    // The copy took the claimed header.
    write(destination, header);
    markStart(w, starts, destination, size <= largeBytes);
    if (marker >= 2 && marker <= 5) {
      if (flags === 0)
        write(
          destination + nativeArrayDataOffset,
          destination + nativeArrayInlineOffset,
        );
      else if (flags === 2) {
        // The source still holds the original data and owner words.
        const owner = read(address + nativeArrayOwnerOffset),
          moved =
            owner >= w.fromBase && owner < w.fromEnd
              ? evacuate(w, starts, owner)
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
    } else if (marker === nativeWeakSlotMarker) {
      // The source's payload is dead once copied: it links the slot into
      // this worker's lists (no other thread reads past a source header).
      if (flags === nativeWeakSlotEphemeron) {
        write(address + nativeWeakSlotKeyOffset, w.weakPending);
        w.weakPending = address;
        w.weakPendingCount += 1;
      } else {
        write(address + nativeWeakSlotKeyOffset, w.weakDone);
        w.weakDone = address;
      }
    }
    storeReleaseMemoryWord(address, 8, 0, destination + nativeHeaderForwarded);
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
  const header = read(address),
    marker = headerMarker(header),
    flags = headerFlags(header);
  scanHeaded(w, starts, address, marker, flags);
  return cheneyExtent(address, marker, flags);
}
/** Updates the fields of one object whose header words were read. A copied
 * weak slot's key and value wait for the strong closure (it was linked into
 * its copier's lists). */
function scanHeaded(
  w: Worker,
  starts: Uint32Array,
  address: number,
  marker: number,
  flags: number,
): void {
  if (marker > 6) {
    if (marker === nativeWeakSlotMarker) return;
    if (marker % 8 !== 0 || flags !== 0) fail(w, 5);
    scanFields(w, starts, marker + 8, address);
    return;
  }
  if (marker === 6) {
    const capacity = read(address + nativeArrayLengthOffset),
      fromBase = w.fromBase,
      fromEnd = w.fromEnd;
    for (let index = 0; index < capacity; index++) {
      const slot = address + nativeArrayInlineOffset + index * 8,
        value = read(slot);
      if (value >= fromBase && value < fromEnd && value !== 0)
        write(slot, evacuate(w, starts, value));
    }
  } else if (marker >= 2 && marker <= 5 && flags === 2)
    referenceSlot(w, starts, address + nativeArrayOwnerOffset);
  else if (marker === 1 && flags >= nativeStringSlicedFlag)
    // A slice holds its parent like any reference field.
    referenceSlot(w, starts, address + nativeStringParentOffset);
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
      const header = read(scan),
        marker = headerMarker(header),
        flags = headerFlags(header);
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
    if (!waitForWork(w)) return;
  }
}

/** Updates the fields of a remembered old object. An old weak slot is
 * scanned strongly, as the serial minor does: its key is old (keys never
 * change and every minor survivor is promoted), so it is live for a minor,
 * and the barrier remembered it for a young value. */
function scanOld(w: Worker, starts: Uint32Array, address: number): void {
  const header = read(address),
    marker = headerMarker(header);
  if (marker === nativeWeakSlotMarker) {
    generalSlot(w, starts, address + nativeWeakSlotKeyOffset);
    generalSlot(w, starts, address + nativeWeakSlotValueOffset);
  } else scanHeaded(w, starts, address, marker, headerFlags(header));
}

/** One ephemeron round of an evacuation over `owner`'s pending list (the
 * worker's own on the pool): an ephemeron whose key survived traces its
 * value and moves to the finished list; the rest stay pending. Slots copied
 * meanwhile join the copier's lists for the next round. */
function traceCopiedEphemerons(
  w: Worker,
  starts: Uint32Array,
  owner: Worker,
): void {
  let source = owner.weakPending;
  owner.weakPending = 0;
  owner.weakPendingCount = 0;
  while (source !== 0) {
    const next = read(source + nativeWeakSlotKeyOffset),
      slot = read(source) - nativeHeaderForwarded;
    if (evacuatedKeyAlive(w.fromBase, w.fromEnd, slot) === 1) {
      generalSlot(w, starts, slot + nativeWeakSlotValueOffset);
      write(source + nativeWeakSlotKeyOffset, owner.weakDone);
      owner.weakDone = source;
      w.traced += 1;
    } else {
      write(source + nativeWeakSlotKeyOffset, owner.weakPending);
      owner.weakPending = source;
      owner.weakPendingCount += 1;
    }
    source = next;
  }
}
/** Clears the copied weak slots of one list once the closure is final. */
function finishCopiedList(w: Worker, source: number): void {
  let at = source;
  while (at !== 0) {
    finishEvacuatedWeak(
      w.fromBase,
      w.fromEnd,
      read(at) - nativeHeaderForwarded,
    );
    at = read(at + nativeWeakSlotKeyOffset);
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
        scanOld(w, starts, shared.oldBase + offset);
      }
    }
  }
  // Overflowed remembered set: dirty cards over the old prefix, by chunks.
  const dirty = shared.dirty,
    end = Math.ceil(shared.oldTop / 64);
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
            const offset = byte * 64 + bit * 8,
              unit = offset >>> 3;
            if (
              offset < shared.oldTop &&
              ((starts[unit >>> 5] ?? 0) & (1 << (unit & 31))) !== 0
            )
              scanOld(w, starts, shared.oldBase + offset);
          }
    }
  }
}

/** Moves up to `count` granules from the top of this worker's mark stack to
 * the shared stack; false when the shared stack is full. */
function exportMarks(w: Worker, count: number): boolean {
  const record = w.record;
  lock(record);
  const shared = read(record + recordCount),
    moved = Math.min(count, sharedMarkCapacity - shared, w.markDepth);
  for (let i = 0; i < moved; i++)
    write(
      record + recordSegments + (shared + i) * 8,
      read(w.markStack + (w.markDepth - 1 - i) * 8),
    );
  w.markDepth -= moved;
  storeReleaseMemoryWord(record + recordCount, 8, 0, shared + moved);
  unlock(record);
  if (moved > 0) announceWork(record);
  return moved > 0;
}
/** Takes a batch of shared granules onto this worker's (empty) stack. */
function importMarks(w: Worker): boolean {
  const record = w.record;
  if (read(record + recordCount) === 0) return false;
  lock(record);
  const shared = read(record + recordCount),
    moved = Math.min(shared, markBatch);
  for (let i = 0; i < moved; i++)
    write(
      w.markStack + i * 8,
      read(record + recordSegments + (shared - 1 - i) * 8),
    );
  w.markDepth = moved;
  storeReleaseMemoryWord(record + recordCount, 8, 0, shared - moved);
  unlock(record);
  return moved > 0;
}
/** Sets live bits over [first, end) granules beyond the claimed first word:
 * whole words have no other writer; a partial last word may share its word
 * with following objects, so it is merged atomically. */
function setLiveRange(
  w: Worker,
  live: Uint32Array,
  first: number,
  end: number,
): void {
  let granule = first;
  while (granule < end) {
    const at = granule >>> 5,
      count = Math.min(32 - (granule & 31), end - granule);
    if (count === 32) live[at] = 0xffffffff;
    else {
      const mask = (((1 << count) - 1) << (granule & 31)) >>> 0;
      while (true) {
        const old = live[at] ?? 0,
          seen = compareExchangeMemoryUnsigned(
            w.liveData + at * 4,
            4,
            0,
            4,
            old,
            (old | mask) >>> 0,
          );
        if (seen === old) break;
        if (seen < 0) fail(w, 12);
      }
    }
    granule += count;
  }
}
/** Marks the object at `address` (inside the region) once across workers:
 * the bit of its first granule is claimed by compare-exchange, together with
 * the rest of that word's range; the winner sets the remaining bits and
 * queues the object. */
function markObject(w: Worker, region: CompactRegion, address: number): void {
  const live = region.live,
    granule = (address - region.base) >>> 3,
    word = granule >>> 5,
    shift = granule & 31,
    header = read(address),
    size = compactObjectSize(address, header),
    end = granule + (size >>> 3),
    firstCount = Math.min(32 - shift, end - granule),
    firstMask =
      firstCount === 32 ? 0xffffffff : (((1 << firstCount) - 1) << shift) >>> 0,
    bit = (1 << shift) >>> 0;
  while (true) {
    const old = live[word] ?? 0;
    if ((old & bit) >>> 0 !== 0) return;
    const seen = compareExchangeMemoryUnsigned(
      w.liveData + word * 4,
      4,
      0,
      4,
      old,
      (old | firstMask) >>> 0,
    );
    if (seen === old) break;
    if (seen < 0) fail(w, 12);
  }
  if (granule + firstCount < end)
    setLiveRange(w, live, granule + firstCount, end);
  w.liveBytes += size;
  if (w.markDepth >= markStackCapacity && !exportMarks(w, markBatch * 4)) {
    // Both stacks are full: the object stays marked and a serial rescan
    // after this phase traces its children.
    write(w.record + recordMarkOverflow, 1);
    return;
  }
  write(w.markStack + w.markDepth * 8, granule);
  w.markDepth += 1;
}
function markReference(w: Worker, region: CompactRegion, value: number): void {
  if (value >= region.base && value < region.end && value !== 0)
    markObject(w, region, value);
}
function markGeneral(w: Worker, region: CompactRegion, slot: number): void {
  const tag = read(slot);
  if (tag === 3 || tag === 5 || tag === 6 || tag === 7)
    markReference(w, region, read(slot + 8));
  else if (tag > 7) fail(w, 4);
}
function markFields(
  w: Worker,
  region: CompactRegion,
  descriptor: number,
  base: number,
): void {
  const count = read(descriptor);
  for (let index = 0; index < count; index++)
    markReference(w, region, read(base + read(descriptor + 8 + index * 8)));
  const generals = descriptor + 8 + count * 8,
    generalCount = read(generals);
  for (let index = 0; index < generalCount; index++)
    markGeneral(w, region, base + read(generals + 8 + index * 8));
}
/** Records a marked weak slot: its key and value wait for the strong
 * closure. Pending ephemerons stay a prefix of the list. A full list leaves
 * the slot to the compactor's serial fixpoint (which walks every live slot). */
function recordMarkedWeak(w: Worker, address: number, header: number): void {
  const count = w.weakCount,
    list = w.weakList;
  if (count >= weakListCapacity) {
    w.weakOverflowed = true;
    return;
  }
  if (headerFlags(header) === nativeWeakSlotEphemeron) {
    const pending = w.weakPendingCount;
    write(list + count * 8, read(list + pending * 8));
    write(list + pending * 8, address);
    w.weakPendingCount = pending + 1;
  } else write(list + count * 8, address);
  w.weakCount = count + 1;
}
/** One ephemeron round of a mark over `owner`'s pending prefix: a live key
 * marks its ephemeron's value, which leaves the prefix. */
function traceMarkedEphemerons(
  w: Worker,
  region: CompactRegion,
  owner: Worker,
): void {
  const list = owner.weakList;
  let index = 0,
    pending = owner.weakPendingCount;
  while (index < pending) {
    const slot = read(list + index * 8);
    if (compactKeyAlive(region, slot) === 1) {
      pending -= 1;
      write(list + index * 8, read(list + pending * 8));
      write(list + pending * 8, slot);
      markGeneral(w, region, slot + nativeWeakSlotValueOffset);
      w.traced += 1;
    } else index += 1;
  }
  owner.weakPendingCount = pending;
}
function markChildren(w: Worker, region: CompactRegion, address: number): void {
  const header = read(address),
    marker = headerMarker(header);
  if (marker > 6) {
    if (marker === nativeWeakSlotMarker) recordMarkedWeak(w, address, header);
    else markFields(w, region, marker + 8, address);
  } else if (marker === 6) {
    const capacity = read(address + nativeArrayLengthOffset);
    for (let index = 0; index < capacity; index++)
      markReference(
        w,
        region,
        read(address + nativeArrayInlineOffset + index * 8),
      );
  } else if (marker >= 2 && headerFlags(header) === 2) {
    write(w.record + recordSawView, 1);
    markReference(w, region, read(address + nativeArrayOwnerOffset));
  } else if (marker === 1 && headerFlags(header) >= nativeStringSlicedFlag)
    markReference(w, region, read(address + nativeStringParentOffset));
}
/** Traces this worker's and the shared mark stack until every worker is
 * idle and the shared stack is empty (the drain's termination protocol). */
function drainMarks(w: Worker, region: CompactRegion): void {
  const record = w.record;
  let sinceShare = 0;
  while (true) {
    if (w.markDepth > 0) {
      const depth = w.markDepth - 1;
      w.markDepth = depth;
      markChildren(w, region, region.base + read(w.markStack + depth * 8) * 8);
      if (++sinceShare >= 64) {
        sinceShare = 0;
        if (
          w.markDepth > markBatch &&
          read(record + recordCount) === 0 &&
          read(record + recordActive) < read(record + recordWorkers)
        )
          exportMarks(w, w.markDepth >>> 1);
      }
      continue;
    }
    if (importMarks(w)) continue;
    if (!waitForWork(w)) return;
  }
}
/** Phase 4 over claimed chunks of start-bit words. */
function forwardChunks(
  w: Worker,
  region: CompactRegion,
  starts: Uint32Array,
  words: number,
): void {
  const record = w.record,
    live = region.live,
    base = region.base;
  while (true) {
    const first = fetchAddMemoryWord(record + recordCursor, 8, 0, forwardChunk);
    if (first < 0) fail(w, 14);
    if (first >= words) return;
    const last = Math.min(words, first + forwardChunk);
    for (let word = first; word < last; word++) {
      let bits = ((starts[word] ?? 0) & (live[word] ?? 0)) >>> 0;
      while (bits !== 0) {
        const bit = 31 - Math.clz32(bits & -bits);
        bits = (bits & (bits - 1)) >>> 0;
        const address = base + (word * 32 + bit) * 8;
        compactForwardObject(region, address, read(address));
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
  /** Mark-compact phases: the region and its start-bit word count. */
  region: CompactRegion | undefined;
  words: number;
}

/** One worker's share: optional roots (each stack frame's safepoint map and
 * register-held references, for the caller's worker), remembered objects,
 * then the drain. */
function share(
  w: Worker,
  starts: Uint32Array,
  shared: ParallelShared,
  roots: VisitWord | undefined,
  generalRoots: VisitWord | undefined,
  readWord: ReadWord,
): void {
  if (
    roots !== undefined &&
    generalRoots !== undefined &&
    walkNativeStack(readWord, shared.rootHead, roots, generalRoots, 1000000) !==
      "complete"
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

export interface ParallelEvacuator extends CompactHelpers {
  /** Worker count including the caller (worker 0). */
  readonly workers: number;
  /** Stop and join all workers before releasing permanent state. */
  readonly dispose: () => void;
  /** Evacuates every object of [fromBase, fromBase + fromLength) reachable
   * from the root chain and, when `remembered` is true, the remembered set
   * (`rememberedCount` offsets, or -1 for dirty cards below `oldTop`) into
   * [toBase + toStart, toBase + toLength). Returns the destination's new top
   * offset (LAB holes included), or -1 when `survivorLimit` survivors plus
   * the bounded LAB waste might not fit (the caller then evacuates serially).
   * More survivors than `survivorLimit` must already mean exhaustion: they
   * can overflow the destination, which is fatal. Copied weak slots follow
   * the serial rules: ephemerons whose keys survived keep their values, to
   * a fixpoint, then dead keys clear both pairs and weak cells drop their
   * value pair; remembered old slots are scanned strongly. */
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

/** Creates per-worker permanent state and (lazily) the raw workspace mapping
 * and pool threads on first parallel collection. Must run while the runtime
 * initializes: every managed object created here is permanent control storage
 * that workers may touch without allocating during a pause. */
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
  const startsData = permanentArrayAddress(starts);
  if (!Number.isSafeInteger(startsData) || startsData <= 0) return undefined;
  const workspaceBytes =
    recordBytes + workers * (markStackCapacity * 8 + weakListCapacity * 8);
  let record = 0;
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
      liveData: 0,
      markStack: 0,
      markDepth: 0,
      liveBytes: 0,
      weakPending: 0,
      weakDone: 0,
      weakList: 0,
      weakCount: 0,
      weakPendingCount: 0,
      weakOverflowed: false,
      traced: 0,
      record: 0,
      startsData,
      managedBase,
      managedLength,
      next: states,
    };
  const head = states;
  if (head === undefined) return undefined;
  function releaseWorkspaces(): void {
    if (record === 0) return;
    const workspace = record;
    record = 0;
    for (let state: Worker | undefined = head; state !== undefined;) {
      const current: Worker = state;
      current.record = 0;
      current.markStack = 0;
      current.weakList = 0;
      state = current.next;
    }
    unmapMemory(workspace, workspaceBytes);
  }
  // Created here, so permanent: the caller (worker 0) scans the stack.
  const mainState: Worker = head;
  const scanReference = (slot: number): boolean => {
    referenceSlot(mainState, starts, slot);
    return true;
  };
  const scanGeneral = (slot: number): boolean => {
    generalSlot(mainState, starts, slot);
    return true;
  };
  const readWord: ReadWord = (address: number): number | undefined =>
    read(address);
  // The mark phase's roots, also walked by the caller's worker.
  const markRoot = (slot: number): boolean => {
    const region = shared.region;
    if (region !== undefined) markReference(mainState, region, read(slot));
    return true;
  };
  const markGeneralRoot = (slot: number): boolean => {
    const region = shared.region;
    if (region !== undefined) markGeneral(mainState, region, slot);
    return true;
  };
  const shared: ParallelShared = {
    workers,
    rootHead: 0,
    rememberedCount: -2,
    remembered,
    dirty,
    oldBase: 0,
    oldTop: 0,
    region: undefined,
    words: 0,
  };
  /** One thread's part of a pool command (the caller's included, after its
   * root walk). */
  function work(state: Worker, command: number): void {
    const region = shared.region;
    if (command === commandEvacuate)
      share(state, starts, shared, undefined, undefined, readWord);
    else if (command === commandEvacuateEphemerons) {
      traceCopiedEphemerons(state, starts, state);
      drain(state, starts);
    } else if (region === undefined) fail(state, 13);
    else if (command === commandMark) drainMarks(state, region);
    else if (command === commandMarkEphemerons) {
      traceMarkedEphemerons(state, region, state);
      drainMarks(state, region);
    } else forwardChunks(state, region, starts, shared.words);
  }
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
      const command = read(address + recordCommand);
      if (command < commandEvacuate || command > commandMarkEphemerons)
        return 0;
      try {
        work(state, command);
      } catch {
        compareExchangeMemoryWord(address + recordFailure, 8, 0, 0, 8);
        // Leave the active count consistent so the others terminate.
        fetchAddMemoryWord(address + recordActive, 8, 0, -1);
      }
      fetchAddMemoryWord(address + recordFinished, 8, 0, 1);
      wakeNativeWord(address + recordFinished, 1);
    }
  };
  const workerAddress = permanentFunctionAddress(worker);
  const handles = new Float64Array(workers - 1);
  let count = 0;
  let started = false;
  let epoch = 0;
  function stopWorkers(): void {
    if (count === 0) return;
    // Command zero ends waitEpoch's consumer loop. Publish it before waking
    // even workers that have been created but have not started waiting yet.
    write(record + recordCommand, 0);
    epoch = epoch + 1;
    storeReleaseMemoryWord(record + recordEpoch, 8, 0, epoch);
    wakeNativeWord(record + recordEpoch, 1);
    for (let i = 0; i < count; i++) {
      const handle = handles[i];
      if (handle === undefined || joinNativeThread(handle) !== 0)
        throw "PARALLEL_COLLECTOR_JOIN_FAILED";
    }
    count = 0;
    started = false;
  }
  function start(): boolean {
    if (record === 0) {
      const workspace = mapMemory(workspaceBytes);
      if (!Number.isSafeInteger(workspace) || workspace <= 0) return false;
      record = workspace;
      let at = workspace + recordBytes;
      for (let state: Worker | undefined = head; state !== undefined;) {
        const current: Worker = state;
        current.record = workspace;
        current.markStack = at;
        at += markStackCapacity * 8;
        current.weakList = at;
        at += weakListCapacity * 8;
        state = current.next;
      }
      write(record + recordWorker, workerAddress);
      write(record + recordNextIndex, 1);
      write(record + recordWorkers, workers);
    }
    const entry = collectorWorkerEntry();
    for (let index = 1; index < workers; index++) {
      const handle = startNativeThread(entry, record);
      if (handle <= 0) {
        stopWorkers();
        releaseWorkspaces();
        epoch = 0;
        return false;
      }
      handles[count++] = handle;
    }
    started = true;
    return true;
  }
  /** Runs one command on the pool, the caller taking part as worker 0
   * (after walking the roots for a mark), and waits for every worker.
   * `cursor` seeds the shared cursor (an evacuation's destination top). A
   * failure anywhere is fatal. */
  function runCommand(command: number, cursor: number, rootHead: number): void {
    for (let state: Worker | undefined = head; state !== undefined;) {
      const current: Worker = state;
      current.markDepth = 0;
      current.liveBytes = 0;
      current.traced = 0;
      state = current.next;
    }
    write(record + recordCommand, command);
    write(record + recordActive, workers);
    write(record + recordFinished, 0);
    write(record + recordFailure, 0);
    write(record + recordCount, 0);
    write(record + recordCursor, cursor);
    write(record + recordRemembered, 0);
    write(record + recordMarkOverflow, 0);
    write(record + recordSawView, 0);
    write(record + recordParked, 0);
    epoch = epoch + 1;
    storeReleaseMemoryWord(record + recordEpoch, 8, 0, epoch);
    wakeNativeWord(record + recordEpoch, 1);
    const main = mainState;
    let failed = false;
    try {
      if (command === commandEvacuate)
        share(main, starts, shared, scanReference, scanGeneral, readWord);
      else {
        if (
          command === commandMark &&
          walkNativeStack(
            readWord,
            rootHead,
            markRoot,
            markGeneralRoot,
            1000000,
          ) !== "complete"
        )
          fail(main, 7);
        work(main, command);
      }
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
  }
  /** Values traced by every worker in the last command. */
  function tracedTotal(): number {
    let total = 0;
    for (let state: Worker | undefined = head; state !== undefined;) {
      const current: Worker = state;
      total += current.traced;
      state = current.next;
    }
    return total;
  }
  /** Bytes marked by every worker in the last command. */
  function markedTotal(): number {
    let bytes = 0;
    for (let state: Worker | undefined = head; state !== undefined;) {
      const current: Worker = state;
      bytes += current.liveBytes;
      state = current.next;
    }
    return bytes;
  }
  // Mark outcome across the mark and its ephemeron rounds.
  let markOverflow = false,
    markView = false,
    weakPending = false;
  /** Pending ephemerons over every worker. */
  function pendingTotal(): number {
    let total = 0;
    for (let state: Worker | undefined = head; state !== undefined;) {
      const current: Worker = state;
      total += current.weakPendingCount;
      state = current.next;
    }
    return total;
  }
  /** The ephemeron fixpoint and clearing after a parallel mark; returns the
   * bytes the rounds marked. Stops (leaving every slot to the compactor's
   * serial fixpoint) once a list or the mark stacks overflow. */
  function finishMarkedWeak(region: CompactRegion): number {
    let marked = 0;
    while (true) {
      for (let state: Worker | undefined = head; state !== undefined;) {
        const current: Worker = state;
        if (current.weakOverflowed) weakPending = true;
        state = current.next;
      }
      if (weakPending) return marked;
      if (pendingTotal() === 0) break;
      runCommand(commandMarkEphemerons, 0, 0);
      marked += markedTotal();
      if (read(record + recordSawView) !== 0) markView = true;
      if (read(record + recordMarkOverflow) !== 0) {
        markOverflow = true;
        weakPending = true;
        return marked;
      }
      if (tracedTotal() === 0) break;
    }
    for (let state: Worker | undefined = head; state !== undefined;) {
      const current: Worker = state;
      for (let index = 0; index < current.weakCount; index++)
        finishCompactWeak(region, read(current.weakList + index * 8));
      state = current.next;
    }
    return marked;
  }
  /** The ephemeron fixpoint and clearing after a parallel evacuation. */
  function finishCopiedWeak(): void {
    while (pendingTotal() > 0) {
      runCommand(commandEvacuateEphemerons, read(record + recordCursor), 0);
      if (tracedTotal() === 0) break;
    }
    for (let state: Worker | undefined = head; state !== undefined;) {
      const current: Worker = state;
      finishCopiedList(current, current.weakPending);
      finishCopiedList(current, current.weakDone);
      current.weakPending = 0;
      current.weakDone = 0;
      current.weakPendingCount = 0;
      state = current.next;
    }
  }
  return {
    workers,
    dispose() {
      stopWorkers();
      releaseWorkspaces();
    },
    mark(region, rootHead) {
      if (!started && !start()) return -1;
      const liveData = permanentArrayAddress(region.live);
      if (!Number.isSafeInteger(liveData) || liveData <= 0) return -1;
      shared.region = region;
      let sawWeak = false;
      for (let state: Worker | undefined = head; state !== undefined;) {
        const current: Worker = state;
        current.liveData = liveData;
        current.weakCount = 0;
        current.weakPendingCount = 0;
        current.weakOverflowed = false;
        state = current.next;
      }
      runCommand(commandMark, 0, rootHead);
      let bytes = markedTotal();
      markOverflow = read(record + recordMarkOverflow) !== 0;
      markView = read(record + recordSawView) !== 0;
      weakPending = false;
      for (let state: Worker | undefined = head; state !== undefined;) {
        const current: Worker = state;
        if (current.weakCount > 0 || current.weakOverflowed) sawWeak = true;
        state = current.next;
      }
      // A mark overflow leaves weak slots to the serial rescan and fixpoint.
      if (sawWeak) {
        if (markOverflow) weakPending = true;
        else bytes += finishMarkedWeak(region);
      }
      shared.region = undefined;
      return bytes;
    },
    markOverflowed() {
      return markOverflow;
    },
    markSawView() {
      return markView;
    },
    markWeakPending() {
      return weakPending;
    },
    forward(region, words) {
      if (!started && !start()) throw "PARALLEL_COLLECTOR_FAILED";
      shared.region = region;
      shared.words = words;
      runCommand(commandForward, 0, 0);
      shared.region = undefined;
    },
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
        state.weakPending = 0;
        state.weakDone = 0;
        state.weakPendingCount = 0;
      }
      shared.rootHead = rootHead;
      shared.rememberedCount = rememberedObjects ? rememberedCount : -2;
      shared.oldBase = toBase;
      shared.oldTop = oldTop;
      runCommand(commandEvacuate, first, rootHead);
      finishCopiedWeak();
      return read(record + recordCursor);
    },
  };
}
