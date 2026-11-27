import {
  gcEpoch,
  hashString,
  referenceHash,
  usesAddressHash,
} from "./key-index.ts";
export { gcEpoch, referenceHash, usesAddressHash } from "./key-index.ts";

// Compact insertion-ordered open-addressed hash map specialized for general
// keys (objects, bigints, unions, unknown) with numeric values (`Map<K, number>`):
// keys live in a dense insertion-order `K[]`, values live directly in a parallel
// `Float64Array` (zero NumberList indirection), mixed hashes live in a
// `Uint32Array` (`removedHash` marks deleted entries), and `slots` maps
// open-addressed probe positions to `entry + 1` (0 empty, `deletedSlot`
// tombstone). Managed reference keys rehash in place when `gcEpoch()` advances.
interface StoredUndefined<K> {
  readonly value: K;
}

export interface CompactNumberMap<K> {
  /** Dense insertion-order keys; allocated lazily on first insertion. */
  entryKeys: K[] | undefined;
  /** Parallel insertion-order numeric values. */
  numValues: Float64Array | undefined;
  /** Mixed hashes per entry; `removedHash` marks a deleted entry. */
  hashes: Uint32Array | undefined;
  /** Open-addressed table: 0 empty, 0xffffffff deleted, entry + 1 live. */
  slots: Uint32Array | undefined;
  /** Allocated lazily only when compaction shifts indices after deletions. */
  orders: Float64Array | undefined;
  /** Captured only when K admits undefined and undefined has been stored. */
  undefinedKey: StoredUndefined<K> | undefined;
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
  /** Nonzero (equals numValues.length) iff dense append-only fast inserts are valid. */
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

function sameKeySlow<K>(
  keys: K[],
  entry: number,
  key: K,
  undefKey: StoredUndefined<K> | undefined,
): boolean {
  const existing = readKeyAt<K>(keys, entry, undefKey);
  return existing === key || (existing !== existing && key !== key);
}

function syncFast<K>(map: CompactNumberMap<K>): void {
  if (map.fastLimit > 0) {
    map.used = map.length;
    map.order = map.baseOrder + map.length;
  }
}

export function createMap<K>(): CompactNumberMap<K> {
  return {
    entryKeys: undefined,
    numValues: undefined,
    hashes: undefined,
    slots: undefined,
    orders: undefined,
    undefinedKey: undefined,
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
function rehashInPlace<K>(map: CompactNumberMap<K>): void {
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
 * Without deletions, keys stay in place and values/hashes bulk-copy. */
function rebuild<K>(map: CompactNumberMap<K>, capacity: number): void {
  syncFast<K>(map);
  if (capacity > maximumSlots) throw "MAP_CAPACITY_LIMIT";
  const oldKeys = map.entryKeys,
    oldValues = map.numValues,
    oldHashes = map.hashes,
    oldOrders = map.orders,
    length = map.length,
    nextCapacity = capacity >>> 1,
    nextValues = new Float64Array(nextCapacity),
    nextHashes = new Uint32Array(nextCapacity),
    nextSlots = new Uint32Array(capacity),
    mask = capacity - 1,
    undefKey = map.undefinedKey;
  if (
    oldKeys === undefined ||
    oldValues === undefined ||
    oldHashes === undefined ||
    length === 0
  ) {
    map.entryKeys = [];
    map.numValues = nextValues;
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
    nextValues.set(oldValues);
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
    map.numValues = nextValues;
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
    nextOrders = new Float64Array(nextCapacity),
    baseOrder = map.baseOrder;
  const epoch = rehash ? gcEpoch() : map.hashEpoch;
  let write = 0;
  for (let entry = 0; entry < length; entry++) {
    const entryHash = oldHashes[entry] ?? removedHash;
    if (entryHash === removedHash) continue;
    const k = readKeyAt<K>(oldKeys, entry, undefKey),
      ord =
        oldOrders === undefined
          ? baseOrder + entry + 1
          : (oldOrders[entry] ?? 0);
    const mixed = rehash ? keyHash<K>(k) : entryHash;
    let at = mixed & mask;
    while (nextSlots[at] !== 0) at = (at + 1) & mask;
    nextKeys.push(k);
    nextValues[write] = oldValues[entry] ?? 0;
    nextHashes[write] = mixed;
    nextOrders[write] = ord;
    write++;
    nextSlots[at] = write;
  }
  map.entryKeys = nextKeys;
  map.numValues = nextValues;
  map.hashes = nextHashes;
  map.slots = nextSlots;
  map.orders = nextOrders;
  map.length = write;
  map.used = write;
  map.compactions = map.compactions + 1;
  map.fastLimit = 0;
  map.hashEpoch = epoch;
}

export function hasMap<K>(map: CompactNumberMap<K>, key: K): boolean {
  if (usesAddressHash(key) && map.hashEpoch !== gcEpoch())
    rehashInPlace<K>(map);
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

export function getMap<K>(
  map: CompactNumberMap<K>,
  key: K,
): number | undefined {
  if (usesAddressHash(key) && map.hashEpoch !== gcEpoch())
    rehashInPlace<K>(map);
  const slots = map.slots,
    keys = map.entryKeys,
    values = map.numValues,
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
          return values[entry];
      }
    }
    at = (at + 1) & mask;
  }
}

function setMapSlow<K>(
  map: CompactNumberMap<K>,
  key: K,
  value: number,
  hash: number,
  target: number,
  isAddr: boolean,
): boolean {
  syncFast<K>(map);
  if (map.order >= maxSafeOrder) throw "MAP_ORDER_LIMIT";
  const existingSlots = map.slots,
    existingKeys = map.entryKeys,
    existingValues = map.numValues,
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
    map.numValues = new Float64Array(cap);
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
    rebuild<K>(map, nextCapacity);
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
    values = map.numValues,
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
  const order = map.order + 1,
    entry = map.length;
  if (slots[slot] === 0) map.used = map.used + 1;
  keys.push(key);
  values[entry] = value;
  hashes[entry] = insertHash;
  const orders = map.orders;
  if (orders !== undefined) orders[entry] = order;
  slots[slot] = entry + 1;
  map.length = entry + 1;
  map.size = map.size + 1;
  map.order = order;
  if (isAddr && map.hashEpoch !== gcEpoch()) rehashInPlace<K>(map);
  return true;
}

/** Return true for insertion; updating an existing value does not allocate. */
export function setMap<K>(
  map: CompactNumberMap<K>,
  key: K,
  value: number,
): boolean {
  const isAddr = usesAddressHash(key);
  if (isAddr && map.hashEpoch !== gcEpoch()) rehashInPlace<K>(map);
  const raw = referenceHash(key),
    base = raw !== 0 ? raw : primitiveFallbackHash(key),
    h = Math.imul(base, 0x9e3779b1),
    unmasked = (h ^ (h >>> 16)) >>> 0,
    mixed = unmasked === removedHash ? 0 : unmasked;
  const slots = map.slots,
    keys = map.entryKeys,
    values = map.numValues,
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
          entry < values.length &&
          entry < hashes.length &&
          key !== undefined
        ) {
          const next = entry + 1;
          keys.push(key);
          values[entry] = value;
          hashes[entry] = mixed;
          slots[at] = next;
          map.length = next;
          map.size = next;
          if (isAddr && map.hashEpoch !== gcEpoch()) rehashInPlace<K>(map);
          return true;
        }
        return setMapSlow<K>(
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
            values[entry] = value;
            return false;
          }
        }
      }
      at = (at + 1) & mask;
    }
  }
  return setMapSlow<K>(map, key, value, mixed, -1, isAddr);
}

export function deleteMap<K>(map: CompactNumberMap<K>, key: K): boolean {
  if (usesAddressHash(key) && map.hashEpoch !== gcEpoch())
    rehashInPlace<K>(map);
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
          syncFast<K>(map);
          map.fastLimit = 0;
          slots[at] = deletedSlot;
          hashes[entry] = removedHash;
          map.size = map.size - 1;
          if (map.size === 0) {
            clearMap<K>(map);
          } else if (map.size * 4 < map.length && map.length > initialSlots) {
            let nextCapacity = initialSlots;
            while (nextCapacity < map.size * 4) nextCapacity *= 2;
            rebuild<K>(map, nextCapacity);
          }
          return true;
        }
      }
    }
    at = (at + 1) & mask;
  }
}

export function clearMap<K>(map: CompactNumberMap<K>): void {
  syncFast<K>(map);
  map.entryKeys = undefined;
  map.numValues = undefined;
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

export function sizeMap<K>(map: CompactNumberMap<K>): number {
  return map.size;
}

/** Live insertion-order cursor. Exhaustion releases the collection permanently. */
export interface CompactNumberMapCursor<K> {
  map: CompactNumberMap<K> | undefined;
  index: number;
  after: number;
  compactions: number;
  hasCurrent: boolean;
  currentKey: K | undefined;
  currentValue: number;
  undefinedKey: StoredUndefined<K> | undefined;
}

export function createMapCursor<K>(
  map: CompactNumberMap<K>,
): CompactNumberMapCursor<K> {
  return {
    map,
    index: 0,
    after: 0,
    compactions: map.compactions,
    hasCurrent: false,
    currentKey: undefined,
    currentValue: 0,
    undefinedKey: undefined,
  };
}

export function advanceMapCursor<K>(
  cursor: CompactNumberMapCursor<K>,
): boolean {
  const map = cursor.map;
  cursor.hasCurrent = false;
  cursor.currentKey = undefined;
  cursor.undefinedKey = undefined;
  if (map === undefined) return false;
  const length = map.length,
    keys = map.entryKeys,
    values = map.numValues,
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
  cursor.currentValue = values[index] ?? 0;
  cursor.undefinedKey = map.undefinedKey;
  cursor.hasCurrent = true;
  cursor.after =
    orders === undefined ? baseOrder + index + 1 : (orders[index] ?? 0);
  cursor.index = index + 1;
  return true;
}

export function readMapCursorKey<K>(cursor: CompactNumberMapCursor<K>): K {
  if (!cursor.hasCurrent) throw "MAP_CURSOR_NOT_POSITIONED";
  const key = cursor.currentKey;
  if (key !== undefined) return key;
  const undef = cursor.undefinedKey;
  if (undef !== undefined) return undef.value;
  throw "MAP_CURSOR_KEY_INVARIANT";
}

export function readMapCursorValue<K>(
  cursor: CompactNumberMapCursor<K>,
): number {
  if (!cursor.hasCurrent) throw "MAP_CURSOR_NOT_POSITIONED";
  return cursor.currentValue;
}
