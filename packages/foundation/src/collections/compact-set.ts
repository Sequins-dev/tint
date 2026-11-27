import {
  gcEpoch,
  hashString,
  referenceHash,
  usesAddressHash,
} from "./key-index.ts";
export { gcEpoch, referenceHash, usesAddressHash } from "./key-index.ts";

// Compact insertion-ordered open-addressed hash set for general members whose
// type fits a parallel list (objects, bigints, strings, unions, unknown):
// members live in a dense insertion-order list (`members`), mixed hashes live
// in a `Uint32Array` (`removedHash` marks deleted entries), and `slots` maps
// open-addressed probe positions to `entry + 1` (0 empty, `deletedSlot`
// tombstone). Zero per-entry heap records and zero pointer chasing; managed
// reference members rehash in place when `gcEpoch()` advances.
interface StoredUndefined<T> {
  readonly value: T;
}

/** Insertion-ordered members. String, number and BigInt members hash by value;
 * managed references hash by epoch-scoped address and rehash in place on GC. */
export interface CompactSet<T> {
  /** Dense insertion-order members; allocated lazily on first insertion. */
  members: T[] | undefined;
  /** Mixed hashes per entry; `removedHash` marks a deleted entry. */
  hashes: Uint32Array | undefined;
  /** Open-addressed table: 0 empty, 0xffffffff deleted, entry + 1 live. */
  slots: Uint32Array | undefined;
  /** Allocated lazily only when compaction shifts indices after deletions. */
  orders: Float64Array | undefined;
  /** Captured only when T admits undefined and undefined has been stored. */
  undefinedMember: StoredUndefined<T> | undefined;
  /** Entries written since the last compaction or clear. */
  length: number;
  /** Live entries. */
  size: number;
  /** Occupied slots, including deleted tombstones. */
  used: number;
  /** Order offset when `orders` is undefined: entry `i` has order `baseOrder + i + 1`. */
  baseOrder: number;
  /** Monotonic insertion counter; never resets on clear. */
  order: number;
  /** Incremented on compaction or clear so live cursors resync by order. */
  compactions: number;
  /** Nonzero (equals hashes.length) iff dense append-only fast inserts are valid. */
  fastLimit: number;
  /** GC epoch at which address-hashed entries and slots were last built. */
  hashEpoch: number;
}

const initialSlots = 16;
const removedHash = 0xffffffff;
const deletedSlot = 0xffffffff;
const maximumSlots = 0x40000000;
const maxSafeOrder = 9007199254740991;

function valueFallbackHash(value: unknown): number {
  if (typeof value === "string") return hashString(value);
  return typeof value === "number" ? value >>> 0 : 0;
}

function memberHash<T>(value: T): number {
  const raw = referenceHash(value);
  const base = raw !== 0 ? raw : valueFallbackHash(value);
  const h = Math.imul(base, 0x9e3779b1),
    unmasked = (h ^ (h >>> 16)) >>> 0;
  return unmasked === removedHash ? 0 : unmasked;
}

function readMemberAt<T>(
  members: T[],
  index: number,
  undefinedMember: StoredUndefined<T> | undefined,
): T {
  const value = members[index];
  if (value !== undefined) return value;
  if (undefinedMember !== undefined) return undefinedMember.value;
  throw "SET_MEMBER_INVARIANT";
}

function sameValueSlow<T>(
  members: T[],
  entry: number,
  value: T,
  undefMember: StoredUndefined<T> | undefined,
): boolean {
  const existing = readMemberAt<T>(members, entry, undefMember);
  return existing === value || (existing !== existing && value !== value);
}

function syncFast<T>(set: CompactSet<T>): void {
  if (set.fastLimit > 0) {
    set.used = set.length;
    set.order = set.baseOrder + set.length;
  }
}

export function createSet<T>(): CompactSet<T> {
  return {
    members: undefined,
    hashes: undefined,
    slots: undefined,
    orders: undefined,
    undefinedMember: undefined,
    length: 0,
    size: 0,
    used: 0,
    baseOrder: 0,
    order: 0,
    compactions: 0,
    fastLimit: 0,
    hashEpoch: gcEpoch(),
  };
}

/** Recompute address-based hashes and open-addressed slots in place (zero
 * allocations) after a moving GC cycle. */
function rehashInPlace<T>(set: CompactSet<T>): void {
  const slots = set.slots,
    members = set.members,
    hashes = set.hashes,
    length = set.length;
  const epoch = gcEpoch();
  if (
    slots === undefined ||
    members === undefined ||
    hashes === undefined ||
    length === 0
  ) {
    set.hashEpoch = epoch;
    return;
  }
  const capacity = slots.length;
  if (capacity < 1 || capacity > maximumSlots) throw "set rehash invariant";
  slots.fill(0);
  const mask = capacity - 1,
    undefMember = set.undefinedMember;
  let used = 0;
  for (let entry = 0; entry < length; entry++) {
    if (hashes[entry] === removedHash) continue;
    const mixed = memberHash<T>(readMemberAt<T>(members, entry, undefMember));
    hashes[entry] = mixed;
    let at = mixed & mask;
    while (slots[at] !== 0) at = (at + 1) & mask;
    slots[at] = entry + 1;
    used++;
  }
  set.used = used;
  set.hashEpoch = epoch;
}

/** Rebuild the probe table to `capacity` slots (power of two >= 16).
 * Without deletions, members stay in place and only `hashes` and `slots` grow. */
function rebuild<T>(set: CompactSet<T>, capacity: number): void {
  syncFast<T>(set);
  if (capacity > maximumSlots) throw "SET_CAPACITY_LIMIT";
  const oldMembers = set.members,
    oldHashes = set.hashes,
    oldOrders = set.orders,
    length = set.length,
    nextCapacity = capacity >>> 1,
    nextHashes = new Uint32Array(nextCapacity),
    nextSlots = new Uint32Array(capacity),
    mask = capacity - 1,
    undefMember = set.undefinedMember;
  if (oldMembers === undefined || oldHashes === undefined || length === 0) {
    set.members = [];
    set.hashes = nextHashes;
    set.slots = nextSlots;
    set.orders = undefined;
    set.length = 0;
    set.used = 0;
    set.fastLimit =
      set.baseOrder + nextCapacity <= maxSafeOrder ? nextCapacity : 0;
    set.hashEpoch = gcEpoch();
    return;
  }
  let rehash = false;
  for (let entry = 0; entry < length; entry++) {
    if (oldHashes[entry] !== removedHash) {
      rehash = usesAddressHash(readMemberAt<T>(oldMembers, entry, undefMember));
      break;
    }
  }
  if (set.size === length) {
    const epoch = rehash ? gcEpoch() : set.hashEpoch;
    if (rehash) {
      for (let entry = 0; entry < length; entry++) {
        const mixed = memberHash<T>(
          readMemberAt<T>(oldMembers, entry, undefMember),
        );
        nextHashes[entry] = mixed;
        let at = mixed & mask;
        while (nextSlots[at] !== 0) at = (at + 1) & mask;
        nextSlots[at] = entry + 1;
      }
    } else {
      nextHashes.set(oldHashes);
      for (let entry = 0; entry < length; entry++) {
        let at = (oldHashes[entry] ?? 0) & mask;
        while (nextSlots[at] !== 0) at = (at + 1) & mask;
        nextSlots[at] = entry + 1;
      }
    }
    if (oldOrders !== undefined) {
      const nextOrders = new Float64Array(nextCapacity);
      nextOrders.set(oldOrders);
      set.orders = nextOrders;
    }
    set.hashes = nextHashes;
    set.slots = nextSlots;
    set.used = length;
    set.fastLimit =
      oldOrders === undefined && set.baseOrder + nextCapacity <= maxSafeOrder
        ? nextCapacity
        : 0;
    set.hashEpoch = epoch;
    return;
  }
  const nextMembers: T[] = [],
    nextOrders = new Float64Array(nextCapacity),
    baseOrder = set.baseOrder;
  const epoch = rehash ? gcEpoch() : set.hashEpoch;
  let write = 0;
  for (let entry = 0; entry < length; entry++) {
    const entryHash = oldHashes[entry] ?? removedHash;
    if (entryHash === removedHash) continue;
    const v = readMemberAt<T>(oldMembers, entry, undefMember),
      ord =
        oldOrders === undefined
          ? baseOrder + entry + 1
          : (oldOrders[entry] ?? 0);
    const mixed = rehash ? memberHash<T>(v) : entryHash;
    let at = mixed & mask;
    while (nextSlots[at] !== 0) at = (at + 1) & mask;
    nextMembers.push(v);
    nextHashes[write] = mixed;
    nextOrders[write] = ord;
    write++;
    nextSlots[at] = write;
  }
  set.members = nextMembers;
  set.hashes = nextHashes;
  set.slots = nextSlots;
  set.orders = nextOrders;
  set.length = write;
  set.used = write;
  set.compactions = set.compactions + 1;
  set.fastLimit = 0;
  set.hashEpoch = epoch;
}

export function hasSet<T>(set: CompactSet<T>, value: T): boolean {
  if (usesAddressHash(value) && set.hashEpoch !== gcEpoch())
    rehashInPlace<T>(set);
  const slots = set.slots,
    members = set.members,
    hashes = set.hashes;
  if (slots === undefined || members === undefined || hashes === undefined)
    return false;
  const capacity = slots.length;
  if (capacity < 1 || capacity > maximumSlots) return false;
  const raw = referenceHash(value),
    base = raw !== 0 ? raw : valueFallbackHash(value),
    h = Math.imul(base, 0x9e3779b1),
    unmasked = (h ^ (h >>> 16)) >>> 0,
    mixed = unmasked === removedHash ? 0 : unmasked;
  const mask = capacity - 1,
    undefMember = set.undefinedMember;
  let at = mixed & mask;
  while (true) {
    const probe = slots[at] ?? 0;
    if (probe === 0) return false;
    if (probe !== deletedSlot) {
      const entry = probe - 1;
      if (hashes[entry] === mixed) {
        const existing = members[entry];
        if (
          (existing !== undefined
            ? existing === value
            : undefMember !== undefined && value === undefined) ||
          (value !== value &&
            sameValueSlow<T>(members, entry, value, undefMember))
        )
          return true;
      }
    }
    at = (at + 1) & mask;
  }
}

function addSetSlow<T>(
  set: CompactSet<T>,
  value: T,
  hash: number,
  target: number,
  isAddr: boolean,
): boolean {
  syncFast<T>(set);
  if (set.order >= maxSafeOrder) throw "SET_ORDER_LIMIT";
  const existingSlots = set.slots,
    existingMembers = set.members,
    existingHashes = set.hashes;
  let slot = target,
    insertHash = hash;
  if (
    existingSlots === undefined ||
    existingMembers === undefined ||
    existingHashes === undefined
  ) {
    const cap = initialSlots >>> 1;
    set.members = [];
    set.hashes = new Uint32Array(cap);
    set.slots = new Uint32Array(initialSlots);
    set.fastLimit = set.baseOrder + cap <= maxSafeOrder ? cap : 0;
    if (isAddr) {
      const epoch = gcEpoch();
      if (set.hashEpoch !== epoch) {
        set.hashEpoch = epoch;
        insertHash = memberHash<T>(value);
      }
    }
    slot = insertHash & (initialSlots - 1);
  } else if (
    (set.used + 1) * 2 > existingSlots.length ||
    set.length >= existingHashes.length
  ) {
    const nextCapacity =
      set.size * 4 >= existingSlots.length
        ? existingSlots.length * 2
        : existingSlots.length;
    rebuild<T>(set, nextCapacity);
    const rebuiltSlots = set.slots;
    if (rebuiltSlots === undefined) throw "set rebuild invariant";
    const capacity = rebuiltSlots.length;
    if (capacity < 1 || capacity > maximumSlots) throw "set rebuild invariant";
    if (isAddr) insertHash = memberHash<T>(value);
    const mask = capacity - 1;
    slot = insertHash & mask;
    while (rebuiltSlots[slot] !== 0) slot = (slot + 1) & mask;
  }
  const slots = set.slots,
    members = set.members,
    hashes = set.hashes;
  if (slots === undefined || members === undefined || hashes === undefined)
    throw "set storage invariant";
  if (value === undefined && set.undefinedMember === undefined)
    set.undefinedMember = { value };
  const order = set.order + 1,
    entry = set.length;
  if (slots[slot] === 0) set.used = set.used + 1;
  members.push(value);
  hashes[entry] = insertHash;
  const orders = set.orders;
  if (orders !== undefined) orders[entry] = order;
  slots[slot] = entry + 1;
  set.length = entry + 1;
  set.size = set.size + 1;
  set.order = order;
  if (isAddr && set.hashEpoch !== gcEpoch()) rehashInPlace<T>(set);
  return true;
}

/** Return whether a new member was added. Duplicate insertion does not allocate. */
export function addSet<T>(set: CompactSet<T>, value: T): boolean {
  const isAddr = usesAddressHash(value);
  if (isAddr && set.hashEpoch !== gcEpoch()) rehashInPlace<T>(set);
  const raw = referenceHash(value),
    base = raw !== 0 ? raw : valueFallbackHash(value),
    h = Math.imul(base, 0x9e3779b1),
    unmasked = (h ^ (h >>> 16)) >>> 0,
    mixed = unmasked === removedHash ? 0 : unmasked;
  const slots = set.slots,
    members = set.members,
    hashes = set.hashes;
  if (slots !== undefined && members !== undefined && hashes !== undefined) {
    const capacity = slots.length;
    if (capacity < 1 || capacity > maximumSlots) throw "set capacity invariant";
    const mask = capacity - 1,
      undefMember = set.undefinedMember;
    let at = mixed & mask,
      deletedAt = -1;
    while (true) {
      const probe = slots[at] ?? 0;
      if (probe === 0) {
        const entry = set.length >>> 0;
        if (
          deletedAt < 0 &&
          entry < set.fastLimit &&
          entry < hashes.length &&
          value !== undefined
        ) {
          const next = entry + 1;
          members.push(value);
          hashes[entry] = mixed;
          slots[at] = next;
          set.length = next;
          set.size = next;
          if (isAddr && set.hashEpoch !== gcEpoch()) rehashInPlace<T>(set);
          return true;
        }
        return addSetSlow<T>(
          set,
          value,
          mixed,
          deletedAt < 0 ? at : deletedAt,
          isAddr,
        );
      }
      if (probe === deletedSlot) {
        if (deletedAt < 0) deletedAt = at;
      } else {
        const entry = probe - 1;
        if (hashes[entry] === mixed) {
          const existing = members[entry];
          if (
            (existing !== undefined
              ? existing === value
              : undefMember !== undefined && value === undefined) ||
            (value !== value &&
              sameValueSlow<T>(members, entry, value, undefMember))
          )
            return false;
        }
      }
      at = (at + 1) & mask;
    }
  }
  return addSetSlow<T>(set, value, mixed, -1, isAddr);
}

/** Copy the live insertion sequence in linear time. Links and order counters are
 * independent; member values retain their identity. The source is not mutated. */
export function cloneSet<T>(source: CompactSet<T>): CompactSet<T> {
  const result = createSet<T>();
  const srcMembers = source.members,
    srcHashes = source.hashes,
    srcLength = source.length,
    srcSize = source.size;
  if (
    srcMembers === undefined ||
    srcHashes === undefined ||
    srcSize === 0 ||
    srcLength === 0
  )
    return result;
  let capacity = initialSlots;
  while (capacity < srcSize * 2) capacity *= 2;
  if (capacity > maximumSlots) throw "SET_CAPACITY_LIMIT";
  const nextCapacity = capacity >>> 1,
    nextMembers: T[] = [],
    nextHashes = new Uint32Array(nextCapacity),
    nextSlots = new Uint32Array(capacity),
    mask = capacity - 1,
    undefMember = source.undefinedMember;
  let rehash = false;
  for (let i = 0; i < srcLength; i++) {
    if (srcHashes[i] !== removedHash) {
      rehash = usesAddressHash(readMemberAt<T>(srcMembers, i, undefMember));
      break;
    }
  }
  const epoch = rehash ? gcEpoch() : result.hashEpoch;
  let write = 0;
  for (let i = 0; i < srcLength; i++) {
    const h = srcHashes[i] ?? removedHash;
    if (h === removedHash) continue;
    const v = readMemberAt<T>(srcMembers, i, undefMember);
    const mixed = rehash ? memberHash<T>(v) : h;
    let at = mixed & mask;
    while (nextSlots[at] !== 0) at = (at + 1) & mask;
    nextMembers.push(v);
    nextHashes[write] = mixed;
    write++;
    nextSlots[at] = write;
  }
  result.members = nextMembers;
  result.hashes = nextHashes;
  result.slots = nextSlots;
  result.undefinedMember = undefMember;
  result.length = write;
  result.size = write;
  result.used = write;
  result.order = write;
  result.fastLimit = nextCapacity <= maxSafeOrder ? nextCapacity : 0;
  result.hashEpoch = epoch;
  if (rehash && result.hashEpoch !== gcEpoch()) rehashInPlace<T>(result);
  return result;
}

export function deleteSet<T>(set: CompactSet<T>, value: T): boolean {
  if (usesAddressHash(value) && set.hashEpoch !== gcEpoch())
    rehashInPlace<T>(set);
  const slots = set.slots,
    members = set.members,
    hashes = set.hashes;
  if (slots === undefined || members === undefined || hashes === undefined)
    return false;
  const capacity = slots.length;
  if (capacity < 1 || capacity > maximumSlots) return false;
  const raw = referenceHash(value),
    base = raw !== 0 ? raw : valueFallbackHash(value),
    h = Math.imul(base, 0x9e3779b1),
    unmasked = (h ^ (h >>> 16)) >>> 0,
    mixed = unmasked === removedHash ? 0 : unmasked;
  const mask = capacity - 1,
    undefMember = set.undefinedMember;
  let at = mixed & mask;
  while (true) {
    const probe = slots[at] ?? 0;
    if (probe === 0) return false;
    if (probe !== deletedSlot) {
      const entry = probe - 1;
      if (hashes[entry] === mixed) {
        const existing = members[entry];
        if (
          (existing !== undefined
            ? existing === value
            : undefMember !== undefined && value === undefined) ||
          (value !== value &&
            sameValueSlow<T>(members, entry, value, undefMember))
        ) {
          syncFast<T>(set);
          set.fastLimit = 0;
          slots[at] = deletedSlot;
          hashes[entry] = removedHash;
          set.size = set.size - 1;
          if (set.size === 0) {
            clearSet<T>(set);
          } else if (set.size * 4 < set.length && set.length > initialSlots) {
            let nextCapacity = initialSlots;
            while (nextCapacity < set.size * 4) nextCapacity *= 2;
            rebuild<T>(set, nextCapacity);
          }
          return true;
        }
      }
    }
    at = (at + 1) & mask;
  }
}

export function clearSet<T>(set: CompactSet<T>): void {
  syncFast<T>(set);
  set.members = undefined;
  set.hashes = undefined;
  set.slots = undefined;
  set.orders = undefined;
  set.length = 0;
  set.size = 0;
  set.used = 0;
  set.baseOrder = set.order;
  set.compactions = set.compactions + 1;
  set.fastLimit = 0;
  set.hashEpoch = gcEpoch();
}

export function sizeSet<T>(set: CompactSet<T>): number {
  return set.size;
}

/** Cursor state is private to these operations; exhaustion releases the set. */
export interface CompactSetCursor<T> {
  set: CompactSet<T> | undefined;
  index: number;
  after: number;
  compactions: number;
  hasCurrent: boolean;
  currentValue: T | undefined;
  undefinedMember: StoredUndefined<T> | undefined;
}

export function createSetCursor<T>(set: CompactSet<T>): CompactSetCursor<T> {
  return {
    set,
    index: 0,
    after: 0,
    compactions: set.compactions,
    hasCurrent: false,
    currentValue: undefined,
    undefinedMember: undefined,
  };
}

export function advanceSetCursor<T>(cursor: CompactSetCursor<T>): boolean {
  const set = cursor.set;
  cursor.hasCurrent = false;
  cursor.currentValue = undefined;
  cursor.undefinedMember = undefined;
  if (set === undefined) return false;
  const length = set.length,
    members = set.members,
    hashes = set.hashes;
  if (members === undefined || hashes === undefined || length === 0) {
    cursor.set = undefined;
    return false;
  }
  const orders = set.orders,
    baseOrder = set.baseOrder;
  let index = cursor.index;
  if (cursor.compactions !== set.compactions) {
    index = 0;
    while (index < length) {
      if (hashes[index] !== removedHash) {
        const ord =
          orders === undefined ? baseOrder + index + 1 : (orders[index] ?? 0);
        if (ord > cursor.after) break;
      }
      index++;
    }
    cursor.compactions = set.compactions;
  } else {
    while (index < length && hashes[index] === removedHash) index++;
  }
  if (index >= length) {
    cursor.set = undefined;
    return false;
  }
  cursor.currentValue = members[index];
  cursor.undefinedMember = set.undefinedMember;
  cursor.hasCurrent = true;
  cursor.after =
    orders === undefined ? baseOrder + index + 1 : (orders[index] ?? 0);
  cursor.index = index + 1;
  return true;
}

export function readSetCursor<T>(cursor: CompactSetCursor<T>): T {
  if (!cursor.hasCurrent) throw "SET_CURSOR_NOT_POSITIONED";
  const value = cursor.currentValue;
  if (value !== undefined) return value;
  const undef = cursor.undefinedMember;
  if (undef !== undefined) return undef.value;
  throw "SET_CURSOR_VALUE_INVARIANT";
}
