import {
  gcEpoch,
  hashString,
  referenceHash,
  usesAddressHash,
} from "./key-index.ts";
export { gcEpoch, referenceHash, usesAddressHash } from "./key-index.ts";

// Compact insertion-ordered open-addressed hash map for general keys and values
// whose types fit parallel lists (objects, bigints, unions, unknown): keys and
// values live in dense parallel insertion-order lists (`entryKeys`,
// `entryValues`), mixed hashes live in a `Uint32Array` (`removedHash` marks
// deleted entries), and `slots` maps open-addressed probe positions to
// `entry + 1` (0 empty, `deletedSlot` tombstone). Zero per-entry heap records
// and zero pointer chasing; managed reference keys rehash in place when
// `gcEpoch()` advances.
interface StoredUndefined<T> {
  readonly value: T;
}

export interface CompactMap<K, V> {
  /** Dense insertion-order keys; allocated lazily on first insertion. */
  entryKeys: K[] | undefined;
  /** Parallel insertion-order values; length always equals `length`. */
  entryValues: V[] | undefined;
  /** Mixed hashes per entry; `removedHash` marks a deleted entry. */
  hashes: Uint32Array | undefined;
  /** Open-addressed table: 0 empty, 0xffffffff deleted, entry + 1 live. */
  slots: Uint32Array | undefined;
  /** Allocated lazily only when compaction shifts indices after deletions. */
  orders: Float64Array | undefined;
  /** Captured only when K admits undefined and undefined has been stored. */
  undefinedKey: StoredUndefined<K> | undefined;
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

/** String and number keys reach the type tests through unknown. */
function primitiveFallbackHash(key: unknown): number {
  if (typeof key === "string") return hashString(key);
  if (typeof key === "number") return key >>> 0;
  return 0;
}

function keyHash<K>(key: K): number {
  const raw = referenceHash(key);
  const base = raw !== 0 ? raw : primitiveFallbackHash(key);
  const h = Math.imul(base, 0x9e3779b1),
    unmasked = (h ^ (h >>> 16)) >>> 0;
  return unmasked === removedHash ? 0 : unmasked;
}

function readKeyAt<K>(
  keys: K[],
  index: number,
  undefinedKey: StoredUndefined<K> | undefined,
): K {
  const key = keys[index];
  if (key !== undefined) return key;
  if (undefinedKey !== undefined) return undefinedKey.value;
  throw "MAP_KEY_INVARIANT";
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

function sameKeySlow<K>(
  keys: K[],
  entry: number,
  key: K,
  undefKey: StoredUndefined<K> | undefined,
): boolean {
  const existing = readKeyAt<K>(keys, entry, undefKey);
  return existing === key || (existing !== existing && key !== key);
}

function syncFast<K, V>(map: CompactMap<K, V>): void {
  if (map.fastLimit > 0) {
    map.used = map.length;
    map.order = map.baseOrder + map.length;
  }
}

export function createMap<K, V>(): CompactMap<K, V> {
  return {
    entryKeys: undefined,
    entryValues: undefined,
    hashes: undefined,
    slots: undefined,
    orders: undefined,
    undefinedKey: undefined,
    undefinedValue: undefined,
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
function rehashInPlace<K, V>(map: CompactMap<K, V>): void {
  const slots = map.slots,
    keys = map.entryKeys,
    hashes = map.hashes,
    length = map.length;
  const epoch = gcEpoch();
  if (
    slots === undefined ||
    keys === undefined ||
    hashes === undefined ||
    length === 0
  ) {
    map.hashEpoch = epoch;
    return;
  }
  const capacity = slots.length;
  if (capacity < 1 || capacity > maximumSlots) throw "map rehash invariant";
  slots.fill(0);
  const mask = capacity - 1,
    undefKey = map.undefinedKey;
  let used = 0;
  for (let entry = 0; entry < length; entry++) {
    if (hashes[entry] === removedHash) continue;
    const mixed = keyHash<K>(readKeyAt<K>(keys, entry, undefKey));
    hashes[entry] = mixed;
    let at = mixed & mask;
    while (slots[at] !== 0) at = (at + 1) & mask;
    slots[at] = entry + 1;
    used++;
  }
  map.used = used;
  map.hashEpoch = epoch;
}

/** Rebuild the probe table to `capacity` slots (power of two >= 16).
 * Without deletions, keys and values stay in place and only `hashes` and
 * `slots` grow. */
function rebuild<K, V>(map: CompactMap<K, V>, capacity: number): void {
  syncFast<K, V>(map);
  if (capacity > maximumSlots) throw "MAP_CAPACITY_LIMIT";
  const oldKeys = map.entryKeys,
    oldValues = map.entryValues,
    oldHashes = map.hashes,
    oldOrders = map.orders,
    length = map.length,
    nextCapacity = capacity >>> 1,
    nextHashes = new Uint32Array(nextCapacity),
    nextSlots = new Uint32Array(capacity),
    mask = capacity - 1,
    undefKey = map.undefinedKey,
    undefVal = map.undefinedValue;
  if (
    oldKeys === undefined ||
    oldValues === undefined ||
    oldHashes === undefined ||
    length === 0
  ) {
    map.entryKeys = [];
    map.entryValues = [];
    map.hashes = nextHashes;
    map.slots = nextSlots;
    map.orders = undefined;
    map.length = 0;
    map.used = 0;
    map.fastLimit =
      map.baseOrder + nextCapacity <= maxSafeOrder ? nextCapacity : 0;
    map.hashEpoch = gcEpoch();
    return;
  }
  let rehash = false;
  for (let entry = 0; entry < length; entry++) {
    if (oldHashes[entry] !== removedHash) {
      rehash = usesAddressHash(readKeyAt<K>(oldKeys, entry, undefKey));
      break;
    }
  }
  if (map.size === length) {
    const epoch = rehash ? gcEpoch() : map.hashEpoch;
    if (rehash) {
      for (let entry = 0; entry < length; entry++) {
        const mixed = keyHash<K>(readKeyAt<K>(oldKeys, entry, undefKey));
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
      map.orders = nextOrders;
    }
    map.hashes = nextHashes;
    map.slots = nextSlots;
    map.used = length;
    map.fastLimit =
      oldOrders === undefined && map.baseOrder + nextCapacity <= maxSafeOrder
        ? nextCapacity
        : 0;
    map.hashEpoch = epoch;
    return;
  }
  const nextKeys: K[] = [],
    nextValues: V[] = [],
    nextOrders = new Float64Array(nextCapacity),
    baseOrder = map.baseOrder;
  const epoch = rehash ? gcEpoch() : map.hashEpoch;
  let write = 0;
  for (let entry = 0; entry < length; entry++) {
    const entryHash = oldHashes[entry] ?? removedHash;
    if (entryHash === removedHash) continue;
    const k = readKeyAt<K>(oldKeys, entry, undefKey),
      v = readValueAt<V>(oldValues, entry, undefVal),
      ord =
        oldOrders === undefined
          ? baseOrder + entry + 1
          : (oldOrders[entry] ?? 0);
    const mixed = rehash ? keyHash<K>(k) : entryHash;
    let at = mixed & mask;
    while (nextSlots[at] !== 0) at = (at + 1) & mask;
    nextKeys.push(k);
    nextValues.push(v);
    nextHashes[write] = mixed;
    nextOrders[write] = ord;
    write++;
    nextSlots[at] = write;
  }
  map.entryKeys = nextKeys;
  map.entryValues = nextValues;
  map.hashes = nextHashes;
  map.slots = nextSlots;
  map.orders = nextOrders;
  map.length = write;
  map.used = write;
  map.compactions = map.compactions + 1;
  map.fastLimit = 0;
  map.hashEpoch = epoch;
}

export function hasMap<K, V>(map: CompactMap<K, V>, key: K): boolean {
  if (usesAddressHash(key) && map.hashEpoch !== gcEpoch())
    rehashInPlace<K, V>(map);
  const slots = map.slots,
    keys = map.entryKeys,
    hashes = map.hashes;
  if (slots === undefined || keys === undefined || hashes === undefined)
    return false;
  const capacity = slots.length;
  if (capacity < 1 || capacity > maximumSlots) return false;
  const raw = referenceHash(key),
    base = raw !== 0 ? raw : primitiveFallbackHash(key),
    h = Math.imul(base, 0x9e3779b1),
    unmasked = (h ^ (h >>> 16)) >>> 0,
    mixed = unmasked === removedHash ? 0 : unmasked;
  const mask = capacity - 1,
    undefKey = map.undefinedKey;
  let at = mixed & mask;
  while (true) {
    const probe = slots[at] ?? 0;
    if (probe === 0) return false;
    if (probe !== deletedSlot) {
      const entry = probe - 1;
      if (hashes[entry] === mixed) {
        const existing = keys[entry];
        if (
          (existing !== undefined
            ? existing === key
            : undefKey !== undefined && key === undefined) ||
          (key !== key && sameKeySlow<K>(keys, entry, key, undefKey))
        )
          return true;
      }
    }
    at = (at + 1) & mask;
  }
}

export function getMap<K, V>(map: CompactMap<K, V>, key: K): V | undefined {
  if (usesAddressHash(key) && map.hashEpoch !== gcEpoch())
    rehashInPlace<K, V>(map);
  const slots = map.slots,
    keys = map.entryKeys,
    values = map.entryValues,
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
  const raw = referenceHash(key),
    base = raw !== 0 ? raw : primitiveFallbackHash(key),
    h = Math.imul(base, 0x9e3779b1),
    unmasked = (h ^ (h >>> 16)) >>> 0,
    mixed = unmasked === removedHash ? 0 : unmasked;
  const mask = capacity - 1,
    undefKey = map.undefinedKey;
  let at = mixed & mask;
  while (true) {
    const probe = slots[at] ?? 0;
    if (probe === 0) return undefined;
    if (probe !== deletedSlot) {
      const entry = probe - 1;
      if (hashes[entry] === mixed) {
        const existing = keys[entry];
        if (
          (existing !== undefined
            ? existing === key
            : undefKey !== undefined && key === undefined) ||
          (key !== key && sameKeySlow<K>(keys, entry, key, undefKey))
        )
          return readValueAt<V>(values, entry, map.undefinedValue);
      }
    }
    at = (at + 1) & mask;
  }
}

function setMapSlow<K, V>(
  map: CompactMap<K, V>,
  key: K,
  value: V,
  hash: number,
  target: number,
  isAddr: boolean,
): boolean {
  syncFast<K, V>(map);
  if (map.order >= maxSafeOrder) throw "MAP_ORDER_LIMIT";
  const existingSlots = map.slots,
    existingKeys = map.entryKeys,
    existingValues = map.entryValues,
    existingHashes = map.hashes;
  let slot = target,
    insertHash = hash;
  if (
    existingSlots === undefined ||
    existingKeys === undefined ||
    existingValues === undefined ||
    existingHashes === undefined
  ) {
    const cap = initialSlots >>> 1;
    map.entryKeys = [];
    map.entryValues = [];
    map.hashes = new Uint32Array(cap);
    map.slots = new Uint32Array(initialSlots);
    map.fastLimit = map.baseOrder + cap <= maxSafeOrder ? cap : 0;
    if (isAddr) {
      const epoch = gcEpoch();
      if (map.hashEpoch !== epoch) {
        map.hashEpoch = epoch;
        insertHash = keyHash<K>(key);
      }
    }
    slot = insertHash & (initialSlots - 1);
  } else if (
    (map.used + 1) * 2 > existingSlots.length ||
    map.length >= existingHashes.length
  ) {
    const nextCapacity =
      map.size * 4 >= existingSlots.length
        ? existingSlots.length * 2
        : existingSlots.length;
    rebuild<K, V>(map, nextCapacity);
    const rebuiltSlots = map.slots;
    if (rebuiltSlots === undefined) throw "map rebuild invariant";
    const capacity = rebuiltSlots.length;
    if (capacity < 1 || capacity > maximumSlots) throw "map rebuild invariant";
    if (isAddr) insertHash = keyHash<K>(key);
    const mask = capacity - 1;
    slot = insertHash & mask;
    while (rebuiltSlots[slot] !== 0) slot = (slot + 1) & mask;
  }
  const slots = map.slots,
    keys = map.entryKeys,
    values = map.entryValues,
    hashes = map.hashes;
  if (
    slots === undefined ||
    keys === undefined ||
    values === undefined ||
    hashes === undefined
  )
    throw "map storage invariant";
  if (key === undefined && map.undefinedKey === undefined)
    map.undefinedKey = { value: key };
  if (value === undefined && map.undefinedValue === undefined)
    map.undefinedValue = { value };
  const order = map.order + 1,
    entry = map.length;
  if (slots[slot] === 0) map.used = map.used + 1;
  keys.push(key);
  values.push(value);
  hashes[entry] = insertHash;
  const orders = map.orders;
  if (orders !== undefined) orders[entry] = order;
  slots[slot] = entry + 1;
  map.length = entry + 1;
  map.size = map.size + 1;
  map.order = order;
  if (isAddr && map.hashEpoch !== gcEpoch()) rehashInPlace<K, V>(map);
  return true;
}

/** Return true for insertion; updating an existing value does not allocate. */
export function setMap<K, V>(map: CompactMap<K, V>, key: K, value: V): boolean {
  const isAddr = usesAddressHash(key);
  if (isAddr && map.hashEpoch !== gcEpoch()) rehashInPlace<K, V>(map);
  const raw = referenceHash(key),
    base = raw !== 0 ? raw : primitiveFallbackHash(key),
    h = Math.imul(base, 0x9e3779b1),
    unmasked = (h ^ (h >>> 16)) >>> 0,
    mixed = unmasked === removedHash ? 0 : unmasked;
  const slots = map.slots,
    keys = map.entryKeys,
    values = map.entryValues,
    hashes = map.hashes;
  if (
    slots !== undefined &&
    keys !== undefined &&
    values !== undefined &&
    hashes !== undefined
  ) {
    const capacity = slots.length;
    if (capacity < 1 || capacity > maximumSlots) throw "map capacity invariant";
    const mask = capacity - 1,
      undefKey = map.undefinedKey;
    let at = mixed & mask,
      deletedAt = -1;
    while (true) {
      const probe = slots[at] ?? 0;
      if (probe === 0) {
        const entry = map.length >>> 0;
        if (
          deletedAt < 0 &&
          entry < map.fastLimit &&
          entry < hashes.length &&
          key !== undefined &&
          value !== undefined
        ) {
          const next = entry + 1;
          keys.push(key);
          values.push(value);
          hashes[entry] = mixed;
          slots[at] = next;
          map.length = next;
          map.size = next;
          if (isAddr && map.hashEpoch !== gcEpoch()) rehashInPlace<K, V>(map);
          return true;
        }
        return setMapSlow<K, V>(
          map,
          key,
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
          const existing = keys[entry];
          if (
            (existing !== undefined
              ? existing === key
              : undefKey !== undefined && key === undefined) ||
            (key !== key && sameKeySlow<K>(keys, entry, key, undefKey))
          ) {
            if (value === undefined && map.undefinedValue === undefined)
              map.undefinedValue = { value };
            values[entry] = value;
            return false;
          }
        }
      }
      at = (at + 1) & mask;
    }
  }
  return setMapSlow<K, V>(map, key, value, mixed, -1, isAddr);
}

export function deleteMap<K, V>(map: CompactMap<K, V>, key: K): boolean {
  if (usesAddressHash(key) && map.hashEpoch !== gcEpoch())
    rehashInPlace<K, V>(map);
  const slots = map.slots,
    keys = map.entryKeys,
    hashes = map.hashes;
  if (slots === undefined || keys === undefined || hashes === undefined)
    return false;
  const capacity = slots.length;
  if (capacity < 1 || capacity > maximumSlots) return false;
  const raw = referenceHash(key),
    base = raw !== 0 ? raw : primitiveFallbackHash(key),
    h = Math.imul(base, 0x9e3779b1),
    unmasked = (h ^ (h >>> 16)) >>> 0,
    mixed = unmasked === removedHash ? 0 : unmasked;
  const mask = capacity - 1,
    undefKey = map.undefinedKey;
  let at = mixed & mask;
  while (true) {
    const probe = slots[at] ?? 0;
    if (probe === 0) return false;
    if (probe !== deletedSlot) {
      const entry = probe - 1;
      if (hashes[entry] === mixed) {
        const existing = keys[entry];
        if (
          (existing !== undefined
            ? existing === key
            : undefKey !== undefined && key === undefined) ||
          (key !== key && sameKeySlow<K>(keys, entry, key, undefKey))
        ) {
          syncFast<K, V>(map);
          map.fastLimit = 0;
          slots[at] = deletedSlot;
          hashes[entry] = removedHash;
          map.size = map.size - 1;
          if (map.size === 0) {
            clearMap<K, V>(map);
          } else if (map.size * 4 < map.length && map.length > initialSlots) {
            let nextCapacity = initialSlots;
            while (nextCapacity < map.size * 4) nextCapacity *= 2;
            rebuild<K, V>(map, nextCapacity);
          }
          return true;
        }
      }
    }
    at = (at + 1) & mask;
  }
}

export function clearMap<K, V>(map: CompactMap<K, V>): void {
  syncFast<K, V>(map);
  map.entryKeys = undefined;
  map.entryValues = undefined;
  map.hashes = undefined;
  map.slots = undefined;
  map.orders = undefined;
  map.length = 0;
  map.size = 0;
  map.used = 0;
  map.baseOrder = map.order;
  map.compactions = map.compactions + 1;
  map.fastLimit = 0;
  map.hashEpoch = gcEpoch();
}

export function sizeMap<K, V>(map: CompactMap<K, V>): number {
  return map.size;
}

/** Live insertion-order cursor. Exhaustion releases the collection permanently. */
export interface CompactMapCursor<K, V> {
  map: CompactMap<K, V> | undefined;
  index: number;
  after: number;
  compactions: number;
  hasCurrent: boolean;
  currentKey: K | undefined;
  currentValue: V | undefined;
  undefinedKey: StoredUndefined<K> | undefined;
  undefinedValue: StoredUndefined<V> | undefined;
}

export function createMapCursor<K, V>(
  map: CompactMap<K, V>,
): CompactMapCursor<K, V> {
  return {
    map,
    index: 0,
    after: 0,
    compactions: map.compactions,
    hasCurrent: false,
    currentKey: undefined,
    currentValue: undefined,
    undefinedKey: undefined,
    undefinedValue: undefined,
  };
}

export function advanceMapCursor<K, V>(
  cursor: CompactMapCursor<K, V>,
): boolean {
  const map = cursor.map;
  cursor.hasCurrent = false;
  cursor.currentKey = undefined;
  cursor.currentValue = undefined;
  cursor.undefinedKey = undefined;
  cursor.undefinedValue = undefined;
  if (map === undefined) return false;
  const length = map.length,
    keys = map.entryKeys,
    values = map.entryValues,
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
  cursor.currentKey = keys[index];
  cursor.currentValue = values[index];
  cursor.undefinedKey = map.undefinedKey;
  cursor.undefinedValue = map.undefinedValue;
  cursor.hasCurrent = true;
  cursor.after =
    orders === undefined ? baseOrder + index + 1 : (orders[index] ?? 0);
  cursor.index = index + 1;
  return true;
}

export function readMapCursorKey<K, V>(cursor: CompactMapCursor<K, V>): K {
  if (!cursor.hasCurrent) throw "MAP_CURSOR_NOT_POSITIONED";
  const key = cursor.currentKey;
  if (key !== undefined) return key;
  const undef = cursor.undefinedKey;
  if (undef !== undefined) return undef.value;
  throw "MAP_CURSOR_KEY_INVARIANT";
}

export function readMapCursorValue<K, V>(cursor: CompactMapCursor<K, V>): V {
  if (!cursor.hasCurrent) throw "MAP_CURSOR_NOT_POSITIONED";
  const value = cursor.currentValue;
  if (value !== undefined) return value;
  const undef = cursor.undefinedValue;
  if (undef !== undefined) return undef.value;
  throw "MAP_CURSOR_VALUE_INVARIANT";
}
