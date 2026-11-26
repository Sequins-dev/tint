// Compact insertion-ordered open-addressed hash map specialized for number
// keys: keys live in a dense Float64Array, values live in a parallel V[]
// (a Float64Array-backed NumberList when V is number), and the open-addressed
// Uint32Array `slots` maps probe positions to `entry + 1` (0 empty,
// 0xffffffff deleted). Zero per-entry heap records, zero pointer chasing,
// and SameValueZero semantics (-0 normalized to +0, NaN === NaN).
interface StoredUndefined<V> {
  readonly value: V;
}

export interface NumberKeyMap<V> {
  /** Dense insertion-order keys; allocated lazily on first insertion. */
  keys: Float64Array | undefined;
  /** Parallel insertion-order values; length always equals `length`. */
  values: V[] | undefined;
  /** Open-addressed table: 0 empty, 0xffffffff deleted, entry + 1 live. */
  slots: Uint32Array | undefined;
  /** Allocated lazily on first deletion: 1 marks a deleted entry. */
  deleted: Uint8Array | undefined;
  /** Allocated lazily only when compaction shifts indices after deletions. */
  orders: Float64Array | undefined;
  /** Captured only when V admits undefined and undefined has been stored. */
  undefinedValue: StoredUndefined<V> | undefined;
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
}

const initialSlots = 8;
const deletedSlot = 0xffffffff;
const maximumSlots = 0x40000000;

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
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

export function createMap<V>(): NumberKeyMap<V> {
  return {
    keys: undefined,
    values: undefined,
    slots: undefined,
    deleted: undefined,
    orders: undefined,
    undefinedValue: undefined,
    length: 0,
    size: 0,
    used: 0,
    baseOrder: 0,
    order: 0,
    compactions: 0,
  };
}

function readValueAt<V>(
  values: V[],
  index: number,
  undefinedValue: StoredUndefined<V> | undefined,
): V {
  const value = values[index];
  if (value !== undefined) return value;
  if (undefinedValue !== undefined) return undefinedValue.value;
  throw "MAP_VALUE_INVARIANT";
}

/** Rebuild the probe table to `capacity` slots (power of two >= 16).
 * Without deletions, keys are bulk-copied and values stay in place. */
function rebuild<V>(map: NumberKeyMap<V>, capacity: number): void {
  if (capacity > maximumSlots) throw "MAP_CAPACITY_LIMIT";
  const oldKeys = map.keys,
    oldValues = map.values,
    oldDeleted = map.deleted,
    oldOrders = map.orders,
    length = map.length,
    nextCapacity = capacity >>> 1,
    nextKeys = new Float64Array(nextCapacity),
    nextSlots = new Uint32Array(capacity),
    mask = capacity - 1;
  if (oldKeys === undefined || oldValues === undefined || length === 0) {
    map.keys = nextKeys;
    map.values = [];
    map.slots = nextSlots;
    map.deleted = undefined;
    map.orders = undefined;
    map.length = 0;
    map.used = 0;
    return;
  }
  if (oldDeleted === undefined) {
    nextKeys.set(oldKeys);
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
    map.keys = nextKeys;
    map.slots = nextSlots;
    map.used = length;
    return;
  }
  const nextValues: V[] = [],
    nextOrders = new Float64Array(nextCapacity),
    baseOrder = map.baseOrder,
    undefinedValue = map.undefinedValue;
  let write = 0;
  for (let entry = 0; entry < length; entry++) {
    if (oldDeleted[entry] === 1) continue;
    const key = oldKeys[entry] ?? 0,
      ord =
        oldOrders === undefined
          ? baseOrder + entry + 1
          : (oldOrders[entry] ?? 0);
    let at = hashNumber(key) & mask;
    while (nextSlots[at] !== 0) at = (at + 1) & mask;
    nextKeys[write] = key;
    nextValues.push(readValueAt<V>(oldValues, entry, undefinedValue));
    nextOrders[write] = ord;
    write++;
    nextSlots[at] = write;
  }
  map.keys = nextKeys;
  map.values = nextValues;
  map.slots = nextSlots;
  map.deleted = undefined;
  map.orders = nextOrders;
  map.length = write;
  map.used = write;
  map.compactions = map.compactions + 1;
}

export function hasMap<V>(map: NumberKeyMap<V>, key: number): boolean {
  const slots = map.slots,
    keys = map.keys;
  if (slots === undefined || keys === undefined) return false;
  const capacity = slots.length;
  if (capacity < 1 || capacity > maximumSlots) return false;
  const mask = capacity - 1;
  let at = hashNumber(key) & mask;
  while (true) {
    const probe = slots[at] ?? 0;
    if (probe === 0) return false;
    if (probe !== deletedSlot) {
      const candidate = keys[probe - 1] ?? 0;
      if (candidate === key || (key !== key && candidate !== candidate))
        return true;
    }
    at = (at + 1) & mask;
  }
}

export function getMap<V>(map: NumberKeyMap<V>, key: number): V | undefined {
  const slots = map.slots,
    keys = map.keys,
    values = map.values;
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
      const entry = probe - 1,
        candidate = keys[entry] ?? 0;
      if (candidate === key || (key !== key && candidate !== candidate))
        return values[entry];
    }
    at = (at + 1) & mask;
  }
}

/** Return true for insertion; updating an existing value does not allocate. */
export function setMap<V>(
  map: NumberKeyMap<V>,
  key: number,
  value: V,
): boolean {
  const existingSlots = map.slots,
    existingKeys = map.keys,
    existingValues = map.values,
    hash = hashNumber(key);
  let target = -1;
  if (
    existingSlots !== undefined &&
    existingKeys !== undefined &&
    existingValues !== undefined
  ) {
    const capacity = existingSlots.length;
    if (capacity < 1 || capacity > maximumSlots) throw "map storage invariant";
    const mask = capacity - 1;
    let at = hash & mask,
      deletedAt = -1;
    while (true) {
      const probe = existingSlots[at] ?? 0;
      if (probe === 0) {
        target = deletedAt < 0 ? at : deletedAt;
        break;
      }
      if (probe === deletedSlot) {
        if (deletedAt < 0) deletedAt = at;
      } else {
        const entry = probe - 1,
          candidate = existingKeys[entry] ?? 0;
        if (candidate === key || (key !== key && candidate !== candidate)) {
          if (value === undefined && map.undefinedValue === undefined)
            map.undefinedValue = { value };
          existingValues[entry] = value;
          return false;
        }
      }
      at = (at + 1) & mask;
    }
  }
  if (map.order >= 9007199254740991) throw "MAP_ORDER_LIMIT";
  if (
    existingSlots === undefined ||
    existingKeys === undefined ||
    existingValues === undefined
  ) {
    map.keys = new Float64Array(initialSlots >>> 1);
    map.values = [];
    map.slots = new Uint32Array(initialSlots);
    target = hash & (initialSlots - 1);
  } else if (
    (map.used + 1) * 2 > existingSlots.length ||
    map.length >= existingKeys.length
  ) {
    const nextCapacity =
      map.size * 4 >= existingSlots.length
        ? existingSlots.length * 2
        : existingSlots.length;
    rebuild<V>(map, nextCapacity);
    const rebuiltSlots = map.slots;
    if (rebuiltSlots === undefined) throw "map rebuild invariant";
    const capacity = rebuiltSlots.length;
    if (capacity < 1 || capacity > maximumSlots) throw "map rebuild invariant";
    const mask = capacity - 1;
    target = hash & mask;
    while (rebuiltSlots[target] !== 0) target = (target + 1) & mask;
  }
  const slots = map.slots,
    keys = map.keys,
    values = map.values;
  if (slots === undefined || keys === undefined || values === undefined)
    throw "map storage invariant";
  if (value === undefined && map.undefinedValue === undefined)
    map.undefinedValue = { value };
  const order = map.order + 1,
    entry = map.length,
    stored = key === 0 ? 0 : key;
  if (slots[target] === 0) map.used = map.used + 1;
  keys[entry] = stored;
  values.push(value);
  const orders = map.orders;
  if (orders !== undefined) orders[entry] = order;
  slots[target] = entry + 1;
  map.length = entry + 1;
  map.size = map.size + 1;
  map.order = order;
  return true;
}

export function deleteMap<V>(map: NumberKeyMap<V>, key: number): boolean {
  const slots = map.slots,
    keys = map.keys;
  if (slots === undefined || keys === undefined) return false;
  const capacity = slots.length;
  if (capacity < 1 || capacity > maximumSlots) return false;
  const mask = capacity - 1;
  let at = hashNumber(key) & mask;
  while (true) {
    const probe = slots[at] ?? 0;
    if (probe === 0) return false;
    if (probe !== deletedSlot) {
      const entry = probe - 1,
        candidate = keys[entry] ?? 0;
      if (candidate === key || (key !== key && candidate !== candidate)) {
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
          rebuild<V>(map, capacity);
        }
        return true;
      }
    }
    at = (at + 1) & mask;
  }
}

export function clearMap<V>(map: NumberKeyMap<V>): void {
  map.keys = undefined;
  map.values = undefined;
  map.slots = undefined;
  map.deleted = undefined;
  map.orders = undefined;
  map.length = 0;
  map.size = 0;
  map.used = 0;
  map.baseOrder = map.order;
  map.compactions = map.compactions + 1;
}

export function sizeMap<V>(map: NumberKeyMap<V>): number {
  return map.size;
}

/** Live insertion-order cursor; exhaustion releases the map permanently. */
export interface NumberMapCursor<V> {
  map: NumberKeyMap<V> | undefined;
  index: number;
  after: number;
  compactions: number;
  hasCurrent: boolean;
  currentKey: number;
  currentValue: V | undefined;
  undefinedValue: StoredUndefined<V> | undefined;
}

export function createMapCursor<V>(map: NumberKeyMap<V>): NumberMapCursor<V> {
  return {
    map,
    index: 0,
    after: 0,
    compactions: map.compactions,
    hasCurrent: false,
    currentKey: 0,
    currentValue: undefined,
    undefinedValue: undefined,
  };
}

export function advanceMapCursor<V>(cursor: NumberMapCursor<V>): boolean {
  const map = cursor.map;
  cursor.hasCurrent = false;
  cursor.currentValue = undefined;
  cursor.undefinedValue = undefined;
  if (map === undefined) return false;
  const length = map.length,
    keys = map.keys,
    values = map.values;
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
  cursor.currentValue = values[index];
  cursor.undefinedValue = map.undefinedValue;
  cursor.hasCurrent = true;
  cursor.after =
    orders === undefined ? baseOrder + index + 1 : (orders[index] ?? 0);
  cursor.index = index + 1;
  return true;
}

export function readMapCursorKey<V>(cursor: NumberMapCursor<V>): number {
  if (!cursor.hasCurrent) throw "MAP_CURSOR_NOT_POSITIONED";
  return cursor.currentKey;
}

export function readMapCursorValue<V>(cursor: NumberMapCursor<V>): V {
  if (!cursor.hasCurrent) throw "MAP_CURSOR_NOT_POSITIONED";
  const value = cursor.currentValue;
  if (value !== undefined) return value;
  const undef = cursor.undefinedValue;
  if (undef !== undefined) return undef.value;
  throw "MAP_CURSOR_VALUE_INVARIANT";
}
