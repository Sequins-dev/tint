// Compact insertion-ordered open-addressed hash set specialized for number
// keys: members live in a dense Float64Array in insertion order, and the
// open-addressed Uint32Array `slots` maps probe positions to `entry + 1`
// (0 empty, 0xffffffff deleted). Zero per-entry heap records, zero pointer
// chasing, and SameValueZero semantics (-0 normalized to +0, NaN === NaN).
export interface NumberKeySet {
  /** Dense insertion-order members; allocated lazily on first insertion. */
  members: Float64Array | undefined;
  /** Open-addressed table: 0 empty, 0xffffffff deleted, entry + 1 live. */
  slots: Uint32Array | undefined;
  /** Allocated lazily on first deletion: 1 marks a deleted entry. */
  deleted: Uint8Array | undefined;
  /** Allocated lazily only when compaction shifts indices after deletions. */
  orders: Float64Array | undefined;
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
  /** Nonzero (equals members.length) iff dense append-only fast inserts are valid. */
  fastLimit: number;
}

const initialSlots = 8;
const deletedSlot = 0xffffffff;
const maximumSlots = 0x40000000;
const maxSafeOrder = 9007199254740991;

/** Mixes a number key for power-of-two open addressing. SameValueZero folds
 * -0 to +0 (both take the uint32 fast path with low = 0) and NaN to 0. */
function hashNumber(key: number): number {
  const low = key >>> 0;
  let mixed = low;
  if (key !== low) {
    const high =
      key !== key ? 0 : Math.floor(key * 2.3283064365386963e-10) >>> 0;
    mixed = (low ^ Math.imul(high, 0x9e3779b1)) >>> 0;
  }
  const h = Math.imul(mixed, 0x9e3779b1);
  return (h ^ (h >>> 16)) >>> 0;
}

function syncFast(set: NumberKeySet): void {
  if (set.fastLimit > 0) {
    set.used = set.length;
    set.order = set.baseOrder + set.length;
  }
}

export function createSet(): NumberKeySet {
  return {
    members: undefined,
    slots: undefined,
    deleted: undefined,
    orders: undefined,
    length: 0,
    size: 0,
    used: 0,
    baseOrder: 0,
    order: 0,
    compactions: 0,
    fastLimit: 0,
  };
}

/** Rebuild the probe table to `capacity` slots (power of two >= 16).
 * Without deletions, members are bulk-copied and indices do not shift. */
function rebuild(set: NumberKeySet, capacity: number): void {
  syncFast(set);
  if (capacity > maximumSlots) throw "SET_CAPACITY_LIMIT";
  const oldMembers = set.members,
    oldDeleted = set.deleted,
    oldOrders = set.orders,
    length = set.length,
    nextCapacity = capacity >>> 1,
    nextMembers = new Float64Array(nextCapacity),
    nextSlots = new Uint32Array(capacity),
    mask = capacity - 1;
  if (oldMembers === undefined || length === 0) {
    set.members = nextMembers;
    set.slots = nextSlots;
    set.deleted = undefined;
    set.orders = undefined;
    set.length = 0;
    set.used = 0;
    set.fastLimit =
      set.baseOrder + nextCapacity <= maxSafeOrder ? nextCapacity : 0;
    return;
  }
  if (oldDeleted === undefined) {
    nextMembers.set(oldMembers);
    if (oldOrders !== undefined) {
      const nextOrders = new Float64Array(nextCapacity);
      nextOrders.set(oldOrders);
      set.orders = nextOrders;
    }
    for (let entry = 0; entry < length; entry++) {
      let at = hashNumber(oldMembers[entry] ?? 0) & mask;
      while (nextSlots[at] !== 0) at = (at + 1) & mask;
      nextSlots[at] = entry + 1;
    }
    set.members = nextMembers;
    set.slots = nextSlots;
    set.used = length;
    set.fastLimit =
      oldOrders === undefined && set.baseOrder + nextCapacity <= maxSafeOrder
        ? nextCapacity
        : 0;
    return;
  }
  const nextOrders = new Float64Array(nextCapacity),
    baseOrder = set.baseOrder;
  let write = 0;
  for (let entry = 0; entry < length; entry++) {
    if (oldDeleted[entry] === 1) continue;
    const key = oldMembers[entry] ?? 0,
      ord =
        oldOrders === undefined
          ? baseOrder + entry + 1
          : (oldOrders[entry] ?? 0);
    let at = hashNumber(key) & mask;
    while (nextSlots[at] !== 0) at = (at + 1) & mask;
    nextMembers[write] = key;
    nextOrders[write] = ord;
    write++;
    nextSlots[at] = write;
  }
  set.members = nextMembers;
  set.slots = nextSlots;
  set.deleted = undefined;
  set.orders = nextOrders;
  set.length = write;
  set.used = write;
  set.compactions = set.compactions + 1;
  set.fastLimit = 0;
}

export function hasSet(set: NumberKeySet, value: number): boolean {
  const slots = set.slots,
    members = set.members;
  if (slots === undefined || members === undefined) return false;
  const capacity = slots.length;
  if (capacity < 1 || capacity > maximumSlots) return false;
  const mask = capacity - 1;
  let at = hashNumber(value) & mask;
  while (true) {
    const probe = slots[at] ?? 0;
    if (probe === 0) return false;
    if (probe !== deletedSlot) {
      const entry = probe - 1;
      if (entry < members.length) {
        const candidate = members[entry] ?? 0;
        if (candidate === value || (value !== value && candidate !== candidate))
          return true;
      }
    }
    at = (at + 1) & mask;
  }
}

/** Slow insertion path: initial allocation, growth/compaction, tombstone reuse,
 * or post-compaction order tracking. */
function addSetSlow(
  set: NumberKeySet,
  value: number,
  hash: number,
  target: number,
): boolean {
  syncFast(set);
  if (set.order >= maxSafeOrder) throw "SET_ORDER_LIMIT";
  const existingSlots = set.slots,
    existingMembers = set.members;
  let slot = target;
  if (existingSlots === undefined || existingMembers === undefined) {
    const cap = initialSlots >>> 1;
    set.members = new Float64Array(cap);
    set.slots = new Uint32Array(initialSlots);
    set.fastLimit = set.baseOrder + cap <= maxSafeOrder ? cap : 0;
    slot = hash & (initialSlots - 1);
  } else if (
    (set.used + 1) * 2 > existingSlots.length ||
    set.length >= existingMembers.length
  ) {
    const nextCapacity =
      set.size * 4 >= existingSlots.length
        ? existingSlots.length * 2
        : existingSlots.length;
    rebuild(set, nextCapacity);
    const rebuiltSlots = set.slots;
    if (rebuiltSlots === undefined) throw "set rebuild invariant";
    const capacity = rebuiltSlots.length;
    if (capacity < 1 || capacity > maximumSlots) throw "set rebuild invariant";
    const mask = capacity - 1;
    slot = hash & mask;
    while (rebuiltSlots[slot] !== 0) slot = (slot + 1) & mask;
  }
  const slots = set.slots,
    members = set.members;
  if (slots === undefined || members === undefined)
    throw "set storage invariant";
  const order = set.order + 1,
    entry = set.length,
    stored = value === 0 ? 0 : value;
  if (slots[slot] === 0) set.used = set.used + 1;
  members[entry] = stored;
  const orders = set.orders;
  if (orders !== undefined) orders[entry] = order;
  slots[slot] = entry + 1;
  set.length = entry + 1;
  set.size = set.size + 1;
  set.order = order;
  return true;
}

/** Return whether a new member was added. Duplicate insertion does not allocate. */
export function addSet(set: NumberKeySet, value: number): boolean {
  const slots = set.slots,
    members = set.members,
    hash = hashNumber(value);
  if (slots !== undefined && members !== undefined) {
    const capacity = slots.length;
    if (capacity < 1 || capacity > maximumSlots) throw "set storage invariant";
    const mask = capacity - 1;
    let at = hash & mask,
      deletedAt = -1;
    while (true) {
      const probe = slots[at] ?? 0;
      if (probe === 0) {
        const entry = set.length >>> 0;
        if (entry < set.fastLimit && entry < members.length) {
          const next = entry + 1;
          members[entry] = value === 0 ? 0 : value;
          slots[at] = next;
          set.length = next;
          set.size = next;
          return true;
        }
        return addSetSlow(set, value, hash, deletedAt < 0 ? at : deletedAt);
      }
      if (probe === deletedSlot) {
        if (deletedAt < 0) deletedAt = at;
      } else {
        const entry = probe - 1;
        if (entry < members.length) {
          const candidate = members[entry] ?? 0;
          if (
            candidate === value ||
            (value !== value && candidate !== candidate)
          )
            return false;
        }
      }
      at = (at + 1) & mask;
    }
  }
  return addSetSlow(set, value, hash, -1);
}

export function deleteSet(set: NumberKeySet, value: number): boolean {
  const slots = set.slots,
    members = set.members;
  if (slots === undefined || members === undefined) return false;
  const capacity = slots.length;
  if (capacity < 1 || capacity > maximumSlots) return false;
  const mask = capacity - 1;
  let at = hashNumber(value) & mask;
  while (true) {
    const probe = slots[at] ?? 0;
    if (probe === 0) return false;
    if (probe !== deletedSlot) {
      const entry = probe - 1;
      if (entry < members.length) {
        const candidate = members[entry] ?? 0;
        if (
          candidate === value ||
          (value !== value && candidate !== candidate)
        ) {
          syncFast(set);
          set.fastLimit = 0;
          slots[at] = deletedSlot;
          const existingDeleted = set.deleted;
          const deleted =
            existingDeleted !== undefined
              ? existingDeleted
              : new Uint8Array(members.length);
          if (existingDeleted === undefined) set.deleted = deleted;
          deleted[entry] = 1;
          set.size = set.size - 1;
          if (set.size * 4 < set.length && set.length > initialSlots) {
            let capacity = initialSlots;
            while (capacity < set.size * 4) capacity *= 2;
            rebuild(set, capacity);
          }
          return true;
        }
      }
    }
    at = (at + 1) & mask;
  }
}

export function clearSet(set: NumberKeySet): void {
  syncFast(set);
  set.members = undefined;
  set.slots = undefined;
  set.deleted = undefined;
  set.orders = undefined;
  set.length = 0;
  set.size = 0;
  set.used = 0;
  set.baseOrder = set.order;
  set.compactions = set.compactions + 1;
  set.fastLimit = 0;
}

export function sizeSet(set: NumberKeySet): number {
  return set.size;
}

/** Copy the live insertion sequence in linear time. */
export function cloneSet(source: NumberKeySet): NumberKeySet {
  const result = createSet(),
    members = source.members,
    deleted = source.deleted,
    length = source.length;
  if (members === undefined || source.size === 0) return result;
  let capacity = initialSlots;
  while (capacity < source.size * 2) capacity *= 2;
  const nextMembers = new Float64Array(capacity >>> 1),
    nextSlots = new Uint32Array(capacity),
    mask = capacity - 1;
  let write = 0;
  for (let entry = 0; entry < length; entry++) {
    if (deleted !== undefined && deleted[entry] === 1) continue;
    const key = members[entry] ?? 0;
    let at = hashNumber(key) & mask;
    while (nextSlots[at] !== 0) at = (at + 1) & mask;
    nextMembers[write] = key;
    write++;
    nextSlots[at] = write;
  }
  result.members = nextMembers;
  result.slots = nextSlots;
  result.length = write;
  result.size = write;
  result.used = write;
  result.order = write;
  result.fastLimit = capacity >>> 1;
  return result;
}

/** Live insertion-order cursor; exhaustion releases the set permanently. */
export interface NumberSetCursor {
  set: NumberKeySet | undefined;
  index: number;
  after: number;
  compactions: number;
  current: number;
}

export function createSetCursor(set: NumberKeySet): NumberSetCursor {
  return {
    set,
    index: 0,
    after: 0,
    compactions: set.compactions,
    current: 0,
  };
}

function findNextSetEntry(
  set: NumberKeySet,
  index: number,
  after: number,
  compactions: number,
): number {
  const length = set.length,
    deleted = set.deleted;
  if (compactions !== set.compactions) {
    const orders = set.orders,
      baseOrder = set.baseOrder;
    let at = 0;
    while (at < length) {
      if (deleted === undefined || deleted[at] !== 1) {
        const ord =
          orders === undefined ? baseOrder + at + 1 : (orders[at] ?? 0);
        if (ord > after) break;
      }
      at++;
    }
    return at;
  }
  if (deleted !== undefined)
    while (index < length && deleted[index] === 1) index++;
  return index;
}

function setEntryOrder(set: NumberKeySet, index: number): number {
  const orders = set.orders;
  return orders === undefined
    ? set.baseOrder + index + 1
    : (orders[index] ?? 0);
}

export function advanceSetCursor(cursor: NumberSetCursor): boolean {
  const set = cursor.set;
  if (set === undefined) return false;
  let index = cursor.index;
  const compactions = set.compactions,
    cursorCompactions = cursor.compactions;
  if (set.fastLimit === 0 || cursorCompactions !== compactions) {
    index = findNextSetEntry(set, index, cursor.after, cursorCompactions);
    cursor.compactions = compactions;
  }
  const members = set.members;
  if (members === undefined || index >= set.length) {
    cursor.set = undefined;
    return false;
  }
  cursor.current = members[index] ?? 0;
  cursor.after = setEntryOrder(set, index);
  cursor.index = index + 1;
  return true;
}

export function readSetCursor(cursor: NumberSetCursor): number {
  if (cursor.set === undefined || cursor.index === 0)
    throw "SET_CURSOR_NOT_POSITIONED";
  return cursor.current;
}
