import { hashString } from "@tint/foundation/collections/key-index";
import { collectionKeyEqual } from "./collection-keys.ts";

// Insertion-ordered hash table for Script Map and Set collections with inline
// SameValueZero hashing and key comparison (zero indirect hash/equals closure
// dispatch on the hot number and string paths, flat lookup/update paths, and
// cold insertion/rehash split out to keep hot frames compact).
export interface ScriptMapEntry {
  readonly key: unknown;
  /** Non-NaN numeric key payload (with -0 normalized to +0), or NaN for
   * non-number / NaN keys so numeric lookups compare a typed double directly
   * (`entry.numberKey === key`) without reading the 16-byte general `key`. */
  readonly numberKey: number;
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
  /** Bitmask (`map.mask`) cached alongside `buckets`. */
  mask: number;
  head: ScriptMapEntry | undefined;
  tail: ScriptMapEntry | undefined;
  size: number;
  order: number;
}

const linearLimit = 8;

function bucketOf(hash: number, mask: number): number {
  return (Math.imul(hash, 0x9e3779b1) >>> 0) & mask;
}

export function createScriptMap(): ScriptMap {
  return {
    buckets: undefined,
    mask: 0,
    head: undefined,
    tail: undefined,
    size: 0,
    order: 0,
  };
}

function findOtherEntry(
  map: ScriptMap,
  key: unknown,
): ScriptMapEntry | undefined {
  const buckets = map.buckets;
  let entry = buckets === undefined ? map.head : buckets[bucketOf(0, map.mask)];
  while (entry !== undefined) {
    if (entry.hash === 0 && collectionKeyEqual(entry.key, key)) return entry;
    entry = buckets === undefined ? entry.next : entry.chain;
  }
  return undefined;
}

function findNaNEntry(map: ScriptMap): ScriptMapEntry | undefined {
  const buckets = map.buckets;
  let entry = buckets === undefined ? map.head : buckets[bucketOf(0, map.mask)];
  while (entry !== undefined) {
    if (
      entry.hash === 0 &&
      typeof entry.key === "number" &&
      entry.key !== entry.key
    )
      return entry;
    entry = buckets === undefined ? entry.next : entry.chain;
  }
  return undefined;
}

function rebuild(map: ScriptMap, size: number): void {
  let capacity = 16;
  while (capacity < size * 2) capacity *= 2;
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
  map.mask = mask;
}

function insertScriptMapEntry(
  map: ScriptMap,
  key: unknown,
  numberKey: number,
  hash: number,
  value: unknown,
): boolean {
  if (map.order >= 9007199254740991) throw "MAP_ORDER_LIMIT";
  const order = map.order + 1;
  const tail = map.tail;
  const entry: ScriptMapEntry = {
    key,
    numberKey,
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
    if (map.size * 2 > buckets.length) rebuild(map, map.size);
    else {
      const bucket = bucketOf(hash, map.mask);
      entry.chain = buckets[bucket];
      buckets[bucket] = entry;
    }
  } else if (map.size > linearLimit) rebuild(map, map.size);
  return true;
}

function hasScriptMapSlow(map: ScriptMap, key: unknown): boolean {
  if (map.size === 0) return false;
  const buckets = map.buckets;
  if (typeof key === "number") {
    if (key === key) {
      let entry = map.head;
      while (entry !== undefined) {
        if (entry.numberKey === key) return true;
        entry = entry.next;
      }
      return false;
    }
    return findNaNEntry(map) !== undefined;
  }
  if (typeof key === "string") {
    const hash = hashString(key);
    if (buckets !== undefined) {
      let entry = buckets[(Math.imul(hash, 0x9e3779b1) >>> 0) & map.mask];
      while (entry !== undefined) {
        if (
          entry.hash === hash &&
          typeof entry.key === "string" &&
          entry.key === key
        )
          return true;
        entry = entry.chain;
      }
      return false;
    }
    let entry = map.head;
    while (entry !== undefined) {
      if (
        entry.hash === hash &&
        typeof entry.key === "string" &&
        entry.key === key
      )
        return true;
      entry = entry.next;
    }
    return false;
  }
  return findOtherEntry(map, key) !== undefined;
}

export function hasScriptMap(map: ScriptMap, key: unknown): boolean {
  const buckets = map.buckets;
  if (buckets !== undefined && typeof key === "number" && key === key) {
    let entry = buckets[(Math.imul(key >>> 0, 0x9e3779b1) >>> 0) & map.mask];
    while (entry !== undefined) {
      if (entry.numberKey === key) return true;
      entry = entry.chain;
    }
    return false;
  }
  return hasScriptMapSlow(map, key);
}

function getScriptMapSlow(map: ScriptMap, key: unknown): unknown {
  if (map.size === 0) return undefined;
  const buckets = map.buckets;
  if (typeof key === "number") {
    if (key === key) {
      let entry = map.head;
      while (entry !== undefined) {
        if (entry.numberKey === key) return entry.value;
        entry = entry.next;
      }
      return undefined;
    }
    const found = findNaNEntry(map);
    return found === undefined ? undefined : found.value;
  }
  if (typeof key === "string") {
    const hash = hashString(key);
    if (buckets !== undefined) {
      let entry = buckets[(Math.imul(hash, 0x9e3779b1) >>> 0) & map.mask];
      while (entry !== undefined) {
        if (
          entry.hash === hash &&
          typeof entry.key === "string" &&
          entry.key === key
        )
          return entry.value;
        entry = entry.chain;
      }
      return undefined;
    }
    let entry = map.head;
    while (entry !== undefined) {
      if (
        entry.hash === hash &&
        typeof entry.key === "string" &&
        entry.key === key
      )
        return entry.value;
      entry = entry.next;
    }
    return undefined;
  }
  const found = findOtherEntry(map, key);
  return found === undefined ? undefined : found.value;
}

export function getScriptMap(map: ScriptMap, key: unknown): unknown {
  const buckets = map.buckets;
  if (buckets !== undefined && typeof key === "number" && key === key) {
    let entry = buckets[(Math.imul(key >>> 0, 0x9e3779b1) >>> 0) & map.mask];
    while (entry !== undefined) {
      if (entry.numberKey === key) return entry.value;
      entry = entry.chain;
    }
    return undefined;
  }
  return getScriptMapSlow(map, key);
}

function setScriptMapSlow(
  map: ScriptMap,
  key: unknown,
  value: unknown,
): boolean {
  const buckets = map.buckets;
  if (typeof key === "number") {
    if (key === key) {
      const normalized = key === 0 ? 0 : key;
      let entry = map.head;
      while (entry !== undefined) {
        if (entry.numberKey === normalized) {
          entry.value = value;
          return false;
        }
        entry = entry.next;
      }
      return insertScriptMapEntry(
        map,
        normalized,
        normalized,
        normalized >>> 0,
        value,
      );
    }
    const existing = findNaNEntry(map);
    if (existing !== undefined) {
      existing.value = value;
      return false;
    }
    return insertScriptMapEntry(map, key, Number.NaN, 0, value);
  }
  if (typeof key === "string") {
    const hash = hashString(key);
    if (buckets !== undefined) {
      let entry = buckets[(Math.imul(hash, 0x9e3779b1) >>> 0) & map.mask];
      while (entry !== undefined) {
        if (
          entry.hash === hash &&
          typeof entry.key === "string" &&
          entry.key === key
        ) {
          entry.value = value;
          return false;
        }
        entry = entry.chain;
      }
    } else {
      let entry = map.head;
      while (entry !== undefined) {
        if (
          entry.hash === hash &&
          typeof entry.key === "string" &&
          entry.key === key
        ) {
          entry.value = value;
          return false;
        }
        entry = entry.next;
      }
    }
    return insertScriptMapEntry(map, key, Number.NaN, hash, value);
  }
  const existing = findOtherEntry(map, key);
  if (existing !== undefined) {
    existing.value = value;
    return false;
  }
  return insertScriptMapEntry(map, key, Number.NaN, 0, value);
}

export function setScriptMap(
  map: ScriptMap,
  key: unknown,
  value: unknown,
): boolean {
  const buckets = map.buckets;
  if (buckets !== undefined && typeof key === "number" && key === key) {
    const hash = key >>> 0;
    let entry = buckets[(Math.imul(hash, 0x9e3779b1) >>> 0) & map.mask];
    while (entry !== undefined) {
      if (entry.numberKey === key) {
        entry.value = value;
        return false;
      }
      entry = entry.chain;
    }
    const normalized = key === 0 ? 0 : key;
    return insertScriptMapEntry(map, normalized, normalized, hash, value);
  }
  return setScriptMapSlow(map, key, value);
}

function addScriptSetSlow(map: ScriptMap, value: unknown): void {
  const buckets = map.buckets;
  if (typeof value === "number") {
    if (value === value) {
      const normalized = value === 0 ? 0 : value;
      let entry = map.head;
      while (entry !== undefined) {
        if (entry.numberKey === normalized) return;
        entry = entry.next;
      }
      insertScriptMapEntry(
        map,
        normalized,
        normalized,
        normalized >>> 0,
        normalized,
      );
      return;
    }
    if (findNaNEntry(map) !== undefined) return;
    insertScriptMapEntry(map, value, Number.NaN, 0, value);
    return;
  }
  if (typeof value === "string") {
    const hash = hashString(value);
    if (buckets !== undefined) {
      let entry = buckets[(Math.imul(hash, 0x9e3779b1) >>> 0) & map.mask];
      while (entry !== undefined) {
        if (
          entry.hash === hash &&
          typeof entry.key === "string" &&
          entry.key === value
        )
          return;
        entry = entry.chain;
      }
    } else {
      let entry = map.head;
      while (entry !== undefined) {
        if (
          entry.hash === hash &&
          typeof entry.key === "string" &&
          entry.key === value
        )
          return;
        entry = entry.next;
      }
    }
    insertScriptMapEntry(map, value, Number.NaN, hash, value);
    return;
  }
  if (findOtherEntry(map, value) !== undefined) return;
  insertScriptMapEntry(map, value, Number.NaN, 0, value);
}

export function addScriptSet(map: ScriptMap, value: unknown): void {
  const buckets = map.buckets;
  if (buckets !== undefined && typeof value === "number" && value === value) {
    const hash = value >>> 0;
    let entry = buckets[(Math.imul(hash, 0x9e3779b1) >>> 0) & map.mask];
    while (entry !== undefined) {
      if (entry.numberKey === value) return;
      entry = entry.chain;
    }
    const normalized = value === 0 ? 0 : value;
    insertScriptMapEntry(map, normalized, normalized, hash, normalized);
    return;
  }
  addScriptSetSlow(map, value);
}

export function deleteScriptMap(map: ScriptMap, key: unknown): boolean {
  if (map.size === 0) return false;
  const buckets = map.buckets;
  let entry: ScriptMapEntry | undefined;
  if (typeof key === "number") {
    if (key === key) {
      entry =
        buckets === undefined
          ? map.head
          : buckets[bucketOf(key >>> 0, map.mask)];
      while (entry !== undefined) {
        if (entry.numberKey === key) break;
        entry = buckets === undefined ? entry.next : entry.chain;
      }
    } else {
      entry = findNaNEntry(map);
    }
  } else if (typeof key === "string") {
    const hash = hashString(key);
    entry =
      buckets === undefined ? map.head : buckets[bucketOf(hash, map.mask)];
    while (entry !== undefined) {
      if (
        entry.hash === hash &&
        typeof entry.key === "string" &&
        entry.key === key
      )
        break;
      entry = buckets === undefined ? entry.next : entry.chain;
    }
  } else {
    entry = findOtherEntry(map, key);
  }
  if (entry === undefined) return false;
  const target = entry;
  if (buckets !== undefined) {
    const bucket = bucketOf(target.hash, map.mask);
    let current = buckets[bucket];
    if (current === target) buckets[bucket] = target.chain;
    else
      while (current !== undefined) {
        if (current.chain === target) {
          current.chain = target.chain;
          break;
        }
        current = current.chain;
      }
    target.chain = undefined;
  }
  const previous = target.previous;
  const next = target.next;
  if (previous === undefined) map.head = next;
  else previous.next = next;
  if (next === undefined) map.tail = previous;
  else next.previous = previous;
  map.size = map.size - 1;
  return true;
}

export function clearScriptMap(map: ScriptMap): void {
  map.buckets = undefined;
  map.mask = 0;
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

export {
  getScriptMap as scriptMapGet,
  hasScriptMap as scriptMapHas,
  setScriptMap as scriptMapSet,
  addScriptSet as scriptSetAdd,
};
