// Compact insertion-ordered open-addressed hash map specialized for
// Map<number, number>: keys and values live in parallel Float64Arrays, and the
// open-addressed Uint32Array `slots` maps probe positions to `entry + 1`
// (0 empty, 0xffffffff deleted). Zero per-entry heap records, zero NumberList
// indirection, and SameValueZero key semantics (-0 normalized to +0, NaN === NaN).
export interface NumberNumberMap {
  /** Dense insertion-order keys; allocated lazily on first insertion. */
  numKeys: Float64Array | undefined;
  /** Parallel insertion-order numeric values. */
  numValues: Float64Array | undefined;
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
  /** Nonzero (equals numKeys.length) iff dense append-only fast inserts are valid. */
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

function syncFast(map: NumberNumberMap): void {
  if (map.fastLimit > 0) {
    map.used = map.length;
    map.order = map.baseOrder + map.length;
  }
}

export function createMap(): NumberNumberMap {
  return {
    numKeys: undefined,
    numValues: undefined,
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
 * Without deletions, keys and values are bulk-copied and indices do not shift. */
function rebuild(map: NumberNumberMap, capacity: number): void {
  syncFast(map);
  if (capacity > maximumSlots) throw "MAP_CAPACITY_LIMIT";
  const oldKeys = map.numKeys,
    oldValues = map.numValues,
    oldDeleted = map.deleted,
    oldOrders = map.orders,
    length = map.length,
    nextCapacity = capacity >>> 1,
    nextKeys = new Float64Array(nextCapacity),
    nextValues = new Float64Array(nextCapacity),
    nextSlots = new Uint32Array(capacity),
    mask = capacity - 1;
  if (oldKeys === undefined || oldValues === undefined || length === 0) {
    map.numKeys = nextKeys;
    map.numValues = nextValues;
    map.slots = nextSlots;
    map.deleted = undefined;
    map.orders = undefined;
    map.length = 0;
    map.used = 0;
    map.fastLimit =
      map.baseOrder + nextCapacity <= maxSafeOrder ? nextCapacity : 0;
    return;
  }
  if (oldDeleted === undefined) {
    nextKeys.set(oldKeys);
    nextValues.set(oldValues);
    if (oldOrders !== undefined) {
      const nextOrders = new Float64Array(nextCapacity);
      nextOrders.set(oldOrders);
      map.orders = nextOrders;
    }
    for (let entry = 0; entry < length; entry++) {
      let at = hashNumber(oldKeys[entry] ?? 0) & mask;
      while (nextSlots[at] !== 0) at = (at + 1) & mask;
      nextSlots[at] = entry + 1;
    }
    map.numKeys = nextKeys;
    map.numValues = nextValues;
    map.slots = nextSlots;
    map.used = length;
    map.fastLimit =
      oldOrders === undefined && map.baseOrder + nextCapacity <= maxSafeOrder
        ? nextCapacity
        : 0;
    return;
  }
  const nextOrders = new Float64Array(nextCapacity),
    baseOrder = map.baseOrder;
  let write = 0;
  for (let entry = 0; entry < length; entry++) {
    if (oldDeleted[entry] === 1) continue;
    const key = oldKeys[entry] ?? 0,
      val = oldValues[entry] ?? 0,
      ord =
        oldOrders === undefined
          ? baseOrder + entry + 1
          : (oldOrders[entry] ?? 0);
    let at = hashNumber(key) & mask;
    while (nextSlots[at] !== 0) at = (at + 1) & mask;
    nextKeys[write] = key;
    nextValues[write] = val;
    nextOrders[write] = ord;
    write++;
    nextSlots[at] = write;
  }
  map.numKeys = nextKeys;
  map.numValues = nextValues;
  map.slots = nextSlots;
  map.deleted = undefined;
  map.orders = nextOrders;
  map.length = write;
  map.used = write;
  map.compactions = map.compactions + 1;
  map.fastLimit = 0;
}

export function hasMap(map: NumberNumberMap, key: number): boolean {
  const slots = map.slots,
    keys = map.numKeys;
  if (slots === undefined || keys === undefined) return false;
  const capacity = slots.length;
  if (capacity < 1 || capacity > maximumSlots) return false;
  const mask = capacity - 1;
  let at = hashNumber(key) & mask;
  while (true) {
    const probe = slots[at] ?? 0;
    if (probe === 0) return false;
    if (probe !== deletedSlot) {
      const entry = probe - 1;
      if (entry < keys.length) {
        const candidate = keys[entry] ?? 0;
        if (candidate === key || (key !== key && candidate !== candidate))
          return true;
      }
    }
    at = (at + 1) & mask;
  }
}

export function getMap(map: NumberNumberMap, key: number): number | undefined {
  const slots = map.slots,
    keys = map.numKeys,
    values = map.numValues;
  if (slots === undefined || keys === undefined || values === undefined)
    return undefined;
  const capacity = slots.length;
  if (capacity < 1 || capacity > maximumSlots) return undefined;
  const mask = capacity - 1;
  let at = hashNumber(key) & mask;
  while (true) {
    const probe = slots[at] ?? 0;
    if (probe === 0) return undefined;
    if (probe !== deletedSlot) {
      const entry = probe - 1;
      if (entry < keys.length) {
        const candidate = keys[entry] ?? 0;
        if (candidate === key || (key !== key && candidate !== candidate))
          return values[entry];
      }
    }
    at = (at + 1) & mask;
  }
}

/** Slow insertion path: initial allocation, growth/compaction, tombstone reuse,
 * or post-compaction order tracking. */
function setMapSlow(
  map: NumberNumberMap,
  key: number,
  value: number,
  hash: number,
  target: number,
): boolean {
  syncFast(map);
  if (map.order >= maxSafeOrder) throw "MAP_ORDER_LIMIT";
  const existingSlots = map.slots,
    existingKeys = map.numKeys,
    existingValues = map.numValues;
  let slot = target;
  if (
    existingSlots === undefined ||
    existingKeys === undefined ||
    existingValues === undefined
  ) {
    const cap = initialSlots >>> 1;
    map.numKeys = new Float64Array(cap);
    map.numValues = new Float64Array(cap);
    map.slots = new Uint32Array(initialSlots);
    map.fastLimit = map.baseOrder + cap <= maxSafeOrder ? cap : 0;
    slot = hash & (initialSlots - 1);
  } else if (
    (map.used + 1) * 2 > existingSlots.length ||
    map.length >= existingKeys.length
  ) {
    const nextCapacity =
      map.size * 4 >= existingSlots.length
        ? existingSlots.length * 2
        : existingSlots.length;
    rebuild(map, nextCapacity);
    const rebuiltSlots = map.slots;
    if (rebuiltSlots === undefined) throw "map rebuild invariant";
    const capacity = rebuiltSlots.length;
    if (capacity < 1 || capacity > maximumSlots) throw "map rebuild invariant";
    const mask = capacity - 1;
    slot = hash & mask;
    while (rebuiltSlots[slot] !== 0) slot = (slot + 1) & mask;
  }
  const slots = map.slots,
    keys = map.numKeys,
    values = map.numValues;
  if (slots === undefined || keys === undefined || values === undefined)
    throw "map storage invariant";
  const order = map.order + 1,
    entry = map.length,
    stored = key === 0 ? 0 : key;
  if (slots[slot] === 0) map.used = map.used + 1;
  keys[entry] = stored;
  values[entry] = value;
  const orders = map.orders;
  if (orders !== undefined) orders[entry] = order;
  slots[slot] = entry + 1;
  map.length = entry + 1;
  map.size = map.size + 1;
  map.order = order;
  return true;
}

/** Return true for insertion; updating an existing value does not allocate. */
export function setMap(
  map: NumberNumberMap,
  key: number,
  value: number,
): boolean {
  const slots = map.slots,
    keys = map.numKeys,
    values = map.numValues,
    hash = hashNumber(key);
  if (slots !== undefined && keys !== undefined && values !== undefined) {
    const capacity = slots.length;
    if (capacity < 1 || capacity > maximumSlots) throw "map storage invariant";
    const mask = capacity - 1;
    let at = hash & mask,
      deletedAt = -1;
    while (true) {
      const probe = slots[at] ?? 0;
      if (probe === 0) {
        const entry = map.length >>> 0;
        if (
          entry < map.fastLimit &&
          entry < keys.length &&
          entry < values.length
        ) {
          const next = entry + 1;
          keys[entry] = key === 0 ? 0 : key;
          values[entry] = value;
          slots[at] = next;
          map.length = next;
          map.size = next;
          return true;
        }
        return setMapSlow(
          map,
          key,
          value,
          hash,
          deletedAt < 0 ? at : deletedAt,
        );
      }
      if (probe === deletedSlot) {
        if (deletedAt < 0) deletedAt = at;
      } else {
        const entry = probe - 1;
        if (entry < keys.length) {
          const candidate = keys[entry] ?? 0;
          if (candidate === key || (key !== key && candidate !== candidate)) {
            if (entry < values.length) values[entry] = value;
            return false;
          }
        }
      }
      at = (at + 1) & mask;
    }
  }
  return setMapSlow(map, key, value, hash, -1);
}

export function deleteMap(map: NumberNumberMap, key: number): boolean {
  const slots = map.slots,
    keys = map.numKeys;
  if (slots === undefined || keys === undefined) return false;
  const capacity = slots.length;
  if (capacity < 1 || capacity > maximumSlots) return false;
  const mask = capacity - 1;
  let at = hashNumber(key) & mask;
  while (true) {
    const probe = slots[at] ?? 0;
    if (probe === 0) return false;
    if (probe !== deletedSlot) {
      const entry = probe - 1;
      if (entry < keys.length) {
        const candidate = keys[entry] ?? 0;
        if (candidate === key || (key !== key && candidate !== candidate)) {
          syncFast(map);
          map.fastLimit = 0;
          slots[at] = deletedSlot;
          const existingDeleted = map.deleted;
          const deleted =
            existingDeleted !== undefined
              ? existingDeleted
              : new Uint8Array(keys.length);
          if (existingDeleted === undefined) map.deleted = deleted;
          deleted[entry] = 1;
          map.size = map.size - 1;
          if (map.size * 4 < map.length && map.length > initialSlots) {
            let capacity = initialSlots;
            while (capacity < map.size * 4) capacity *= 2;
            rebuild(map, capacity);
          }
          return true;
        }
      }
    }
    at = (at + 1) & mask;
  }
}

export function clearMap(map: NumberNumberMap): void {
  syncFast(map);
  map.numKeys = undefined;
  map.numValues = undefined;
  map.slots = undefined;
  map.deleted = undefined;
  map.orders = undefined;
  map.length = 0;
  map.size = 0;
  map.used = 0;
  map.baseOrder = map.order;
  map.compactions = map.compactions + 1;
  map.fastLimit = 0;
}

export function sizeMap(map: NumberNumberMap): number {
  return map.size;
}

/** Live insertion-order cursor; exhaustion releases the map permanently. */
export interface NumberNumberMapCursor {
  map: NumberNumberMap | undefined;
  index: number;
  after: number;
  compactions: number;
  hasCurrent: boolean;
  currentKey: number;
  currentValue: number;
}

export function createMapCursor(map: NumberNumberMap): NumberNumberMapCursor {
  return {
    map,
    index: 0,
    after: 0,
    compactions: map.compactions,
    hasCurrent: false,
    currentKey: 0,
    currentValue: 0,
  };
}

export function advanceMapCursor(cursor: NumberNumberMapCursor): boolean {
  const map = cursor.map;
  cursor.hasCurrent = false;
  if (map === undefined) return false;
  const length = map.length,
    keys = map.numKeys,
    values = map.numValues;
  if (keys === undefined || values === undefined || length === 0) {
    cursor.map = undefined;
    return false;
  }
  const deleted = map.deleted,
    orders = map.orders,
    baseOrder = map.baseOrder;
  let index = cursor.index;
  if (cursor.compactions !== map.compactions) {
    index = 0;
    while (index < length) {
      if (deleted === undefined || deleted[index] !== 1) {
        const ord =
          orders === undefined ? baseOrder + index + 1 : (orders[index] ?? 0);
        if (ord > cursor.after) break;
      }
      index++;
    }
    cursor.compactions = map.compactions;
  } else {
    while (index < length && deleted !== undefined && deleted[index] === 1)
      index++;
  }
  if (index >= length) {
    cursor.map = undefined;
    return false;
  }
  cursor.currentKey = keys[index] ?? 0;
  cursor.currentValue = values[index] ?? 0;
  cursor.hasCurrent = true;
  cursor.after =
    orders === undefined ? baseOrder + index + 1 : (orders[index] ?? 0);
  cursor.index = index + 1;
  return true;
}

export function readMapCursorKey(cursor: NumberNumberMapCursor): number {
  if (!cursor.hasCurrent) throw "MAP_CURSOR_NOT_POSITIONED";
  return cursor.currentKey;
}

export function readMapCursorValue(cursor: NumberNumberMapCursor): number {
  if (!cursor.hasCurrent) throw "MAP_CURSOR_NOT_POSITIONED";
  return cursor.currentValue;
}
