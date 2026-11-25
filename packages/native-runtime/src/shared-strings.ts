import {
  nativeIdentityReleasableBaseOffset,
  nativeIdentityReleasableLengthOffset,
  nativeStringDataOffset,
  nativeStringOneByteHeader,
} from "@tint/abi/host";
import { latin1Text } from "@tint/foundation/text/latin1";
import { adoptExternal } from "./ffi/primitives.ts";
import {
  currentContextDomain,
  isFlatString,
} from "./intrinsics/memory.ts";
import { readMemoryString } from "./intrinsics/packet-memory.ts";
import {
  copyString,
  stringAddress,
  stringAt,
} from "./intrinsics/shared-strings.ts";
import {
  createWeakSlot,
  weakSlotKey,
  weakSlotValue,
} from "./intrinsics/weak.ts";
import {
  allocateSharedStringBody,
  countSharedStringFallback,
  initializeSharedStringArena,
  reserveSharedStringArena,
  retainSharedStringBody,
  sharedStringArenaBase,
  sharedStringArenaShift,
  sharedStringArenaStats,
  sharedStringArenaValid,
  type SharedStringArenaStats,
} from "./shared-string-arena.ts";
import {
  releaseSharedStringBody,
  sharedStringControlBytes,
  sharedStringNotHeld,
  sharedStringObjectOffset,
  sharedStringQueued,
  sharedStringTableBase,
  sharedStringTableControl,
  sharedStringTableGranules,
  sharedStringTableIdentityOffset,
  sharedStringTableMagic,
  sharedStringTableMagicValue,
  sharedStringTableQueue,
  sharedStringTableQueueCapacity,
  sharedStringTableQueueCount,
  sharedStringTableShift,
  sharedStringTableWords,
  type SharedStringMemory,
} from "./external-memory.ts";
import {
  numberFromScratch,
  type NativeSharedMemoryHost,
} from "./shared-memory-host.ts";

/** Zero-copy transfer of large strings between isolates
 * (docs/design-worker-runtime.md, "Shared string bodies"). A message carries a
 * body of the process's shared string arena and one reference to it; the
 * receiver returns the body's string object itself, and its collector keeps
 * a hold on the body while the string is reachable. */
export interface NativeSharedStrings {
  /** Strings of at least this many code units travel as shared bodies. */
  readonly minimumUnits: number;
  /** A body holding `value`, with one reference for a message, or 0 to copy
   * it into the message instead. */
  send(value: string): number;
  /** The string of a received body. The isolate takes over the message's
   * reference. */
  receive(body: number): string;
  /** Drops the reference of a message that will never be received. */
  discard(body: number): void;
  stats(): SharedStringArenaStats;
}

/** Strings of at least 64 KiB of UTF-16 are shared. */
const minimumUnits = 32768;
/** Sent strings whose bodies are remembered: the same string sent again
 * reuses its body. */
const sendCacheEntries = 8;

/** A new arena's control page for the isolate's granule shift, or 0 when its
 * collector keeps no hold table (every string is then copied). */
export function createSharedStringArena(
  memory: NativeSharedMemoryHost,
): number {
  const table = holdTable(memory, new Uint32Array(2));
  if (table === 0) return 0;
  const shift = memory.readSharedUnsigned(
    table,
    sharedStringTableQueue * 4,
    sharedStringTableShift * 4,
    4,
    1,
  );
  const control = memory.mapMemory(sharedStringControlBytes);
  if (control <= 0) return 0;
  initializeSharedStringArena(arenaMemory(memory), control, shift);
  return control;
}

/** The address of the isolate's hold table, or 0 without one. */
function holdTable(
  memory: NativeSharedMemoryHost,
  scratch: Uint32Array,
): number {
  const page = currentContextDomain();
  if (page <= 0) return 0;
  if (
    memory.readSharedWord64(
      page,
      sharedStringTableIdentityOffset + 8,
      sharedStringTableIdentityOffset,
      1,
      scratch,
    ) !== 0
  )
    throw "SHARED_STRING_IDENTITY";
  const table = numberFromScratch(scratch);
  if (
    table !== 0 &&
    memory.readSharedUnsigned(
      table,
      sharedStringTableQueue * 4,
      sharedStringTableMagic * 4,
      4,
      1,
    ) !== sharedStringTableMagicValue
  )
    throw "SHARED_STRING_TABLE";
  return table;
}

function arenaMemory(memory: NativeSharedMemoryHost): SharedStringMemory {
  const scratch = new Uint32Array(2);
  return {
    load: (address, byteLength, offset): number => {
      if (
        memory.readSharedWord64(address, byteLength, offset, 1, scratch) !== 0
      )
        throw "SHARED_STRING_WORD";
      return numberFromScratch(scratch);
    },
    store: (address, byteLength, offset, value): void => {
      if (
        memory.writeSharedWord64(
          address,
          byteLength,
          offset,
          1,
          value % 4294967296,
          Math.floor(value / 4294967296),
        ) !== 0
      )
        throw "SHARED_STRING_WORD";
    },
    exchange: (address, byteLength, offset, expected, replacement): number => {
      if (
        memory.compareExchangeSharedWord64(
          address,
          byteLength,
          offset,
          expected % 4294967296,
          Math.floor(expected / 4294967296),
          replacement % 4294967296,
          Math.floor(replacement / 4294967296),
          scratch,
        ) !== 0
      )
        throw "SHARED_STRING_WORD";
      return numberFromScratch(scratch);
    },
  };
}

/** Whether a string is one flat object, which already owns its units. */
function flatString(value: string): boolean {
  return isFlatString(value) === 1;
}

/** The isolate's service over the arena with control page `control` (0 when
 * the process has none: every string is then copied). */
export function createNativeSharedStrings(
  memory: NativeSharedMemoryHost,
  control: number,
): NativeSharedStrings {
  const words = arenaMemory(memory),
    scratch = new Uint32Array(2),
    cells: unknown[] = [];
  const valid = control !== 0 && sharedStringArenaValid(words, control);
  const shift = valid ? sharedStringArenaShift(words, control) : 0;
  let table = 0,
    tableBytes = 0,
    states = 0,
    queueCapacity = 0,
    granules = 0,
    base = 0,
    end = 0,
    // -1 until the first use, then 1 when this isolate can hold bodies.
    usable = -1;
  function readTable(index: number): number {
    return memory.readSharedUnsigned(table, tableBytes, index * 4, 4, 1);
  }
  function writeTable(index: number, value: number): void {
    if (
      memory.writeSharedUnsigned(table, tableBytes, index * 4, 4, value, 1) !==
      0
    )
      throw "SHARED_STRING_TABLE";
  }
  /** Finds the isolate's hold table and records the arena in it. */
  function attach(): boolean {
    if (usable >= 0) return usable === 1;
    usable = 0;
    if (!valid) return false;
    table = holdTable(memory, scratch);
    if (table === 0) return false;
    tableBytes = sharedStringTableQueue * 4;
    granules = readTable(sharedStringTableGranules);
    queueCapacity = readTable(sharedStringTableQueueCapacity);
    if (readTable(sharedStringTableShift) !== shift) return false;
    tableBytes = sharedStringTableWords(granules, queueCapacity) * 4;
    states = sharedStringTableQueue + queueCapacity;
    base = reserveSharedStringArena(words, control, (bytes): number =>
      memory.mapMemory(bytes),
    );
    if (base === 0) return false;
    end = base + granules * (1 << shift);
    // The arena is the isolate's releasable window, so its collectors may
    // return body pages (memory-release refuses any other range outside the
    // managed mapping). Recorded once, before the table names the arena.
    if (!releasableWindow(base, end - base)) return false;
    writeTable(sharedStringTableBase, base % 4294967296);
    writeTable(sharedStringTableBase + 1, Math.floor(base / 4294967296));
    writeTable(sharedStringTableControl, control % 4294967296);
    writeTable(sharedStringTableControl + 1, Math.floor(control / 4294967296));
    usable = 1;
    return true;
  }
  /** Records [windowBase, windowBase + byteLength) as the identity page's
   * releasable window, unless another one is recorded (false). */
  function releasableWindow(windowBase: number, byteLength: number): boolean {
    const page = currentContextDomain();
    if (page <= 0) return false;
    const recorded = words.load(
      page,
      nativeIdentityReleasableLengthOffset + 8,
      nativeIdentityReleasableBaseOffset,
    );
    if (recorded !== 0) return recorded === windowBase;
    words.store(
      page,
      nativeIdentityReleasableLengthOffset + 8,
      nativeIdentityReleasableLengthOffset,
      byteLength,
    );
    words.store(
      page,
      nativeIdentityReleasableLengthOffset + 8,
      nativeIdentityReleasableBaseOffset,
      windowBase,
    );
    return true;
  }
  /** Queues a hold for a body this isolate starts referencing, unless the
   * queue is full (false). */
  function queue(granule: number): boolean {
    const count = readTable(sharedStringTableQueueCount);
    if (count >= queueCapacity) return false;
    writeTable(states + granule, sharedStringQueued);
    writeTable(sharedStringTableQueue + count, granule);
    writeTable(sharedStringTableQueueCount, count + 1);
    return true;
  }
  function drop(body: number): void {
    releaseSharedStringBody(words, control, base, body, undefined);
  }
  /** A body of the arena's string, copied into this isolate's heap. */
  function copy(body: number): string {
    const header = words.load(
      body,
      sharedStringObjectOffset + nativeStringDataOffset,
      sharedStringObjectOffset,
    );
    const units = memory.readSharedUnsigned(
      body,
      sharedStringObjectOffset * 2,
      sharedStringObjectOffset + 8,
      4,
      1,
    );
    if (header === nativeStringOneByteHeader) {
      const view = adoptExternal(
        new Uint8Array(0),
        body + sharedStringObjectOffset + nativeStringDataOffset,
        units,
      );
      return latin1Text(view, 0, units);
    }
    return readMemoryString(
      body,
      sharedStringObjectOffset * 2 + units * 2,
      sharedStringObjectOffset * 2,
      units,
    );
  }
  /** The body a cached send of `address` made, with its string. */
  function cached(address: number): number {
    for (let index = cells.length - 1; index >= 0; index--) {
      const cell = cells[index],
        key = weakSlotKey(cell);
      if (key === undefined) {
        cells.splice(index, 1);
        continue;
      }
      if (typeof key === "string" && stringAddress(key) === address) {
        const value = weakSlotValue(cell);
        if (typeof value !== "string") throw "SHARED_STRING_CACHE";
        return stringAddress(value) - sharedStringObjectOffset;
      }
    }
    return 0;
  }
  return {
    minimumUnits,
    send(value: string): number {
      if (value.length < minimumUnits || !attach()) return 0;
      const flat = flatString(value);
      const address = stringAddress(value);
      // A string this isolate received (or sent before): it holds the body.
      if (flat && address >= base && address < end) {
        const body = address - sharedStringObjectOffset;
        retainSharedStringBody(words, body);
        return body;
      }
      const known = cached(address);
      if (known !== 0) {
        retainSharedStringBody(words, known);
        return known;
      }
      if (readTable(sharedStringTableQueueCount) >= queueCapacity) {
        countSharedStringFallback(words, control);
        return 0;
      }
      // The sender's hold and the message's reference.
      const extent = nativeStringDataOffset + value.length * 2,
        body = allocateSharedStringBody(words, control, base, extent, 2);
      if (body === 0) return 0;
      if (
        copyString(
          body,
          sharedStringObjectOffset + extent,
          sharedStringObjectOffset,
          value,
        ) < 0
      )
        throw "SHARED_STRING_COPY";
      const granule = (body - base) / (1 << shift);
      if (
        readTable(states + granule) !== sharedStringNotHeld ||
        !queue(granule)
      )
        throw "SHARED_STRING_HOLD";
      const shared = stringAt(body + sharedStringObjectOffset);
      // The cell keeps the shared string, and so the hold, while `value`
      // lives (an ephemeron), without keeping `value` alive.
      if (cells.length >= sendCacheEntries) cells.shift();
      cells.push(createWeakSlot(value, shared, true));
      return body;
    },
    receive(body: number): string {
      if (!attach()) {
        const value = copy(body);
        releaseSharedStringBody(
          words,
          control,
          sharedStringArenaBase(words, control),
          body,
          undefined,
        );
        return value;
      }
      const granule = (body - base) / (1 << shift);
      if (!Number.isInteger(granule) || granule < 0 || granule >= granules)
        throw "SHARED_STRING_GRANT";
      if (readTable(states + granule) !== sharedStringNotHeld) {
        // Held already: the hold's reference outlives the message's.
        drop(body);
        return stringAt(body + sharedStringObjectOffset);
      }
      if (!queue(granule)) {
        countSharedStringFallback(words, control);
        const value = copy(body);
        drop(body);
        return value;
      }
      return stringAt(body + sharedStringObjectOffset);
    },
    discard(body: number): void {
      releaseSharedStringBody(
        words,
        control,
        sharedStringArenaBase(words, control),
        body,
        undefined,
      );
    },
    stats: (): SharedStringArenaStats => sharedStringArenaStats(words, control),
  };
}

/** Observation for fixtures and tools: the arena's statistics, read through
 * the calling isolate's hold table; undefined when it has none or has not
 * used the arena yet. */
export function isolateSharedStringStats(
  memory: NativeSharedMemoryHost,
): SharedStringArenaStats | undefined {
  const scratch = new Uint32Array(2),
    table = holdTable(memory, scratch);
  if (table === 0) return undefined;
  const lo = memory.readSharedUnsigned(
      table,
      sharedStringTableQueue * 4,
      sharedStringTableControl * 4,
      4,
      1,
    ),
    hi = memory.readSharedUnsigned(
      table,
      sharedStringTableQueue * 4,
      (sharedStringTableControl + 1) * 4,
      4,
      1,
    ),
    control = hi * 4294967296 + lo;
  return control === 0
    ? undefined
    : sharedStringArenaStats(arenaMemory(memory), control);
}
/** Observation for fixtures: whether `value` is a shared body's string, and
 * then the calling isolate's hold on it (1 queued, 2 young, 3 old, 0 none)
 * plus ten times the body's reference count; -1 for any other string. */
export function sharedStringHold(
  memory: NativeSharedMemoryHost,
  value: string,
): number {
  return sharedStringHoldAt(memory, stringAddress(value));
}
/** sharedStringHold for the string object at `address`, which need not be
 * live: a freed body reads as no hold and no references. */
export function sharedStringHoldAt(
  memory: NativeSharedMemoryHost,
  address: number,
): number {
  const scratch = new Uint32Array(2),
    table = holdTable(memory, scratch);
  if (table === 0) return -1;
  function word(index: number, bytes: number): number {
    return memory.readSharedUnsigned(table, bytes, index * 4, 4, 1);
  }
  const header = sharedStringTableQueue * 4,
    base =
      word(sharedStringTableBase + 1, header) * 4294967296 +
      word(sharedStringTableBase, header),
    shift = word(sharedStringTableShift, header),
    granules = word(sharedStringTableGranules, header),
    queueCapacity = word(sharedStringTableQueueCapacity, header);
  if (base === 0 || address < base || address >= base + granules * (1 << shift))
    return -1;
  const granule = Math.floor((address - base) / (1 << shift)),
    body = address - sharedStringObjectOffset,
    refs = arenaMemory(memory).load(body, sharedStringObjectOffset, 0);
  return (
    word(
      sharedStringTableQueue + queueCapacity + granule,
      sharedStringTableWords(granules, queueCapacity) * 4,
    ) +
    refs * 10
  );
}
