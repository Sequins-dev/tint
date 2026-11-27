import { integerHash } from "@tint/foundation/numeric/big-integer";
import {
  viewBigIntValue,
  compareBigIntValues,
  type BigIntValue,
} from "./bigints.ts";

function hashMapString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++)
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

function hashBigIntValue(value: BigIntValue): number {
  return integerHash(value.integer);
}

function sameOtherKey(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  const a = viewBigIntValue(left);
  if (a === undefined) return false;
  const b = viewBigIntValue(right);
  return b !== undefined && compareBigIntValues(a, b) === 0;
}

function findBigIntEntry(
  map: ScriptMap,
  bigint: BigIntValue,
  hash: number,
): ScriptMapEntry | undefined {
  const buckets = map.buckets;
  let entry =
    buckets === undefined ? map.head : buckets[bucketOf(hash, map.mask)];
  while (entry !== undefined) {
    if (entry.hash === hash) {
      const candidate = viewBigIntValue(entry.key);
      if (
        candidate !== undefined &&
        compareBigIntValues(candidate, bigint) === 0
      )
        return entry;
    }
    entry = buckets === undefined ? entry.next : entry.chain;
  }
  return undefined;
}

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
  /** Direct-mapped numeric fast cache aligned 1:1 with `buckets` when hashed.
   * For each slot `s`:
   * - `numKind[s] === 0`: bucket `s` is empty (`numKeys[s]` is NaN).
   * - `numKind[s] === 1`: bucket `s` holds one non-NaN numeric key `numKeys[s]`
   *   whose live value is the Number `numVals[s]` (flush to `buckets[s].value`
   *   via `syncScriptMapNumbers` when `numDirty` is true).
   * - `numKind[s] === 2`: bucket `s` holds one non-NaN numeric key `numKeys[s]`
   *   whose live value is stored in `buckets[s].value`.
   * - `numKind[s] === 3`: bucket `s` holds a collision chain or non-number key
   *   (`numKeys[s]` is NaN); every entry in bucket `s` has its live value in
   *   `entry.value`. */
  numKeys: Float64Array;
  numVals: Float64Array;
  numKind: Uint8Array;
  numDirty: boolean;
  head: ScriptMapEntry | undefined;
  tail: ScriptMapEntry | undefined;
  size: number;
  order: number;
}

const linearLimit = 2;
const noNumKeys = new Float64Array(0);
const noNumVals = new Float64Array(0);
const noNumKind = new Uint8Array(0);

function bucketOf(hash: number, mask: number): number {
  return (Math.imul(hash, 0x9e3779b1) >>> 0) & mask;
}

export function createScriptMap(): ScriptMap {
  return {
    buckets: undefined,
    mask: 0,
    numKeys: noNumKeys,
    numVals: noNumVals,
    numKind: noNumKind,
    numDirty: false,
    head: undefined,
    tail: undefined,
    size: 0,
    order: 0,
  };
}

export function syncScriptMapNumbers(map: ScriptMap): void {
  if (!map.numDirty) return;
  const buckets = map.buckets;
  if (buckets !== undefined && map.mask > 0) {
    const numKind = map.numKind;
    const numVals = map.numVals;
    for (let i = 0; i < numKind.length; i++) {
      if (numKind[i] === 1) {
        const entry = buckets[i];
        const value = numVals[i];
        if (entry !== undefined && value !== undefined) entry.value = value;
      }
    }
  }
  map.numDirty = false;
}

function findOtherEntry(
  map: ScriptMap,
  key: unknown,
): ScriptMapEntry | undefined {
  const buckets = map.buckets;
  let entry = buckets === undefined ? map.head : buckets[bucketOf(0, map.mask)];
  while (entry !== undefined) {
    if (entry.hash === 0 && sameOtherKey(entry.key, key)) return entry;
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
  if (map.numDirty) syncScriptMapNumbers(map);
  let capacity = 8;
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
  const numKeys = new Float64Array(capacity);
  const numVals = new Float64Array(capacity);
  const numKind = new Uint8Array(capacity);
  for (let i = 0; i < capacity; i++) {
    const head = buckets[i];
    if (head === undefined) {
      numKeys[i] = Number.NaN;
    } else if (head.chain === undefined && head.numberKey === head.numberKey) {
      numKeys[i] = head.numberKey;
      const val = head.value;
      if (typeof val === "number") {
        numVals[i] = val;
        numKind[i] = 1;
      } else {
        numKind[i] = 2;
      }
    } else {
      numKeys[i] = Number.NaN;
      numKind[i] = 3;
    }
  }
  map.buckets = buckets;
  map.mask = mask;
  map.numKeys = numKeys;
  map.numVals = numVals;
  map.numKind = numKind;
  map.numDirty = false;
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
      const existing = buckets[bucket];
      entry.chain = existing;
      buckets[bucket] = entry;
      const numKeys = map.numKeys;
      const numVals = map.numVals;
      const numKind = map.numKind;
      if (map.mask > 0) {
        if (existing === undefined && numberKey === numberKey) {
          numKeys[bucket] = numberKey;
          if (typeof value === "number") {
            numVals[bucket] = value;
            numKind[bucket] = 1;
          } else {
            numKind[bucket] = 2;
          }
        } else {
          if (numKind[bucket] === 1 && existing !== undefined) {
            const cached = numVals[bucket];
            if (cached !== undefined) existing.value = cached;
          }
          numKeys[bucket] = Number.NaN;
          numKind[bucket] = 3;
        }
      }
    }
  } else if (map.size > linearLimit) rebuild(map, map.size);
  return true;
}

function hasScriptMapSlow(map: ScriptMap, key: unknown): boolean {
  if (map.size === 0) return false;
  const buckets = map.buckets;
  if (typeof key === "number") {
    if (key === key) {
      if (buckets !== undefined) {
        let entry =
          buckets[(Math.imul(key >>> 0, 0x9e3779b1) >>> 0) & map.mask];
        while (entry !== undefined) {
          if (entry.numberKey === key) return true;
          entry = entry.chain;
        }
        return false;
      }
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
    const hash = hashMapString(key);
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
  const bigint = viewBigIntValue(key);
  if (bigint !== undefined)
    return findBigIntEntry(map, bigint, hashBigIntValue(bigint)) !== undefined;
  return findOtherEntry(map, key) !== undefined;
}

export function hasScriptMap(map: ScriptMap, key: unknown): boolean {
  const mask = map.mask;
  if (mask > 0 && typeof key === "number" && key === key) {
    const slot = (Math.imul(key >>> 0, 0x9e3779b1) >>> 0) & mask;
    if (map.numKeys[slot] === key) return true;
    if (map.numKind[slot] !== 3) return false;
  }
  return hasScriptMapSlow(map, key);
}

function getScriptMapSlow(map: ScriptMap, key: unknown): unknown {
  if (map.size === 0) return undefined;
  const buckets = map.buckets;
  if (typeof key === "number") {
    if (key === key) {
      if (buckets !== undefined) {
        let entry =
          buckets[(Math.imul(key >>> 0, 0x9e3779b1) >>> 0) & map.mask];
        while (entry !== undefined) {
          if (entry.numberKey === key) return entry.value;
          entry = entry.chain;
        }
        return undefined;
      }
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
    const hash = hashMapString(key);
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
  const bigint = viewBigIntValue(key);
  if (bigint !== undefined) {
    const found = findBigIntEntry(map, bigint, hashBigIntValue(bigint));
    return found === undefined ? undefined : found.value;
  }
  const found = findOtherEntry(map, key);
  return found === undefined ? undefined : found.value;
}

export function getScriptMap(map: ScriptMap, key: unknown): unknown {
  const mask = map.mask;
  if (mask > 0 && typeof key === "number" && key === key) {
    const slot = (Math.imul(key >>> 0, 0x9e3779b1) >>> 0) & mask;
    const kind = map.numKind[slot];
    if (map.numKeys[slot] === key) {
      if (kind === 1) return map.numVals[slot];
    } else if (kind !== 3) {
      return undefined;
    }
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
      if (buckets !== undefined) {
        const slot = (Math.imul(key >>> 0, 0x9e3779b1) >>> 0) & map.mask;
        let entry = buckets[slot];
        while (entry !== undefined) {
          if (entry.numberKey === key) {
            entry.value = value;
            const numKind = map.numKind;
            const numVals = map.numVals;
            if (map.mask > 0) {
              const kind = numKind[slot];
              if (kind === 1 || kind === 2) {
                if (typeof value === "number") {
                  numVals[slot] = value;
                  numKind[slot] = 1;
                } else {
                  numKind[slot] = 2;
                }
              }
            }
            return false;
          }
          entry = entry.chain;
        }
        const normalized = key === 0 ? 0 : key;
        return insertScriptMapEntry(
          map,
          normalized,
          normalized,
          normalized >>> 0,
          value,
        );
      }
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
    const hash = hashMapString(key);
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
  const bigint = viewBigIntValue(key);
  if (bigint !== undefined) {
    const hash = hashBigIntValue(bigint);
    const existing = findBigIntEntry(map, bigint, hash);
    if (existing !== undefined) {
      existing.value = value;
      return false;
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
  const mask = map.mask;
  if (
    mask > 0 &&
    typeof key === "number" &&
    key === key &&
    typeof value === "number"
  ) {
    const slot = (Math.imul(key >>> 0, 0x9e3779b1) >>> 0) & mask;
    if (map.numKind[slot] === 1 && map.numKeys[slot] === key) {
      map.numVals[slot] = value;
      map.numDirty = true;
      return false;
    }
  }
  return setScriptMapSlow(map, key, value);
}

function addScriptSetSlow(map: ScriptMap, value: unknown): void {
  const buckets = map.buckets;
  if (typeof value === "number") {
    if (value === value) {
      if (buckets !== undefined) {
        let entry =
          buckets[(Math.imul(value >>> 0, 0x9e3779b1) >>> 0) & map.mask];
        while (entry !== undefined) {
          if (entry.numberKey === value) return;
          entry = entry.chain;
        }
        const normalized = value === 0 ? 0 : value;
        insertScriptMapEntry(
          map,
          normalized,
          normalized,
          normalized >>> 0,
          normalized,
        );
        return;
      }
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
    const hash = hashMapString(value);
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
  const bigint = viewBigIntValue(value);
  if (bigint !== undefined) {
    const hash = hashBigIntValue(bigint);
    if (findBigIntEntry(map, bigint, hash) !== undefined) return;
    insertScriptMapEntry(map, value, Number.NaN, hash, value);
    return;
  }
  if (findOtherEntry(map, value) !== undefined) return;
  insertScriptMapEntry(map, value, Number.NaN, 0, value);
}

export function addScriptSet(map: ScriptMap, value: unknown): void {
  const mask = map.mask;
  if (mask > 0 && typeof value === "number" && value === value) {
    const slot = (Math.imul(value >>> 0, 0x9e3779b1) >>> 0) & mask;
    if (map.numKeys[slot] === value) return;
  }
  addScriptSetSlow(map, value);
}

export function deleteScriptMap(map: ScriptMap, key: unknown): boolean {
  if (map.size === 0) return false;
  if (map.numDirty) syncScriptMapNumbers(map);
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
    const hash = hashMapString(key);
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
    const bigint = viewBigIntValue(key);
    entry =
      bigint !== undefined
        ? findBigIntEntry(map, bigint, hashBigIntValue(bigint))
        : findOtherEntry(map, key);
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
    const numKeys = map.numKeys;
    const numVals = map.numVals;
    const numKind = map.numKind;
    if (map.mask > 0) {
      const head = buckets[bucket];
      if (head === undefined) {
        numKeys[bucket] = Number.NaN;
        numKind[bucket] = 0;
      } else if (
        head.chain === undefined &&
        head.numberKey === head.numberKey
      ) {
        numKeys[bucket] = head.numberKey;
        const val = head.value;
        if (typeof val === "number") {
          numVals[bucket] = val;
          numKind[bucket] = 1;
        } else {
          numKind[bucket] = 2;
        }
      } else {
        numKeys[bucket] = Number.NaN;
        numKind[bucket] = 3;
      }
    }
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
  map.numKeys = noNumKeys;
  map.numVals = noNumVals;
  map.numKind = noNumKind;
  map.numDirty = false;
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
  if (map.numDirty) syncScriptMapNumbers(map);
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
  const map = cursor.map;
  if (map !== undefined && map.numDirty) syncScriptMapNumbers(map);
  return entry.value;
}

/** Zero-capture inlineable fast paths for hot loop collection calls.
 * Each helper takes typed numbers and uses only non-optional typed arrays and
 * builtin intrinsics so the IR inliner expands them directly into untyped
 * script loops. */
export function scriptMapHasFast(map: ScriptMap, key: number): number {
  const mask = map.mask;
  if (mask > 0 && key === key) {
    const slot = (Math.imul(key >>> 0, 0x9e3779b1) >>> 0) & mask;
    if (map.numKeys[slot] === key) return 1;
    if (map.numKind[slot] !== 3) return 0;
  }
  return -1;
}

export function scriptMapGetFast(
  map: ScriptMap,
  key: number,
): number | undefined {
  const mask = map.mask;
  if (mask > 0 && key === key) {
    const slot = (Math.imul(key >>> 0, 0x9e3779b1) >>> 0) & mask;
    if (map.numKeys[slot] === key && map.numKind[slot] === 1)
      return map.numVals[slot];
  }
  return undefined;
}

export function scriptMapSetFast(
  map: ScriptMap,
  key: number,
  value: number,
): boolean {
  const mask = map.mask;
  if (mask > 0 && key === key) {
    const slot = (Math.imul(key >>> 0, 0x9e3779b1) >>> 0) & mask;
    if (map.numKind[slot] === 1 && map.numKeys[slot] === key) {
      map.numVals[slot] = value;
      map.numDirty = true;
      return true;
    }
  }
  return false;
}

export function scriptSetAddFast(map: ScriptMap, value: number): boolean {
  const mask = map.mask;
  if (mask > 0 && value === value) {
    const slot = (Math.imul(value >>> 0, 0x9e3779b1) >>> 0) & mask;
    if (map.numKeys[slot] === value) return true;
  }
  return false;
}

export {
  getScriptMap as scriptMapGet,
  hasScriptMap as scriptMapHas,
  setScriptMap as scriptMapSet,
  addScriptSet as scriptSetAdd,
};
