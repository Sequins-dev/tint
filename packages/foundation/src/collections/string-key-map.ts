import { hashString } from "./key-index.ts";

// Compact insertion-ordered open-addressed hash map specialized for string
// keys: keys live in a dense string[], values in a parallel V[], stored mixed
// hashes in a Uint32Array (0xffffffff marks a deleted entry), and `slots` maps
// probe positions to `entry + 1` (0 empty, 0xffffffff deleted). Zero per-entry
// heap records and zero pointer chasing.
interface StoredUndefined<V> {
  readonly value: V;
}

export interface StringKeyMap<V> {
  /** Dense insertion-order keys; allocated lazily on first insertion. */
  keys: string[] | undefined;
  /** Parallel insertion-order values; length always equals `length`. */
  values: V[] | undefined;
  /** Mixed hashes per entry; `removedHash` marks a deleted entry. */
  hashes: Uint32Array | undefined;
  /** Open-addressed table: 0 empty, 0xffffffff deleted, entry + 1 live. */
  slots: Uint32Array | undefined;
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
const removedHash = 0xffffffff;
const deletedSlot = 0xffffffff;
const maximumSlots = 0x40000000;

/** Mixes a string's UTF-16 hash for power-of-two open addressing, reserving
 * `removedHash` as the deletion marker. */
function hashKey(key: string): number {
  const raw = hashString(key),
    mixed = Math.imul(raw ^ (raw >>> 16), 0x45d9f3b),
    value = (mixed ^ (mixed >>> 16)) >>> 0;
  return value === removedHash ? 0 : value;
}

export function createMap<V>(): StringKeyMap<V> {
  return {
    keys: undefined,
    values: undefined,
    hashes: undefined,
    slots: undefined,
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
 * Without deletions, keys and values stay in place and only `hashes` and
 * `slots` grow. */
function rebuild<V>(map: StringKeyMap<V>, capacity: number): void {
  if (capacity > maximumSlots) throw "MAP_CAPACITY_LIMIT";
  const oldKeys = map.keys,
    oldValues = map.values,
    oldHashes = map.hashes,
    oldOrders = map.orders,
    length = map.length,
    nextCapacity = capacity >>> 1,
    nextHashes = new Uint32Array(nextCapacity),
    nextSlots = new Uint32Array(capacity),
    mask = capacity - 1;
  if (
    oldKeys === undefined ||
    oldValues === undefined ||
    oldHashes === undefined ||
    length === 0
  ) {
    map.keys = [];
    map.values = [];
    map.hashes = nextHashes;
    map.slots = nextSlots;
    map.orders = undefined;
    map.length = 0;
    map.used = 0;
    return;
  }
  if (map.size === length) {
    nextHashes.set(oldHashes);
    if (oldOrders !== undefined) {
      const nextOrders = new Float64Array(nextCapacity);
      nextOrders.set(oldOrders);
      map.orders = nextOrders;
    }
    for (let entry = 0; entry < length; entry++) {
      let at = (oldHashes[entry] ?? 0) & mask;
      while (nextSlots[at] !== 0) at = (at + 1) & mask;
      nextSlots[at] = entry + 1;
    }
    map.hashes = nextHashes;
    map.slots = nextSlots;
    map.used = length;
    return;
  }
  const nextKeys: string[] = [],
    nextValues: V[] = [],
    nextOrders = new Float64Array(nextCapacity),
    baseOrder = map.baseOrder,
    undefinedValue = map.undefinedValue;
  let write = 0;
  for (let entry = 0; entry < length; entry++) {
    const entryHash = oldHashes[entry] ?? removedHash;
    if (entryHash === removedHash) continue;
    const key = oldKeys[entry];
    if (key === undefined) throw "map key invariant";
    const ord =
      oldOrders === undefined ? baseOrder + entry + 1 : (oldOrders[entry] ?? 0);
    let at = entryHash & mask;
    while (nextSlots[at] !== 0) at = (at + 1) & mask;
    nextKeys.push(key);
    nextValues.push(readValueAt<V>(oldValues, entry, undefinedValue));
    nextHashes[write] = entryHash;
    nextOrders[write] = ord;
    write++;
    nextSlots[at] = write;
  }
  map.keys = nextKeys;
  map.values = nextValues;
  map.hashes = nextHashes;
  map.slots = nextSlots;
  map.orders = nextOrders;
  map.length = write;
  map.used = write;
  map.compactions = map.compactions + 1;
}

export function hasMap<V>(map: StringKeyMap<V>, key: string): boolean {
  const slots = map.slots,
    keys = map.keys,
    hashes = map.hashes;
  if (slots === undefined || keys === undefined || hashes === undefined)
    return false;
  const capacity = slots.length;
  if (capacity < 1 || capacity > maximumSlots) return false;
  const hash = hashKey(key),
    mask = capacity - 1;
  let at = hash & mask;
  while (true) {
    const probe = slots[at] ?? 0;
    if (probe === 0) return false;
    if (probe !== deletedSlot) {
      const entry = probe - 1;
      if (hashes[entry] === hash && keys[entry] === key) return true;
    }
    at = (at + 1) & mask;
  }
}

export function getMap<V>(map: StringKeyMap<V>, key: string): V | undefined {
  const slots = map.slots,
    keys = map.keys,
    values = map.values,
    hashes = map.hashes;
  if (
    slots === undefined ||
    keys === undefined ||
    values === undefined ||
    hashes === undefined
  )
    return undefined;
  const capacity = slots.length;
  if (capacity < 1 || capacity > maximumSlots) return undefined;
  const hash = hashKey(key),
    mask = capacity - 1;
  let at = hash & mask;
  while (true) {
    const probe = slots[at] ?? 0;
    if (probe === 0) return undefined;
    if (probe !== deletedSlot) {
      const entry = probe - 1;
      if (hashes[entry] === hash && keys[entry] === key) return values[entry];
    }
    at = (at + 1) & mask;
  }
}

/** Return true for insertion; updating an existing value does not allocate. */
export function setMap<V>(
  map: StringKeyMap<V>,
  key: string,
  value: V,
): boolean {
  const existingSlots = map.slots,
    existingKeys = map.keys,
    existingValues = map.values,
    existingHashes = map.hashes;
  const hash = hashKey(key);
  let target = -1;
  if (
    existingSlots !== undefined &&
    existingKeys !== undefined &&
    existingValues !== undefined &&
    existingHashes !== undefined
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
        const entry = probe - 1;
        if (existingHashes[entry] === hash && existingKeys[entry] === key) {
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
    existingValues === undefined ||
    existingHashes === undefined
  ) {
    map.keys = [];
    map.values = [];
    map.hashes = new Uint32Array(initialSlots >>> 1);
    map.slots = new Uint32Array(initialSlots);
    target = hash & (initialSlots - 1);
  } else if (
    (map.used + 1) * 2 > existingSlots.length ||
    map.length >= existingHashes.length
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
    values = map.values,
    hashes = map.hashes;
  if (
    slots === undefined ||
    keys === undefined ||
    values === undefined ||
    hashes === undefined
  )
    throw "map storage invariant";
  if (value === undefined && map.undefinedValue === undefined)
    map.undefinedValue = { value };
  const order = map.order + 1,
    entry = map.length;
  if (slots[target] === 0) map.used = map.used + 1;
  keys.push(key);
  values.push(value);
  hashes[entry] = hash;
  const orders = map.orders;
  if (orders !== undefined) orders[entry] = order;
  slots[target] = entry + 1;
  map.length = entry + 1;
  map.size = map.size + 1;
  map.order = order;
  return true;
}

export function deleteMap<V>(map: StringKeyMap<V>, key: string): boolean {
  const slots = map.slots,
    keys = map.keys,
    hashes = map.hashes;
  if (slots === undefined || keys === undefined || hashes === undefined)
    return false;
  const capacity = slots.length;
  if (capacity < 1 || capacity > maximumSlots) return false;
  const hash = hashKey(key),
    mask = capacity - 1;
  let at = hash & mask;
  while (true) {
    const probe = slots[at] ?? 0;
    if (probe === 0) return false;
    if (probe !== deletedSlot) {
      const entry = probe - 1;
      if (hashes[entry] === hash && keys[entry] === key) {
        slots[at] = deletedSlot;
        hashes[entry] = removedHash;
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

export function clearMap<V>(map: StringKeyMap<V>): void {
  map.keys = undefined;
  map.values = undefined;
  map.hashes = undefined;
  map.slots = undefined;
  map.orders = undefined;
  map.length = 0;
  map.size = 0;
  map.used = 0;
  map.baseOrder = map.order;
  map.compactions = map.compactions + 1;
}

export function sizeMap<V>(map: StringKeyMap<V>): number {
  return map.size;
}

/** Live insertion-order cursor; exhaustion releases the map permanently. */
export interface StringMapCursor<V> {
  map: StringKeyMap<V> | undefined;
  index: number;
  after: number;
  compactions: number;
  hasCurrent: boolean;
  currentKey: string;
  currentValue: V | undefined;
  undefinedValue: StoredUndefined<V> | undefined;
}

export function createMapCursor<V>(map: StringKeyMap<V>): StringMapCursor<V> {
  return {
    map,
    index: 0,
    after: 0,
    compactions: map.compactions,
    hasCurrent: false,
    currentKey: "",
    currentValue: undefined,
    undefinedValue: undefined,
  };
}

export function advanceMapCursor<V>(cursor: StringMapCursor<V>): boolean {
  const map = cursor.map;
  cursor.hasCurrent = false;
  cursor.currentValue = undefined;
  cursor.undefinedValue = undefined;
  if (map === undefined) return false;
  const length = map.length,
    keys = map.keys,
    values = map.values,
    hashes = map.hashes;
  if (
    keys === undefined ||
    values === undefined ||
    hashes === undefined ||
    length === 0
  ) {
    cursor.map = undefined;
    return false;
  }
  const orders = map.orders,
    baseOrder = map.baseOrder;
  let index = cursor.index;
  if (cursor.compactions !== map.compactions) {
    index = 0;
    while (index < length) {
      if (hashes[index] !== removedHash) {
        const ord =
          orders === undefined ? baseOrder + index + 1 : (orders[index] ?? 0);
        if (ord > cursor.after) break;
      }
      index++;
    }
    cursor.compactions = map.compactions;
  } else {
    while (index < length && hashes[index] === removedHash) index++;
  }
  if (index >= length) {
    cursor.map = undefined;
    return false;
  }
  const key = keys[index];
  if (key === undefined) throw "map cursor key invariant";
  cursor.currentKey = key;
  cursor.currentValue = values[index];
  cursor.undefinedValue = map.undefinedValue;
  cursor.hasCurrent = true;
  cursor.after =
    orders === undefined ? baseOrder + index + 1 : (orders[index] ?? 0);
  cursor.index = index + 1;
  return true;
}

export function readMapCursorKey<V>(cursor: StringMapCursor<V>): string {
  if (!cursor.hasCurrent) throw "MAP_CURSOR_NOT_POSITIONED";
  return cursor.currentKey;
}

export function readMapCursorValue<V>(cursor: StringMapCursor<V>): V {
  if (!cursor.hasCurrent) throw "MAP_CURSOR_NOT_POSITIONED";
  const value = cursor.currentValue;
  if (value !== undefined) return value;
  const undef = cursor.undefinedValue;
  if (undef !== undefined) return undef.value;
  throw "MAP_CURSOR_VALUE_INVARIANT";
}
