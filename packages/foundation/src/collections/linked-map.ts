import {
  gcEpoch,
  hashString,
  referenceHash,
  usesAddressHash,
  type KeyEquivalence,
} from "./key-index.ts";
export { gcEpoch, referenceHash, usesAddressHash } from "./key-index.ts";

// An insertion-ordered hash map in the style of Close's deterministic tables
// (V8's OrderedHashMap): entries form one insertion-order list, and each
// bucket chains its entries directly, so a lookup is one bucket read plus a
// short pointer walk and an insertion allocates one entry. There are no
// closures, so map state is ordinary record fields rather than captured
// cells. Small maps skip the buckets and walk the order list.
interface MapEntry<K, V> {
  readonly key: K;
  hash: number;
  value: V;
  next: MapEntry<K, V> | undefined;
  previous: MapEntry<K, V> | undefined;
  /** The next entry in the same bucket. */
  chain: MapEntry<K, V> | undefined;
  readonly order: number;
}
export interface LinkedMap<K, V> {
  readonly keys: KeyEquivalence<K> | undefined;
  /** Bucket heads once the map outgrows a linear walk; length is a power of
   * two; bucket indexes mask hashes with length - 1. */
  buckets: (MapEntry<K, V> | undefined)[] | undefined;
  head: MapEntry<K, V> | undefined;
  tail: MapEntry<K, V> | undefined;
  size: number;
  order: number;
  /** GC epoch at which address-hashed entries and buckets were last built. */
  hashEpoch: number;
}
// Maps up to this size are searched linearly through the order list.
const linearLimit = 8;
function keyHash<K, V>(map: LinkedMap<K, V>, key: K): number {
  const keys = map.keys;
  if (keys !== undefined) {
    const value = keys.hash(key);
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
      throw "INVALID_KEY_HASH";
    return value;
  }
  return primitiveHash<K>(key);
}
/** String and number keys reach the type tests through unknown. */
function primitiveFallbackHash(key: unknown): number {
  if (typeof key === "string") return hashString(key);
  if (typeof key === "number") return key >>> 0;
  return 0;
}
/** Hash a key by value (bigint, string, number) or epoch-scoped address
 * (managed references). Specialized callers keep `key` unboxed so native
 * lowering dispatches `referenceHash(key)` directly without general boxing. */
function primitiveHash<K>(key: K): number {
  const hash = referenceHash(key);
  if (hash !== 0) return hash;
  return primitiveFallbackHash(key);
}
/** Murmur3's finalizer spreads sequential and patterned hashes across
 * power-of-two buckets. The mask is `buckets.length - 1` (a list length is a
 * known uint32, so the masking stays integer). */
function bucketOf(hash: number, mask: number): number {
  let mixed = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
  return ((mixed ^ (mixed >>> 16)) >>> 0) & mask;
}
export function createMap<K, V>(): LinkedMap<K, V> {
  return createMapStorage<K, V>(undefined);
}
export function createMapWithKeys<K, V>(
  keys: KeyEquivalence<K>,
): LinkedMap<K, V> {
  return createMapStorage<K, V>(keys);
}
function createMapStorage<K, V>(
  keys: KeyEquivalence<K> | undefined,
): LinkedMap<K, V> {
  return {
    keys,
    buckets: undefined,
    head: undefined,
    tail: undefined,
    size: 0,
    order: 0,
    hashEpoch: gcEpoch(),
  };
}
function findMap<K, V>(
  map: LinkedMap<K, V>,
  key: K,
  hash: number,
): MapEntry<K, V> | undefined {
  // Custom key equivalence is decided once per lookup, not per probed entry;
  // the common case compares by SameValueZero inline.
  const keys = map.keys;
  if (keys !== undefined) return findMapWithKeys<K, V>(map, keys, key, hash);
  const buckets = map.buckets;
  let entry: MapEntry<K, V> | undefined;
  if (buckets !== undefined) {
    entry = buckets[bucketOf(hash, buckets.length - 1)];
    while (entry !== undefined) {
      if (
        entry.hash === hash &&
        (entry.key === key || (entry.key !== entry.key && key !== key))
      )
        return entry;
      entry = entry.chain;
    }
    return undefined;
  }
  entry = map.head;
  while (entry !== undefined) {
    if (
      entry.hash === hash &&
      (entry.key === key || (entry.key !== entry.key && key !== key))
    )
      return entry;
    entry = entry.next;
  }
  return undefined;
}
function findMapWithKeys<K, V>(
  map: LinkedMap<K, V>,
  keys: KeyEquivalence<K>,
  key: K,
  hash: number,
): MapEntry<K, V> | undefined {
  const buckets = map.buckets;
  let entry: MapEntry<K, V> | undefined =
    buckets === undefined
      ? map.head
      : buckets[bucketOf(hash, buckets.length - 1)];
  while (entry !== undefined) {
    if (entry.hash === hash && keys.equals(entry.key, key)) return entry;
    entry = buckets === undefined ? entry.next : entry.chain;
  }
  return undefined;
}
/** Recompute address-based hashes and bucket chains in place (zero allocations)
 * after a moving GC cycle. */
function rehashInPlace<K, V>(map: LinkedMap<K, V>): void {
  const buckets = map.buckets;
  if (buckets !== undefined) {
    const capacity = buckets.length;
    for (let i = 0; i < capacity; i++) buckets[i] = undefined;
  }
  const epoch = gcEpoch();
  const mask = buckets === undefined ? 0 : buckets.length - 1;
  let entry = map.head;
  while (entry !== undefined) {
    const hash = primitiveHash<K>(entry.key);
    entry.hash = hash;
    if (buckets !== undefined) {
      const bucket = bucketOf(hash, mask);
      entry.chain = buckets[bucket];
      buckets[bucket] = entry;
    }
    entry = entry.next;
  }
  map.hashEpoch = epoch;
}
/** Rebuild the buckets for at least `size` entries (load factor <= 1). */
function rebuild<K, V>(map: LinkedMap<K, V>, size: number): void {
  let capacity = 16;
  while (capacity < size) capacity *= 2;
  const buckets: (MapEntry<K, V> | undefined)[] = [],
    mask = capacity - 1;
  for (let i = 0; i < capacity; i++) buckets.push(undefined);
  const head = map.head;
  const rehash =
    map.keys === undefined && head !== undefined && usesAddressHash(head.key);
  const epoch = rehash ? gcEpoch() : map.hashEpoch;
  let entry = head;
  while (entry !== undefined) {
    const hash = rehash ? primitiveHash<K>(entry.key) : entry.hash;
    if (rehash) entry.hash = hash;
    const bucket = bucketOf(hash, mask);
    entry.chain = buckets[bucket];
    buckets[bucket] = entry;
    entry = entry.next;
  }
  map.hashEpoch = epoch;
  map.buckets = buckets;
}
export function hasMap<K, V>(map: LinkedMap<K, V>, key: K): boolean {
  if (
    map.keys === undefined &&
    usesAddressHash(key) &&
    map.hashEpoch !== gcEpoch()
  )
    rehashInPlace<K, V>(map);
  return hasMapHashed<K, V>(map, key, keyHash<K, V>(map, key));
}
export function getMap<K, V>(map: LinkedMap<K, V>, key: K): V | undefined {
  if (
    map.keys === undefined &&
    usesAddressHash(key) &&
    map.hashEpoch !== gcEpoch()
  )
    rehashInPlace<K, V>(map);
  return getMapHashed<K, V>(map, key, keyHash<K, V>(map, key));
}
/** Return true for insertion; updating an existing value does not allocate. */
export function setMap<K, V>(map: LinkedMap<K, V>, key: K, value: V): boolean {
  if (
    map.keys === undefined &&
    usesAddressHash(key) &&
    map.hashEpoch !== gcEpoch()
  )
    rehashInPlace<K, V>(map);
  const inserted = setMapHashed<K, V>(map, key, value, keyHash<K, V>(map, key));
  if (
    inserted &&
    map.keys === undefined &&
    usesAddressHash(key) &&
    map.hashEpoch !== gcEpoch()
  )
    rehashInPlace<K, V>(map);
  return inserted;
}
export function deleteMap<K, V>(map: LinkedMap<K, V>, key: K): boolean {
  if (
    map.keys === undefined &&
    usesAddressHash(key) &&
    map.hashEpoch !== gcEpoch()
  )
    rehashInPlace<K, V>(map);
  return deleteMapHashed<K, V>(map, key, keyHash<K, V>(map, key));
}
// Operations on a precomputed key hash, shared with the key-specialized maps
// (number-key-map, string-key-map), which hash without boxing the key.
export function hasMapHashed<K, V>(
  map: LinkedMap<K, V>,
  key: K,
  hash: number,
): boolean {
  return findMap<K, V>(map, key, hash) !== undefined;
}
export function getMapHashed<K, V>(
  map: LinkedMap<K, V>,
  key: K,
  hash: number,
): V | undefined {
  const entry = findMap<K, V>(map, key, hash);
  if (entry === undefined) return undefined;
  return entry.value;
}
export function setMapHashed<K, V>(
  map: LinkedMap<K, V>,
  key: K,
  value: V,
  hash: number,
): boolean {
  const existing = findMap<K, V>(map, key, hash);
  if (existing !== undefined) {
    existing.value = value;
    return false;
  }
  if (map.order >= 9007199254740991) throw "MAP_ORDER_LIMIT";
  const order = map.order + 1,
    tail = map.tail;
  const entry: MapEntry<K, V> = {
    key,
    hash,
    value,
    next: undefined,
    previous: tail,
    chain: undefined,
    order,
  };
  if (tail === undefined) map.head = entry;
  else tail.next = entry;
  map.order = order;
  map.tail = entry;
  map.size = map.size + 1;
  const buckets = map.buckets;
  if (buckets !== undefined) {
    if (map.size > buckets.length) rebuild<K, V>(map, map.size);
    else {
      const bucket = bucketOf(hash, buckets.length - 1);
      entry.chain = buckets[bucket];
      buckets[bucket] = entry;
    }
  } else if (map.size > linearLimit) rebuild<K, V>(map, map.size);
  return true;
}
export function deleteMapHashed<K, V>(
  map: LinkedMap<K, V>,
  key: K,
  hash: number,
): boolean {
  const entry = findMap<K, V>(map, key, hash);
  if (entry === undefined) return false;
  const buckets = map.buckets;
  if (buckets !== undefined) {
    // Unlink from the bucket chain; the entry is on it by construction.
    const bucket = bucketOf(entry.hash, buckets.length - 1);
    let current = buckets[bucket];
    if (current === entry) buckets[bucket] = entry.chain;
    else
      while (current !== undefined) {
        if (current.chain === entry) {
          current.chain = entry.chain;
          break;
        }
        current = current.chain;
      }
    entry.chain = undefined;
  }
  const previous = entry.previous,
    next = entry.next;
  if (previous === undefined) map.head = next;
  else previous.next = next;
  if (next === undefined) map.tail = previous;
  else next.previous = previous;
  map.size = map.size - 1;
  return true;
}

export function clearMap<K, V>(map: LinkedMap<K, V>): void {
  map.buckets = undefined;
  map.head = undefined;
  map.tail = undefined;
  map.size = 0;
  map.hashEpoch = gcEpoch();
}
export function sizeMap<K, V>(map: LinkedMap<K, V>): number {
  return map.size;
}

/** Live insertion-order cursor. Exhaustion releases the collection permanently. */
export interface MapCursor<K, V> {
  map: LinkedMap<K, V> | undefined;
  after: number;
  current: MapEntry<K, V> | undefined;
  next: MapEntry<K, V> | undefined;
  tail: MapEntry<K, V> | undefined;
  size: number;
}
export function createMapCursor<K, V>(map: LinkedMap<K, V>): MapCursor<K, V> {
  return {
    map,
    after: 0,
    current: undefined,
    next: map.head,
    tail: map.tail,
    size: map.size,
  };
}
export function advanceMapCursor<K, V>(cursor: MapCursor<K, V>): boolean {
  const map = cursor.map;
  cursor.current = undefined;
  if (map === undefined) return false;
  // The same mutation test as linked-set: additions change tail identity;
  // deletions change size. Value replacement does not change the sequence.
  let selected = cursor.next;
  if (cursor.tail !== map.tail || cursor.size !== map.size) {
    selected = map.head;
    while (selected !== undefined && selected.order <= cursor.after)
      selected = selected.next;
  }
  if (selected === undefined) {
    cursor.map = undefined;
    cursor.next = undefined;
    cursor.tail = undefined;
    return false;
  }
  cursor.next = selected.next;
  cursor.tail = map.tail;
  cursor.size = map.size;
  cursor.current = selected;
  cursor.after = selected.order;
  return true;
}
export function readMapCursorKey<K, V>(cursor: MapCursor<K, V>): K {
  const entry = cursor.current;
  if (entry === undefined) throw "MAP_CURSOR_NOT_POSITIONED";
  return entry.key;
}
export function readMapCursorValue<K, V>(cursor: MapCursor<K, V>): V {
  const entry = cursor.current;
  if (entry === undefined) throw "MAP_CURSOR_NOT_POSITIONED";
  return entry.value;
}
