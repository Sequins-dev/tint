import {
  createExternalMemoryRegistry,
  type ExternalMemoryRegistry,
} from "./tracing/external-memory.ts";
import type { SharedStringSpace } from "./tracing/cheney.ts";
import { nativeIdentityHoldTableOffset } from "@tint/abi/host";
import {
  compareExchangeMemoryWord,
  configureExternalMemory,
  currentContextDomain,
  loadAcquireMemoryWord,
  permanentArrayAddress,
  releaseMemory,
  storeReleaseMemoryWord,
  writeMemoryWord,
} from "./intrinsics/memory.ts";

// Memory outside the managed heap that collector runtimes account for:
// registered external windows, and the isolate's holds on the process's
// shared string bodies.

/** Called on the permanent control allocator before managed allocation starts.
 * Collector reads and the application registrar share this one policy object. */
export function initializeExternalMemory(
  managedBase: number,
  managedLength: number,
  controlBase: number,
  controlLength: number,
  imageBase: number,
  imageLength: number,
  stackBase: number,
  stackLength: number,
): ExternalMemoryRegistry {
  const storage = new Float64Array(129),
    reserved = new Float64Array(8);
  reserved[0] = managedBase;
  reserved[1] = managedLength;
  reserved[2] = controlBase;
  reserved[3] = controlLength;
  reserved[4] = imageBase;
  reserved[5] = imageLength;
  reserved[6] = stackBase;
  reserved[7] = stackLength;
  const registry = createExternalMemoryRegistry(storage, reserved);
  if (registry === undefined) throw "INVALID_EXTERNAL_MEMORY_WINDOWS";
  if (configureExternalMemory(registry.register) !== 0)
    throw "INVALID_EXTERNAL_MEMORY_PUBLICATION";
  return registry;
}

// --- Shared string bodies (docs/design-worker-runtime.md) -------------------
//
// The process's shared string arena: every isolate may reference a body's
// string object directly, as it does an image literal (strings are flat,
// immutable and identity-free, so sharing one is unobservable).
// - A control page records the arena: a spin lock, the reservation's base
//   and granule size, a soft cap, statistics and two granule maps (allocated,
//   and free but still resident).
// - The reservation is one private anonymous mapping, made by the first
//   isolate that needs it and kept for the process's lifetime, so collectors
//   recognise a body reference with one range check (SharedStringSpace).
// - A body is whole granules: a reference count, its granule count, then a
//   flat string object copied verbatim, so a reference names the body's
//   first granule.
// Mutators allocate bodies (shared-string-arena.ts) and collector runtimes
// free them; both access every word atomically as an exact integer (map
// words use only their low 32 bits).

/** Atomic access to the control page and bodies, with the readMemoryWord
 * window contract: (address, byteLength, offset) of a live mapping. */
export interface SharedStringMemory {
  load(address: number, byteLength: number, offset: number): number;
  store(
    address: number,
    byteLength: number,
    offset: number,
    value: number,
  ): void;
  /** The word observed; replacement is stored only when it equals
   * `expected`. */
  exchange(
    address: number,
    byteLength: number,
    offset: number,
    expected: number,
    replacement: number,
  ): number;
}
/** Returns a granule-aligned range of the reservation to the OS (it reads as
 * zero afterwards): true when it did. Only collector runtimes can, inside the
 * releasable window the mutator recorded in the isolate's identity page when
 * it attached to the arena (memory-release refuses any other range outside
 * the managed mapping). A refused release is counted and leaves the body
 * resident; it is never the normal path. */
export type SharedStringRelease = (
  address: number,
  byteLength: number,
) => boolean;

export const sharedStringControlBytes = 16384;
/** The reservation's size: the most body bytes the process can share. */
export const sharedStringReservationBytes = 268435456;
/** Body layout: the reference count, the granule count, then the string. */
export const sharedStringObjectOffset = 16;
export const sharedStringBodyRefs = 0;
export const sharedStringBodyGranules = 8;
// Control page words.
export const sharedStringArenaMagicValue = 0x54535431;
export const sharedStringArenaMagic = 0;
const arenaLock = 8;
export const sharedStringArenaBaseWord = 16;
export const sharedStringArenaShiftWord = 24;
export const sharedStringArenaGranules = 32;
export const sharedStringArenaCap = 40;
export const sharedStringArenaLiveGranules = 48;
export const sharedStringArenaLiveBodies = 56;
export const sharedStringArenaFallbacks = 64;
export const sharedStringArenaCreated = 72;
export const sharedStringArenaResident = 80;
export const sharedStringArenaHint = 88;
/** Releases a collector runtime asked for and the host refused. */
export const sharedStringArenaRefused = 96;
export const sharedStringAllocatedMap = 128;
export function sharedStringResidentMap(granules: number): number {
  return sharedStringAllocatedMap + Math.ceil(granules / 32) * 8;
}
/** log2 of the granule size for a kernel page size: at least 16 KiB, and a
 * whole page, so bodies release by pages. */
export function sharedStringShift(pageBytes: number): number {
  let shift = 14;
  while (1 << shift < pageBytes) shift++;
  return shift;
}
/** Granules in the reservation for granule shift `shift`. */
export function sharedStringGranules(shift: number): number {
  return Math.floor(sharedStringReservationBytes / (1 << shift));
}

export function lockSharedStringArena(
  memory: SharedStringMemory,
  control: number,
): void {
  while (
    memory.exchange(control, sharedStringControlBytes, arenaLock, 0, 1) !== 0
  );
}
export function unlockSharedStringArena(
  memory: SharedStringMemory,
  control: number,
): void {
  memory.store(control, sharedStringControlBytes, arenaLock, 0);
}
/** Adds `delta` to a control word; the caller holds the lock. */
export function addSharedStringCount(
  memory: SharedStringMemory,
  control: number,
  offset: number,
  delta: number,
): void {
  memory.store(
    control,
    sharedStringControlBytes,
    offset,
    memory.load(control, sharedStringControlBytes, offset) + delta,
  );
}
/** Sets (or clears) the bits of granules [start, start + count) in the map at
 * `map` and returns how many were set before; the caller holds the lock. */
export function updateSharedStringRun(
  memory: SharedStringMemory,
  control: number,
  map: number,
  start: number,
  count: number,
  set: boolean,
): number {
  let previous = 0,
    granule = start;
  const end = start + count;
  while (granule < end) {
    const low = granule & 31,
      high = Math.min(32, low + end - granule),
      mask =
        high === 32
          ? (0xffffffff << low) >>> 0
          : (((1 << high) >>> 0) - ((1 << low) >>> 0)) >>> 0,
      offset = map + (granule >>> 5) * 8,
      word = memory.load(control, sharedStringControlBytes, offset);
    let bits = (word & mask) >>> 0;
    while (bits !== 0) {
      bits = (bits & (bits - 1)) >>> 0;
      previous++;
    }
    memory.store(
      control,
      sharedStringControlBytes,
      offset,
      set ? (word | mask) >>> 0 : (word & ~mask) >>> 0,
    );
    granule += high - low;
  }
  return previous;
}
/** Drops one reference and frees the body with its last, returning its pages
 * through `release` when given (they stay resident otherwise). True when the
 * body was freed. */
export function releaseSharedStringBody(
  memory: SharedStringMemory,
  control: number,
  base: number,
  body: number,
  release: SharedStringRelease | undefined,
): boolean {
  let refs = memory.load(body, sharedStringObjectOffset, sharedStringBodyRefs);
  for (;;) {
    if (refs <= 0) throw "SHARED_STRING_RELEASE";
    const seen = memory.exchange(
      body,
      sharedStringObjectOffset,
      sharedStringBodyRefs,
      refs,
      refs - 1,
    );
    if (seen === refs) break;
    refs = seen;
  }
  if (refs > 1) return false;
  const shift = memory.load(
      control,
      sharedStringControlBytes,
      sharedStringArenaShiftWord,
    ),
    count = memory.load(
      body,
      sharedStringObjectOffset,
      sharedStringBodyGranules,
    ),
    start = (body - base) / (1 << shift);
  const released = release !== undefined && release(body, count * (1 << shift));
  lockSharedStringArena(memory, control);
  const granules = memory.load(
    control,
    sharedStringControlBytes,
    sharedStringArenaGranules,
  );
  updateSharedStringRun(
    memory,
    control,
    sharedStringAllocatedMap,
    start,
    count,
    false,
  );
  if (release !== undefined && !released)
    addSharedStringCount(memory, control, sharedStringArenaRefused, 1);
  if (!released) {
    updateSharedStringRun(
      memory,
      control,
      sharedStringResidentMap(granules),
      start,
      count,
      true,
    );
    addSharedStringCount(memory, control, sharedStringArenaResident, count);
  }
  if (
    start <
    memory.load(control, sharedStringControlBytes, sharedStringArenaHint)
  )
    memory.store(
      control,
      sharedStringControlBytes,
      sharedStringArenaHint,
      start,
    );
  addSharedStringCount(memory, control, sharedStringArenaLiveGranules, -count);
  addSharedStringCount(memory, control, sharedStringArenaLiveBodies, -1);
  unlockSharedStringArena(memory, control);
  return true;
}
/** Returns the pages of free bodies that mutators left resident. */
function releaseResidentSharedStrings(
  memory: SharedStringMemory,
  control: number,
  base: number,
  release: SharedStringRelease,
): void {
  if (
    memory.load(
      control,
      sharedStringControlBytes,
      sharedStringArenaResident,
    ) === 0
  )
    return;
  lockSharedStringArena(memory, control);
  const granules = memory.load(
      control,
      sharedStringControlBytes,
      sharedStringArenaGranules,
    ),
    shift = memory.load(
      control,
      sharedStringControlBytes,
      sharedStringArenaShiftWord,
    ),
    map = sharedStringResidentMap(granules);
  let start = -1;
  for (let granule = 0; granule <= granules; granule++) {
    const resident =
      granule < granules &&
      ((memory.load(
        control,
        sharedStringControlBytes,
        map + (granule >>> 5) * 8,
      ) >>>
        (granule & 31)) &
        1) !==
        0;
    if (resident && start < 0) start = granule;
    else if (!resident && start >= 0) {
      if (
        !release(base + start * (1 << shift), (granule - start) * (1 << shift))
      ) {
        addSharedStringCount(memory, control, sharedStringArenaRefused, 1);
        break;
      }
      addSharedStringCount(
        memory,
        control,
        sharedStringArenaResident,
        start - granule,
      );
      updateSharedStringRun(
        memory,
        control,
        map,
        start,
        granule - start,
        false,
      );
      start = -1;
    }
  }
  unlockSharedStringArena(memory, control);
}

// An isolate's hold table: 32-bit words its collector runtime owns and
// publishes, as an address, at this byte offset of the isolate's identity page
// (after the shared block registry's two words). The mutator records the
// arena's control address and base once, queues a hold for each body it
// starts referencing and reads the per-granule states; the runtime takes the
// queue at each collection. Both run on the isolate's own thread, never at
// once.
export const sharedStringTableIdentityOffset = nativeIdentityHoldTableOffset;
export const sharedStringTableMagicValue = 0x54535448;
export const sharedStringTableMagic = 0;
export const sharedStringTableShift = 1;
export const sharedStringTableGranules = 2;
export const sharedStringTableQueueCapacity = 3;
export const sharedStringTableQueueCount = 4;
/** Two words each: low then high 32 bits. */
export const sharedStringTableControl = 6;
export const sharedStringTableBase = 8;
/** The queue's granule indices, then one state word per granule. */
export const sharedStringTableQueue = 16;
export function sharedStringTableWords(
  granules: number,
  queueCapacity: number,
): number {
  return sharedStringTableQueue + queueCapacity + granules;
}
/** Granule states: no hold; queued by the mutator; held since the latest
 * collection (young); held across one (old). */
export const sharedStringNotHeld = 0;
export const sharedStringQueued = 1;
export const sharedStringHeld = 2;
export const sharedStringHeldOld = 3;
/** Shared string bodies an isolate may start referencing between two
 * collections; beyond them, received strings are copied. */
export const sharedStringQueueCapacity = 1024;

/** An isolate's holds on shared string bodies. The mutator queues a hold for
 * each body it starts referencing (a received string, or one it copied in to
 * send); collections keep a hold while the body is reachable:
 * - a minor collection frees the unmarked holds queued since the previous
 *   collection and makes the marked ones old (it scans no old object, but
 *   every old object referring to a young hold was written since, so it is
 *   remembered);
 * - a major (or copying) collection frees every unmarked hold.
 * A freed hold drops its reference; the last one frees the body and returns
 * its pages. Shutdown drops every hold. */
export interface SharedStringHolds {
  readonly space: SharedStringSpace;
  /** Before marking: takes the queued holds and sets the space's bounds. */
  begin(): void;
  /** After marking: frees and ages holds as above and clears the marks. */
  finish(minor: boolean): void;
  shutdown(): void;
}

/** The isolate's hold table in zeroed workspace storage the runtime does not
 * otherwise use: `table` (the mutator's half: queue and states), `list` (the
 * held granules) and `marks`, one per arena granule. Publishes the table in
 * the isolate's identity page. Undefined when the storage is too small: the
 * isolate then copies every string. */
export function createSharedStringHolds(
  table: Uint32Array,
  list: Uint32Array,
  marks: Uint8Array,
  pageBytes: number,
): SharedStringHolds | undefined {
  const shift = sharedStringShift(pageBytes),
    granules = sharedStringGranules(shift),
    queueCapacity = sharedStringQueueCapacity,
    words = sharedStringTableWords(granules, queueCapacity);
  if (table.length < words || list.length < granules || marks.length < granules)
    return undefined;
  const page = currentContextDomain();
  if (page <= 0) return undefined;
  table[sharedStringTableShift] = shift;
  table[sharedStringTableGranules] = granules;
  table[sharedStringTableQueueCapacity] = queueCapacity;
  table[sharedStringTableMagic] = sharedStringTableMagicValue;
  const address = permanentArrayAddress(table);
  if (
    !Number.isSafeInteger(address) ||
    address <= 0 ||
    writeMemoryWord(
      page,
      sharedStringTableIdentityOffset + 8,
      sharedStringTableIdentityOffset,
      address,
    ) !== 0
  )
    return undefined;
  const memory: SharedStringMemory = {
    load: (at, byteLength, offset): number =>
      loadAcquireMemoryWord(at, byteLength, offset),
    store: (at, byteLength, offset, value): void => {
      if (storeReleaseMemoryWord(at, byteLength, offset, value) < 0)
        throw "SHARED_STRING_WORD";
    },
    exchange: (at, byteLength, offset, expected, replacement): number =>
      compareExchangeMemoryWord(at, byteLength, offset, expected, replacement),
  };
  const release: SharedStringRelease = (at, byteLength): boolean =>
    releaseMemory(at, byteLength) === 0;
  const states = sharedStringTableQueue + queueCapacity,
    space: SharedStringSpace = { base: 0, end: 0, shift, marks };
  let held = 0,
    control = 0;
  /** Drops the hold's reference to the body at granule `granule`. */
  function drop(granule: number): void {
    table[states + granule] = sharedStringNotHeld;
    releaseSharedStringBody(
      memory,
      control,
      space.base,
      space.base + granule * (1 << shift),
      release,
    );
  }
  function attach(): boolean {
    if (control !== 0) return true;
    control =
      (table[sharedStringTableControl] ?? 0) +
      (table[sharedStringTableControl + 1] ?? 0) * 4294967296;
    if (control === 0) return false;
    space.base =
      (table[sharedStringTableBase] ?? 0) +
      (table[sharedStringTableBase + 1] ?? 0) * 4294967296;
    space.end = space.base + granules * (1 << shift);
    return true;
  }
  /** Takes the queue: each entry is a body the mutator started referencing,
   * whose reference a young hold now owns (or, at shutdown, is dropped). */
  function takeQueue(keep: boolean): void {
    const count = table[sharedStringTableQueueCount] ?? 0;
    for (let index = 0; index < count; index++) {
      const granule = table[sharedStringTableQueue + index] ?? 0;
      if ((table[states + granule] ?? 0) !== sharedStringQueued)
        throw "SHARED_STRING_QUEUE";
      if (keep) {
        table[states + granule] = sharedStringHeld;
        list[held] = granule;
        held++;
      } else drop(granule);
    }
    table[sharedStringTableQueueCount] = 0;
  }
  return {
    space,
    begin(): void {
      if (attach()) takeQueue(true);
    },
    finish(minor: boolean): void {
      if (control === 0) return;
      let kept = 0;
      for (let index = 0; index < held; index++) {
        const granule = list[index] ?? 0;
        if (
          (marks[granule] ?? 0) !== 0 ||
          (minor && (table[states + granule] ?? 0) === sharedStringHeldOld)
        ) {
          marks[granule] = 0;
          table[states + granule] = sharedStringHeldOld;
          list[kept] = granule;
          kept++;
        } else drop(granule);
      }
      held = kept;
      if (!minor)
        releaseResidentSharedStrings(memory, control, space.base, release);
    },
    shutdown(): void {
      if (!attach()) return;
      takeQueue(false);
      for (let index = 0; index < held; index++) drop(list[index] ?? 0);
      held = 0;
    },
  };
}
