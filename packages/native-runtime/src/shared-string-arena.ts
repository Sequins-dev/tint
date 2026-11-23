// The mutator's half of the process's shared string arena (the layout and the
// collector's half are in external-memory.ts): creating the control page,
// reserving the arena and allocating, retaining and counting bodies.
import {
  addSharedStringCount,
  lockSharedStringArena,
  sharedStringAllocatedMap,
  sharedStringArenaBaseWord,
  sharedStringArenaCap,
  sharedStringArenaCreated,
  sharedStringArenaFallbacks,
  sharedStringArenaGranules,
  sharedStringArenaHint,
  sharedStringArenaLiveBodies,
  sharedStringArenaLiveGranules,
  sharedStringArenaMagic,
  sharedStringArenaMagicValue,
  sharedStringArenaRefused,
  sharedStringArenaResident,
  sharedStringArenaShiftWord,
  sharedStringBodyGranules,
  sharedStringBodyRefs,
  sharedStringControlBytes,
  sharedStringGranules,
  sharedStringObjectOffset,
  sharedStringReservationBytes,
  sharedStringResidentMap,
  unlockSharedStringArena,
  updateSharedStringRun,
  type SharedStringMemory,
} from "./external-memory.ts";

/** Writes an empty arena's control page (a zeroed mapping of
 * sharedStringControlBytes) for granule shift `shift`. */
export function initializeSharedStringArena(
  memory: SharedStringMemory,
  control: number,
  shift: number,
): void {
  const granules = sharedStringGranules(shift);
  if (
    sharedStringResidentMap(granules) + Math.ceil(granules / 32) * 8 >
    sharedStringControlBytes
  )
    throw "SHARED_STRING_CONTROL";
  memory.store(
    control,
    sharedStringControlBytes,
    sharedStringArenaShiftWord,
    shift,
  );
  memory.store(
    control,
    sharedStringControlBytes,
    sharedStringArenaGranules,
    granules,
  );
  memory.store(
    control,
    sharedStringControlBytes,
    sharedStringArenaCap,
    granules,
  );
  memory.store(
    control,
    sharedStringControlBytes,
    sharedStringArenaMagic,
    sharedStringArenaMagicValue,
  );
}
/** Whether `control` is an arena's control page. */
export function sharedStringArenaValid(
  memory: SharedStringMemory,
  control: number,
): boolean {
  return (
    control > 0 &&
    memory.load(control, sharedStringControlBytes, sharedStringArenaMagic) ===
      sharedStringArenaMagicValue
  );
}
export function sharedStringArenaShift(
  memory: SharedStringMemory,
  control: number,
): number {
  return memory.load(
    control,
    sharedStringControlBytes,
    sharedStringArenaShiftWord,
  );
}
/** The reservation's base, 0 until an isolate reserves it. */
export function sharedStringArenaBase(
  memory: SharedStringMemory,
  control: number,
): number {
  return memory.load(
    control,
    sharedStringControlBytes,
    sharedStringArenaBaseWord,
  );
}

/** The reservation's base, reserving it through `map` (a private anonymous
 * mapping of the given bytes, or a value <= 0) if no isolate has; 0 when it
 * cannot be made. */
export function reserveSharedStringArena(
  memory: SharedStringMemory,
  control: number,
  map: (byteLength: number) => number,
): number {
  const existing = sharedStringArenaBase(memory, control);
  if (existing !== 0) return existing;
  lockSharedStringArena(memory, control);
  let base = sharedStringArenaBase(memory, control);
  if (base === 0) {
    const granule = 1 << sharedStringArenaShift(memory, control);
    // One extra granule aligns the base; the mapping lives as long as the
    // process.
    const mapped = map(sharedStringReservationBytes + granule);
    if (mapped > 0) {
      base = Math.ceil(mapped / granule) * granule;
      memory.store(
        control,
        sharedStringControlBytes,
        sharedStringArenaBaseWord,
        base,
      );
    }
  }
  unlockSharedStringArena(memory, control);
  return base;
}

/** The first run of `count` free granules at or after `from`, or -1; the
 * caller holds the lock. */
function findRun(
  memory: SharedStringMemory,
  control: number,
  granules: number,
  from: number,
  count: number,
): number {
  let start = from,
    length = 0,
    granule = from;
  while (granule < granules) {
    const word = memory.load(
      control,
      sharedStringControlBytes,
      sharedStringAllocatedMap + (granule >>> 5) * 8,
    );
    if (word === 0xffffffff) {
      granule = ((granule >>> 5) + 1) * 32;
      length = 0;
      start = granule;
    } else if (((word >>> (granule & 31)) & 1) !== 0) {
      granule++;
      length = 0;
      start = granule;
    } else {
      length++;
      granule++;
      if (length === count) return start;
    }
  }
  return -1;
}

/** A new body with room for a `bytes`-byte string object and reference count
 * `refs`, or 0 when the arena has no room (its soft cap or its reservation;
 * the fallback is counted and the caller copies the string instead). */
export function allocateSharedStringBody(
  memory: SharedStringMemory,
  control: number,
  base: number,
  bytes: number,
  refs: number,
): number {
  const shift = sharedStringArenaShift(memory, control),
    count = Math.ceil((sharedStringObjectOffset + bytes) / (1 << shift));
  lockSharedStringArena(memory, control);
  const granules = memory.load(
      control,
      sharedStringControlBytes,
      sharedStringArenaGranules,
    ),
    live = memory.load(
      control,
      sharedStringControlBytes,
      sharedStringArenaLiveGranules,
    ),
    cap = memory.load(control, sharedStringControlBytes, sharedStringArenaCap),
    hint = memory.load(
      control,
      sharedStringControlBytes,
      sharedStringArenaHint,
    ),
    start =
      live + count <= cap
        ? findRun(memory, control, granules, hint, count)
        : -1;
  if (start < 0) {
    addSharedStringCount(memory, control, sharedStringArenaFallbacks, 1);
    unlockSharedStringArena(memory, control);
    return 0;
  }
  updateSharedStringRun(
    memory,
    control,
    sharedStringAllocatedMap,
    start,
    count,
    true,
  );
  const resident = updateSharedStringRun(
    memory,
    control,
    sharedStringResidentMap(granules),
    start,
    count,
    false,
  );
  if (resident !== 0)
    addSharedStringCount(memory, control, sharedStringArenaResident, -resident);
  if (start === hint)
    memory.store(
      control,
      sharedStringControlBytes,
      sharedStringArenaHint,
      start + count,
    );
  addSharedStringCount(memory, control, sharedStringArenaLiveGranules, count);
  addSharedStringCount(memory, control, sharedStringArenaLiveBodies, 1);
  addSharedStringCount(memory, control, sharedStringArenaCreated, 1);
  unlockSharedStringArena(memory, control);
  const body = base + start * (1 << shift);
  memory.store(body, sharedStringObjectOffset, sharedStringBodyGranules, count);
  memory.store(body, sharedStringObjectOffset, sharedStringBodyRefs, refs);
  return body;
}
/** Adds a reference to a body the caller already holds one of. */
export function retainSharedStringBody(
  memory: SharedStringMemory,
  body: number,
): void {
  let refs = memory.load(body, sharedStringObjectOffset, sharedStringBodyRefs);
  for (;;) {
    if (refs <= 0) throw "SHARED_STRING_RETAIN";
    const seen = memory.exchange(
      body,
      sharedStringObjectOffset,
      sharedStringBodyRefs,
      refs,
      refs + 1,
    );
    if (seen === refs) return;
    refs = seen;
  }
}
/** Counts a string sent by copy because no hold could be queued for it. */
export function countSharedStringFallback(
  memory: SharedStringMemory,
  control: number,
): void {
  lockSharedStringArena(memory, control);
  addSharedStringCount(memory, control, sharedStringArenaFallbacks, 1);
  unlockSharedStringArena(memory, control);
}

export interface SharedStringArenaStats {
  readonly granuleBytes: number;
  readonly capGranules: number;
  readonly liveGranules: number;
  readonly liveBodies: number;
  /** Strings copied instead of shared: no room in the arena, or no room in
   * an isolate's hold queue. */
  readonly fallbacks: number;
  readonly created: number;
  /** Free granules whose pages are still resident: freed by a mutator and
   * not yet returned by a major collection. */
  readonly residentGranules: number;
  /** Page releases the host refused (each leaves its body resident). */
  readonly refusedReleases: number;
}
export function sharedStringArenaStats(
  memory: SharedStringMemory,
  control: number,
): SharedStringArenaStats {
  function word(offset: number): number {
    return memory.load(control, sharedStringControlBytes, offset);
  }
  return {
    granuleBytes: 1 << word(sharedStringArenaShiftWord),
    capGranules: word(sharedStringArenaCap),
    liveGranules: word(sharedStringArenaLiveGranules),
    liveBodies: word(sharedStringArenaLiveBodies),
    fallbacks: word(sharedStringArenaFallbacks),
    created: word(sharedStringArenaCreated),
    residentGranules: word(sharedStringArenaResident),
    refusedReleases: word(sharedStringArenaRefused),
  };
}
