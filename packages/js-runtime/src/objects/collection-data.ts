import { hashString } from "@tint/foundation/collections/key-index";
import { collectionKeyEqual } from "./collection-keys.ts";

// Insertion-ordered hash table for Script Map and Set collections with inline
// SameValueZero hashing and key comparison (zero indirect hash/equals closure
// dispatch on the hot number and string paths).
export interface ScriptMapEntry {
  readonly key: unknown;
  readonly hash: number;
  value: unknown;
  next: ScriptMapEntry | undefined;
  previous: ScriptMapEntry | undefined;
  /** The next entry in the same bucket. */
  chain: ScriptMapEntry | undefined;
  readonly order: number;
}

export interface ScriptMap {
  /** Bucket heads once the collection outgrows a linear walk; length is a
   * power of two. */
  buckets: (ScriptMapEntry | undefined)[] | undefined;
  head: ScriptMapEntry | undefined;
  tail: ScriptMapEntry | undefined;
  size: number;
  order: number;
}

const linearLimit = 8;

function bucketOf(hash: number, mask: number): number {
  let mixed = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
  return ((mixed ^ (mixed >>> 16)) >>> 0) & mask;
}

export function createScriptMap(): ScriptMap {
  return {
    buckets: undefined,
    head: undefined,
    tail: undefined,
    size: 0,
    order: 0,
  };
}

function findEntry(
  map: ScriptMap,
  key: unknown,
  hash: number,
): ScriptMapEntry | undefined {
  const buckets = map.buckets;
  let entry =
    buckets === undefined
      ? map.head
      : buckets[bucketOf(hash, buckets.length - 1)];
  if (typeof key === "number") {
    if (key === key) {
      while (entry !== undefined) {
        if (entry.hash === hash && entry.key === key) return entry;
        entry = buckets === undefined ? entry.next : entry.chain;
      }
      return undefined;
    }
    while (entry !== undefined) {
      if (
        entry.hash === hash &&
        typeof entry.key === "number" &&
        entry.key !== entry.key
      )
        return entry;
      entry = buckets === undefined ? entry.next : entry.chain;
    }
    return undefined;
  }
  if (typeof key === "string") {
    while (entry !== undefined) {
      if (entry.hash === hash && entry.key === key) return entry;
      entry = buckets === undefined ? entry.next : entry.chain;
    }
    return undefined;
  }
  while (entry !== undefined) {
    if (entry.hash === hash && collectionKeyEqual(entry.key, key)) return entry;
    entry = buckets === undefined ? entry.next : entry.chain;
  }
  return undefined;
}

function keyHash(key: unknown): number {
  if (typeof key === "number") return key >>> 0;
  if (typeof key === "string") return hashString(key);
  return 0;
}

function rebuild(map: ScriptMap, size: number): void {
  let capacity = 16;
  while (capacity < size) capacity *= 2;
  const buckets: (ScriptMapEntry | undefined)[] = [];
  const mask = capacity - 1;
  for (let i = 0; i < capacity; i++) buckets.push(undefined);
  let entry = map.head;
  while (entry !== undefined) {
    const bucket = bucketOf(entry.hash, mask);
    entry.chain = buckets[bucket];
    buckets[bucket] = entry;
    entry = entry.next;
  }
  map.buckets = buckets;
}

export function hasScriptMap(map: ScriptMap, key: unknown): boolean {
  const normalized = key === 0 ? 0 : key;
  return findEntry(map, normalized, keyHash(normalized)) !== undefined;
}

export function getScriptMap(map: ScriptMap, key: unknown): unknown {
  const normalized = key === 0 ? 0 : key;
  const entry = findEntry(map, normalized, keyHash(normalized));
  return entry === undefined ? undefined : entry.value;
}

export function setScriptMap(
  map: ScriptMap,
  key: unknown,
  value: unknown,
): boolean {
  const normalized = key === 0 ? 0 : key;
  const hash = keyHash(normalized);
  const existing = findEntry(map, normalized, hash);
  if (existing !== undefined) {
    existing.value = value;
    return false;
  }
  if (map.order >= 9007199254740991) throw "MAP_ORDER_LIMIT";
  const order = map.order + 1;
  const tail = map.tail;
  const entry: ScriptMapEntry = {
    key: normalized,
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
    if (map.size > buckets.length) rebuild(map, map.size);
    else {
      const bucket = bucketOf(hash, buckets.length - 1);
      entry.chain = buckets[bucket];
      buckets[bucket] = entry;
    }
  } else if (map.size > linearLimit) rebuild(map, map.size);
  return true;
}

export function deleteScriptMap(map: ScriptMap, key: unknown): boolean {
  const normalized = key === 0 ? 0 : key;
  const entry = findEntry(map, normalized, keyHash(normalized));
  if (entry === undefined) return false;
  const buckets = map.buckets;
  if (buckets !== undefined) {
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
  const previous = entry.previous;
  const next = entry.next;
  if (previous === undefined) map.head = next;
  else previous.next = next;
  if (next === undefined) map.tail = previous;
  else next.previous = previous;
  map.size = map.size - 1;
  return true;
}

export function clearScriptMap(map: ScriptMap): void {
  map.buckets = undefined;
  map.head = undefined;
  map.tail = undefined;
  map.size = 0;
}

/** Live insertion-order cursor. Exhaustion releases the collection permanently. */
export interface ScriptMapCursor {
  map: ScriptMap | undefined;
  after: number;
  current: ScriptMapEntry | undefined;
  next: ScriptMapEntry | undefined;
  tail: ScriptMapEntry | undefined;
  size: number;
}

export function createScriptMapCursor(map: ScriptMap): ScriptMapCursor {
  return {
    map,
    after: 0,
    current: undefined,
    next: map.head,
    tail: map.tail,
    size: map.size,
  };
}

export function advanceScriptMapCursor(cursor: ScriptMapCursor): boolean {
  const map = cursor.map;
  cursor.current = undefined;
  if (map === undefined) return false;
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

export function readScriptMapCursorKey(cursor: ScriptMapCursor): unknown {
  const entry = cursor.current;
  if (entry === undefined) throw "MAP_CURSOR_NOT_POSITIONED";
  return entry.key;
}

export function readScriptMapCursorValue(cursor: ScriptMapCursor): unknown {
  const entry = cursor.current;
  if (entry === undefined) throw "MAP_CURSOR_NOT_POSITIONED";
  return entry.value;
}
