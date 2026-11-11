import { hashString, type KeyEquivalence } from "./key-index.ts";

// An insertion-ordered hash map in the style of Close's deterministic tables
// (V8's OrderedHashMap): entries form one insertion-order list, and each
// bucket chains its entries directly, so a lookup is one bucket read plus a
// short pointer walk and an insertion allocates one entry. There are no
// closures, so map state is ordinary record fields rather than captured
// cells. Small maps skip the buckets and walk the order list.
interface MapEntry<K, V> {
  readonly key: K;
  readonly hash: number;
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
   * two (mask + 1). */
  buckets: (MapEntry<K, V> | undefined)[] | undefined;
  mask: number;
  head: MapEntry<K, V> | undefined;
  tail: MapEntry<K, V> | undefined;
  size: number;
  order: number;
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
  return primitiveHash(key);
}
/** Generic keys reach the type tests through unknown; number and string keyed
 * maps use number-key-map and string-key-map, which skip this. */
function primitiveHash(key: unknown): number {
  if (typeof key === "string") return hashString(key);
  if (typeof key === "number") return key >>> 0;
  // Identity hashes are not exposed by the native ABI: such keys share one
  // chain, resolved by SameValueZero, retaining identity and signed zero.
  return 0;
}
/** Murmur3's finalizer spreads sequential and patterned hashes across
 * power-of-two buckets. */
function bucketOf(hash: number, mask: number): number {
  let mixed = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
  return ((mixed ^ (mixed >>> 16)) >>> 0) & mask;
}
function sameKey<K, V>(map: LinkedMap<K, V>, left: K, right: K): boolean {
  const keys = map.keys;
  return keys === undefined
    ? left === right || (left !== left && right !== right)
    : keys.equals(left, right);
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
    mask: 0,
    head: undefined,
    tail: undefined,
    size: 0,
    order: 0,
  };
}
function findMap<K, V>(
  map: LinkedMap<K, V>,
  key: K,
  hash: number,
): MapEntry<K, V> | undefined {
  const buckets = map.buckets;
  if (buckets !== undefined) {
    let entry = buckets[bucketOf(hash, map.mask)];
    while (entry !== undefined) {
      if (entry.hash === hash && sameKey<K, V>(map, entry.key, key))
        return entry;
      entry = entry.chain;
    }
    return undefined;
  }
  let entry = map.head;
  while (entry !== undefined) {
    if (entry.hash === hash && sameKey<K, V>(map, entry.key, key)) return entry;
    entry = entry.next;
  }
  return undefined;
}
/** Rebuild the buckets for at least `size` entries (load factor <= 1). */
function rebuild<K, V>(map: LinkedMap<K, V>, size: number): void {
  let capacity = 16;
  while (capacity < size) capacity *= 2;
  const buckets: (MapEntry<K, V> | undefined)[] = [],
    mask = capacity - 1;
  for (let i = 0; i < capacity; i++) buckets.push(undefined);
  let entry = map.head;
  while (entry !== undefined) {
    const bucket = bucketOf(entry.hash, mask);
    entry.chain = buckets[bucket];
    buckets[bucket] = entry;
    entry = entry.next;
  }
  map.buckets = buckets;
  map.mask = mask;
}
export function hasMap<K, V>(map: LinkedMap<K, V>, key: K): boolean {
  return hasMapHashed<K, V>(map, key, keyHash<K, V>(map, key));
}
export function getMap<K, V>(map: LinkedMap<K, V>, key: K): V | undefined {
  return getMapHashed<K, V>(map, key, keyHash<K, V>(map, key));
}
/** Return true for insertion; updating an existing value does not allocate. */
export function setMap<K, V>(map: LinkedMap<K, V>, key: K, value: V): boolean {
  return setMapHashed<K, V>(map, key, value, keyHash<K, V>(map, key));
}
export function deleteMap<K, V>(map: LinkedMap<K, V>, key: K): boolean {
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
    if (map.size > map.mask + 1) rebuild<K, V>(map, map.size);
    else {
      const bucket = bucketOf(hash, map.mask);
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
    const bucket = bucketOf(entry.hash, map.mask);
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
  map.mask = 0;
  map.head = undefined;
  map.tail = undefined;
  map.size = 0;
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
