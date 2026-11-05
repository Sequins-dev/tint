import {
  createKeyIndex,
  hashString,
  type KeyIndex,
  type KeyEquivalence,
} from "./key-index.ts";

interface MapEntry<K, V> {
  readonly key: K;
  value: V;
  next: MapEntry<K, V> | undefined;
  previous: MapEntry<K, V> | undefined;
  readonly order: number;
}
export interface LinkedMap<K, V> {
  readonly keys: KeyEquivalence<K> | undefined;
  index: KeyIndex<K, MapEntry<K, V>> | undefined;
  head: MapEntry<K, V> | undefined;
  tail: MapEntry<K, V> | undefined;
  size: number;
  order: number;
}
function keyHash(key: unknown): number {
  if (typeof key === "string") return hashString(key);
  if (typeof key === "number") return key >>> 0;
  // Identity hashes are not exposed by the native ABI. The index resolves
  // collisions by SameValueZero, retaining object identity and signed-zero rules.
  return 0;
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
    index: undefined,
    head: undefined,
    tail: undefined,
    size: 0,
    order: 0,
  };
}
function findMap<K, V>(
  map: LinkedMap<K, V>,
  key: K,
): MapEntry<K, V> | undefined {
  const index = map.index;
  if (index !== undefined) return index.get(key);
  let entry = map.head;
  while (entry !== undefined) {
    const keys = map.keys;
    if (
      keys === undefined
        ? entry.key === key || (entry.key !== entry.key && key !== key)
        : keys.equals(entry.key, key)
    )
      return entry;
    entry = entry.next;
  }
  return undefined;
}
export function hasMap<K, V>(map: LinkedMap<K, V>, key: K): boolean {
  return findMap<K, V>(map, key) !== undefined;
}
export function getMap<K, V>(map: LinkedMap<K, V>, key: K): V | undefined {
  const entry = findMap<K, V>(map, key);
  if (entry === undefined) return undefined;
  return entry.value;
}
/** Return true for insertion; updating an existing value does not allocate. */
export function setMap<K, V>(map: LinkedMap<K, V>, key: K, value: V): boolean {
  const existing = findMap<K, V>(map, key);
  if (existing !== undefined) {
    existing.value = value;
    return false;
  }
  if (map.order >= 9007199254740991) throw "MAP_ORDER_LIMIT";
  const order = map.order + 1;
  const tail = map.tail;
  const entry: MapEntry<K, V> = {
    key,
    value,
    next: undefined,
    previous: tail,
    order,
  };
  const index = map.index;
  if (index !== undefined) index.set(key, entry);
  else if (map.size >= 8) {
    // Most property maps contain only a handful of keys. Publish the larger
    // representation only after existing entries and the insertion are indexed.
    const keys = map.keys;
    const promoted = createKeyIndex<K, MapEntry<K, V>>(
      keys === undefined ? (key: K): number => keyHash(key) : keys.hash,
      keys === undefined ? undefined : keys.equals,
    );
    let current = map.head;
    while (current !== undefined) {
      promoted.set(current.key, current);
      current = current.next;
    }
    promoted.set(key, entry);
    map.index = promoted;
  }
  if (tail === undefined) map.head = entry;
  else tail.next = entry;
  map.order = order;
  map.tail = entry;
  map.size = map.size + 1;
  return true;
}
export function deleteMap<K, V>(map: LinkedMap<K, V>, key: K): boolean {
  const entry = findMap<K, V>(map, key);
  if (entry === undefined) return false;
  const previous = entry.previous,
    next = entry.next;
  const index = map.index;
  if (index !== undefined) index.delete(key);
  if (previous === undefined) map.head = next;
  else previous.next = next;
  if (next === undefined) map.tail = previous;
  else next.previous = previous;
  map.size = map.size - 1;
  return true;
}

export function clearMap<K, V>(map: LinkedMap<K, V>): void {
  map.index = undefined;
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
