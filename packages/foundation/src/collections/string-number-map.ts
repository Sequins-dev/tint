// Compact insertion-ordered open-addressed hash map specialized for
// Map<string, number>: keys live in a dense string[], values live in a direct
// Float64Array, stored mixed hashes live in a Uint32Array (0xffffffff marks a
// deleted entry), and `slots` maps probe positions to `entry + 1` (0 empty,
// 0xffffffff deleted). Zero per-entry heap records and zero NumberList wrapper.
export interface StringNumberMap {
  /** Dense insertion-order keys; allocated lazily on first insertion. */
  strKeys: string[] | undefined;
  /** Parallel insertion-order numeric values. */
  numValues: Float64Array | undefined;
  /** Mixed hashes per entry; `removedHash` marks a deleted entry. */
  hashes: Uint32Array | undefined;
  /** Open-addressed table: 0 empty, 0xffffffff deleted, entry + 1 live. */
  slots: Uint32Array | undefined;
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
  /** Nonzero (equals values.length) iff dense append-only fast inserts are valid. */
  fastLimit: number;
}

const initialSlots = 8;
const removedHash = 0xffffffff;
const deletedSlot = 0xffffffff;
const maximumSlots = 0x40000000;
const maxSafeOrder = 9007199254740991;

/** Mixes a string's UTF-16 hash for power-of-two open addressing, reserving
 * `removedHash` as the deletion marker. */
function hashKey(key: string): number {
  let raw = 0;
  const n = key.length;
  for (let i = 0; i < n; i++) raw = ((raw << 5) - raw + key.charCodeAt(i)) | 0;
  const h = Math.imul(raw, 0x9e3779b1),
    value = (h ^ (h >>> 16)) >>> 0;
  return value === removedHash ? 0 : value;
}

function syncFast(map: StringNumberMap): void {
  if (map.fastLimit > 0) {
    map.used = map.length;
    map.order = map.baseOrder + map.length;
  }
}

export function createMap(): StringNumberMap {
  return {
    strKeys: undefined,
    numValues: undefined,
    hashes: undefined,
    slots: undefined,
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
 * Without deletions, keys stay in place and values/hashes are bulk-copied. */
function rebuild(map: StringNumberMap, capacity: number): void {
  syncFast(map);
  if (capacity > maximumSlots) throw "MAP_CAPACITY_LIMIT";
  const oldKeys = map.strKeys,
    oldValues = map.numValues,
    oldHashes = map.hashes,
    oldOrders = map.orders,
    length = map.length,
    nextCapacity = capacity >>> 1,
    nextValues = new Float64Array(nextCapacity),
    nextHashes = new Uint32Array(nextCapacity),
    nextSlots = new Uint32Array(capacity),
    mask = capacity - 1;
  if (
    oldKeys === undefined ||
    oldValues === undefined ||
    oldHashes === undefined ||
    length === 0
  ) {
    map.strKeys = [];
    map.numValues = nextValues;
    map.hashes = nextHashes;
    map.slots = nextSlots;
    map.orders = undefined;
    map.length = 0;
    map.used = 0;
    map.fastLimit =
      map.baseOrder + nextCapacity <= maxSafeOrder ? nextCapacity : 0;
    return;
  }
  if (map.size === length) {
    nextValues.set(oldValues);
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
    map.numValues = nextValues;
    map.hashes = nextHashes;
    map.slots = nextSlots;
    map.used = length;
    map.fastLimit =
      oldOrders === undefined && map.baseOrder + nextCapacity <= maxSafeOrder
        ? nextCapacity
        : 0;
    return;
  }
  const nextKeys: string[] = [],
    nextOrders = new Float64Array(nextCapacity),
    baseOrder = map.baseOrder;
  let write = 0;
  for (let entry = 0; entry < length; entry++) {
    const entryHash = oldHashes[entry] ?? removedHash;
    if (entryHash === removedHash) continue;
    const key = oldKeys[entry];
    if (key === undefined) throw "map key invariant";
    const val = oldValues[entry] ?? 0,
      ord =
        oldOrders === undefined
          ? baseOrder + entry + 1
          : (oldOrders[entry] ?? 0);
    let at = entryHash & mask;
    while (nextSlots[at] !== 0) at = (at + 1) & mask;
    nextKeys.push(key);
    nextValues[write] = val;
    nextHashes[write] = entryHash;
    nextOrders[write] = ord;
    write++;
    nextSlots[at] = write;
  }
  map.strKeys = nextKeys;
  map.numValues = nextValues;
  map.hashes = nextHashes;
  map.slots = nextSlots;
  map.orders = nextOrders;
  map.length = write;
  map.used = write;
  map.compactions = map.compactions + 1;
  map.fastLimit = 0;
}

export function hasMap(map: StringNumberMap, key: string): boolean {
  const slots = map.slots,
    keys = map.strKeys,
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
      if (
        entry < hashes.length &&
        hashes[entry] === hash &&
        keys[entry] === key
      )
        return true;
    }
    at = (at + 1) & mask;
  }
}

export function getMap(map: StringNumberMap, key: string): number | undefined {
  const slots = map.slots,
    keys = map.strKeys,
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
  let raw = 0;
  const n = key.length;
  for (let i = 0; i < n; i++) raw = ((raw << 5) - raw + key.charCodeAt(i)) | 0;
  const h = Math.imul(raw, 0x9e3779b1),
    unmasked = (h ^ (h >>> 16)) >>> 0,
    hash = unmasked === removedHash ? 0 : unmasked,
    mask = capacity - 1;
  let at = hash & mask;
  while (true) {
    const probe = slots[at] ?? 0;
    if (probe === 0) return undefined;
    if (probe !== deletedSlot) {
      const entry = probe - 1;
      if (
        entry < hashes.length &&
        hashes[entry] === hash &&
        keys[entry] === key
      )
        return entry < values.length ? values[entry] : undefined;
    }
    at = (at + 1) & mask;
  }
}

/** Slow insertion path: initial allocation, growth/compaction, tombstone reuse,
 * or post-compaction order tracking. */
function setMapSlow(
  map: StringNumberMap,
  key: string,
  value: number,
  hash: number,
  target: number,
): boolean {
  syncFast(map);
  if (map.order >= maxSafeOrder) throw "MAP_ORDER_LIMIT";
  const existingSlots = map.slots,
    existingKeys = map.strKeys,
    existingValues = map.numValues,
    existingHashes = map.hashes;
  let slot = target;
  if (
    existingSlots === undefined ||
    existingKeys === undefined ||
    existingValues === undefined ||
    existingHashes === undefined
  ) {
    const cap = initialSlots >>> 1;
    map.strKeys = [];
    map.numValues = new Float64Array(cap);
    map.hashes = new Uint32Array(cap);
    map.slots = new Uint32Array(initialSlots);
    map.fastLimit = map.baseOrder + cap <= maxSafeOrder ? cap : 0;
    slot = hash & (initialSlots - 1);
  } else if (
    (map.used + 1) * 2 > existingSlots.length ||
    map.length >= existingHashes.length
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
    keys = map.strKeys,
    values = map.numValues,
    hashes = map.hashes;
  if (
    slots === undefined ||
    keys === undefined ||
    values === undefined ||
    hashes === undefined
  )
    throw "map storage invariant";
  const order = map.order + 1,
    entry = map.length;
  if (slots[slot] === 0) map.used = map.used + 1;
  keys.push(key);
  values[entry] = value;
  hashes[entry] = hash;
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
  map: StringNumberMap,
  key: string,
  value: number,
): boolean {
  const slots = map.slots,
    keys = map.strKeys,
    values = map.numValues,
    hashes = map.hashes;
  let raw = 0;
  const n = key.length;
  for (let i = 0; i < n; i++) raw = ((raw << 5) - raw + key.charCodeAt(i)) | 0;
  const h = Math.imul(raw, 0x9e3779b1),
    unmasked = (h ^ (h >>> 16)) >>> 0,
    hash = unmasked === removedHash ? 0 : unmasked;
  if (
    slots !== undefined &&
    keys !== undefined &&
    values !== undefined &&
    hashes !== undefined
  ) {
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
          entry < values.length &&
          entry < hashes.length
        ) {
          const next = entry + 1;
          keys.push(key);
          values[entry] = value;
          hashes[entry] = hash;
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
        if (
          entry < hashes.length &&
          hashes[entry] === hash &&
          keys[entry] === key
        ) {
          if (entry < values.length) values[entry] = value;
          return false;
        }
      }
      at = (at + 1) & mask;
    }
  }
  return setMapSlow(map, key, value, hash, -1);
}

export function deleteMap(map: StringNumberMap, key: string): boolean {
  const slots = map.slots,
    keys = map.strKeys,
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
      if (
        entry < hashes.length &&
        hashes[entry] === hash &&
        keys[entry] === key
      ) {
        syncFast(map);
        map.fastLimit = 0;
        slots[at] = deletedSlot;
        hashes[entry] = removedHash;
        map.size = map.size - 1;
        if (map.size * 4 < map.length && map.length > initialSlots) {
          let capacity = initialSlots;
          while (capacity < map.size * 4) capacity *= 2;
          rebuild(map, capacity);
        }
        return true;
      }
    }
    at = (at + 1) & mask;
  }
}

export function clearMap(map: StringNumberMap): void {
  syncFast(map);
  map.strKeys = undefined;
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
}

export function sizeMap(map: StringNumberMap): number {
  return map.size;
}

/** Live insertion-order cursor; exhaustion releases the map permanently. */
export interface StringNumberMapCursor {
  map: StringNumberMap | undefined;
  index: number;
  after: number;
  compactions: number;
  currentKey: string;
  currentValue: number;
}

export function createMapCursor(map: StringNumberMap): StringNumberMapCursor {
  return {
    map,
    index: 0,
    after: 0,
    compactions: map.compactions,
    currentKey: "",
    currentValue: 0,
  };
}

function findNextMapEntry(
  map: StringNumberMap,
  index: number,
  after: number,
  compactions: number,
): number {
  const length = map.length,
    hashes = map.hashes;
  if (hashes === undefined) return length;
  if (compactions !== map.compactions) {
    const orders = map.orders,
      baseOrder = map.baseOrder;
    let at = 0;
    while (at < length) {
      if (hashes[at] !== removedHash) {
        const ord =
          orders === undefined ? baseOrder + at + 1 : (orders[at] ?? 0);
        if (ord > after) break;
      }
      at++;
    }
    return at;
  }
  while (index < length && hashes[index] === removedHash) index++;
  return index;
}

function mapEntryOrder(map: StringNumberMap, index: number): number {
  const orders = map.orders;
  return orders === undefined
    ? map.baseOrder + index + 1
    : (orders[index] ?? 0);
}

function mapKeyAt(map: StringNumberMap, index: number): string {
  const keys = map.strKeys;
  return keys === undefined ? "" : (keys[index] ?? "");
}

function mapValueAt(map: StringNumberMap, index: number): number {
  const values = map.numValues;
  return values === undefined ? 0 : (values[index] ?? 0);
}

export function advanceMapCursor(cursor: StringNumberMapCursor): boolean {
  const map = cursor.map;
  if (map === undefined) return false;
  let index = cursor.index;
  const compactions = map.compactions,
    cursorCompactions = cursor.compactions;
  if (map.fastLimit === 0 || cursorCompactions !== compactions) {
    index = findNextMapEntry(map, index, cursor.after, cursorCompactions);
    cursor.compactions = compactions;
  }
  if (index >= map.length) {
    cursor.map = undefined;
    return false;
  }
  cursor.currentKey = mapKeyAt(map, index);
  cursor.currentValue = mapValueAt(map, index);
  cursor.after = mapEntryOrder(map, index);
  cursor.index = index + 1;
  return true;
}

export function readMapCursorKey(cursor: StringNumberMapCursor): string {
  if (cursor.map === undefined || cursor.index === 0)
    throw "MAP_CURSOR_NOT_POSITIONED";
  return cursor.currentKey;
}

export function readMapCursorValue(cursor: StringNumberMapCursor): number {
  if (cursor.map === undefined || cursor.index === 0)
    throw "MAP_CURSOR_NOT_POSITIONED";
  return cursor.currentValue;
}
