import {
  gcEpoch,
  hashString,
  referenceHash,
  usesAddressHash,
} from "./key-index.ts";
export { gcEpoch, referenceHash, usesAddressHash } from "./key-index.ts";

// An insertion-ordered hash set in the style of linked-map (Close's
// deterministic tables): entries form one insertion-order list, and once the
// set outgrows a linear walk each bucket chains its entries directly, so a
// lookup is one bucket read plus a short pointer walk. There are no closures
// or nested indexes: set state is ordinary record fields.
interface SetEntry<T> {
  readonly value: T;
  hash: number;
  readonly order: number;
  next: SetEntry<T> | undefined;
  previous: SetEntry<T> | undefined;
  /** The next entry in the same bucket. */
  chain: SetEntry<T> | undefined;
}
/** Insertion-ordered members. String, number and BigInt members hash by value;
 * managed references hash by epoch-scoped address and rehash in place on GC. */
export interface LinkedSet<T> {
  head: SetEntry<T> | undefined;
  tail: SetEntry<T> | undefined;
  size: number;
  order: number;
  /** Bucket heads once the set outgrows a linear walk; length is a power of
   * two; bucket indexes mask hashes with length - 1. */
  buckets: (SetEntry<T> | undefined)[] | undefined;
  /** GC epoch at which address-hashed entries and buckets were last built. */
  hashEpoch: number;
}
// Sets up to this size are searched linearly through the order list.
const linearLimit = 8;
function valueFallbackHash(value: unknown): number {
  if (typeof value === "string") return hashString(value);
  return typeof value === "number" ? value >>> 0 : 0;
}
function valueHash<T>(value: T): number {
  const hash = referenceHash(value);
  if (hash !== 0) return hash;
  return valueFallbackHash(value);
}
/** Murmur3's finalizer spreads sequential and patterned hashes across
 * power-of-two buckets. */
function bucketOf(hash: number, mask: number): number {
  let mixed = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
  return ((mixed ^ (mixed >>> 16)) >>> 0) & mask;
}
export function createSet<T>(): LinkedSet<T> {
  return {
    head: undefined,
    tail: undefined,
    size: 0,
    order: 0,
    buckets: undefined,
    hashEpoch: gcEpoch(),
  };
}
function findSet<T>(
  set: LinkedSet<T>,
  value: T,
  hash: number,
): SetEntry<T> | undefined {
  const buckets = set.buckets;
  let entry: SetEntry<T> | undefined;
  if (buckets !== undefined) {
    entry = buckets[bucketOf(hash, buckets.length - 1)];
    while (entry !== undefined) {
      if (
        entry.hash === hash &&
        (entry.value === value ||
          (entry.value !== entry.value && value !== value))
      )
        return entry;
      entry = entry.chain;
    }
    return undefined;
  }
  entry = set.head;
  while (entry !== undefined) {
    if (
      entry.hash === hash &&
      (entry.value === value ||
        (entry.value !== entry.value && value !== value))
    )
      return entry;
    entry = entry.next;
  }
  return undefined;
}
/** Recompute address-based hashes and bucket chains in place (zero allocations)
 * after a moving GC cycle. */
function rehashInPlace<T>(set: LinkedSet<T>): void {
  const buckets = set.buckets;
  if (buckets !== undefined) {
    const capacity = buckets.length;
    for (let i = 0; i < capacity; i++) buckets[i] = undefined;
  }
  const epoch = gcEpoch();
  const mask = buckets === undefined ? 0 : buckets.length - 1;
  let entry = set.head;
  while (entry !== undefined) {
    const hash = valueHash<T>(entry.value);
    entry.hash = hash;
    if (buckets !== undefined) {
      const bucket = bucketOf(hash, mask);
      entry.chain = buckets[bucket];
      buckets[bucket] = entry;
    }
    entry = entry.next;
  }
  set.hashEpoch = epoch;
}
/** Rebuild the buckets for at least `size` entries (load factor <= 1). */
function rebuild<T>(set: LinkedSet<T>, size: number): void {
  let capacity = 16;
  while (capacity < size) capacity *= 2;
  const buckets: (SetEntry<T> | undefined)[] = [],
    mask = capacity - 1;
  for (let i = 0; i < capacity; i++) buckets.push(undefined);
  const head = set.head;
  const rehash = head !== undefined && usesAddressHash(head.value);
  const epoch = rehash ? gcEpoch() : set.hashEpoch;
  let entry = head;
  while (entry !== undefined) {
    const hash = rehash ? valueHash<T>(entry.value) : entry.hash;
    if (rehash) entry.hash = hash;
    const bucket = bucketOf(hash, mask);
    entry.chain = buckets[bucket];
    buckets[bucket] = entry;
    entry = entry.next;
  }
  set.hashEpoch = epoch;
  set.buckets = buckets;
}
export function hasSet<T>(set: LinkedSet<T>, value: T): boolean {
  if (usesAddressHash(value) && set.hashEpoch !== gcEpoch())
    rehashInPlace<T>(set);
  return findSet<T>(set, value, valueHash<T>(value)) !== undefined;
}
/** Return whether a new member was added. Duplicate insertion does not allocate. */
export function addSet<T>(set: LinkedSet<T>, value: T): boolean {
  if (usesAddressHash(value) && set.hashEpoch !== gcEpoch())
    rehashInPlace<T>(set);
  const hash = valueHash<T>(value);
  if (findSet<T>(set, value, hash) !== undefined) return false;
  appendSet<T>(set, value, hash);
  if (usesAddressHash(value) && set.hashEpoch !== gcEpoch())
    rehashInPlace<T>(set);
  return true;
}
/** Append an already unique member. Keep ownership/order updates shared by
 * insertion and cloning without repeating a membership search during a copy. */
function appendSet<T>(set: LinkedSet<T>, value: T, hash: number): void {
  if (set.order >= 9007199254740991) throw "SET_ORDER_LIMIT";
  const order = set.order + 1,
    tail = set.tail;
  const entry: SetEntry<T> = {
    value,
    hash,
    order,
    next: undefined,
    previous: tail,
    chain: undefined,
  };
  if (tail === undefined) set.head = entry;
  else tail.next = entry;
  set.order = order;
  set.tail = entry;
  set.size = set.size + 1;
  const buckets = set.buckets;
  if (buckets !== undefined) {
    if (set.size > buckets.length) rebuild<T>(set, set.size);
    else {
      const bucket = bucketOf(hash, buckets.length - 1);
      entry.chain = buckets[bucket];
      buckets[bucket] = entry;
    }
  } else if (set.size > linearLimit) rebuild<T>(set, set.size);
}
/** Copy the live insertion sequence in linear time. Links and order counters are
 * independent; member values retain their identity. The source is not mutated. */
export function cloneSet<T>(source: LinkedSet<T>): LinkedSet<T> {
  const result = createSet<T>();
  let entry = source.head;
  while (entry !== undefined) {
    const value = entry.value;
    appendSet<T>(
      result,
      value,
      usesAddressHash(value) ? valueHash<T>(value) : entry.hash,
    );
    entry = entry.next;
  }
  const head = result.head;
  if (
    head !== undefined &&
    usesAddressHash(head.value) &&
    result.hashEpoch !== gcEpoch()
  )
    rehashInPlace<T>(result);
  return result;
}
export function deleteSet<T>(set: LinkedSet<T>, value: T): boolean {
  if (usesAddressHash(value) && set.hashEpoch !== gcEpoch())
    rehashInPlace<T>(set);
  const entry = findSet<T>(set, value, valueHash<T>(value));
  if (entry === undefined) return false;
  const buckets = set.buckets;
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
  if (previous === undefined) set.head = next;
  else previous.next = next;
  if (next === undefined) set.tail = previous;
  else next.previous = previous;
  set.size = set.size - 1;
  return true;
}
export function clearSet<T>(set: LinkedSet<T>): void {
  set.head = undefined;
  set.tail = undefined;
  set.size = 0;
  set.buckets = undefined;
  set.hashEpoch = gcEpoch();
}
export function sizeSet<T>(set: LinkedSet<T>): number {
  return set.size;
}

/** Cursor state is private to these operations; exhaustion releases the set. */
export interface SetCursor<T> {
  set: LinkedSet<T> | undefined;
  after: number;
  current: SetEntry<T> | undefined;
  next: SetEntry<T> | undefined;
  tail: SetEntry<T> | undefined;
  size: number;
}
export function createSetCursor<T>(set: LinkedSet<T>): SetCursor<T> {
  return {
    set,
    after: 0,
    current: undefined,
    next: set.head,
    tail: set.tail,
    size: set.size,
  };
}
export function advanceSetCursor<T>(cursor: SetCursor<T>): boolean {
  const set = cursor.set;
  cursor.current = undefined;
  if (set === undefined) return false;
  // Without structural changes, the next live link is already known. Tail
  // identity and size together detect every change to the surviving sequence:
  // additions append fresh tail nodes, while deletion alone reduces its size.
  let selected = cursor.next;
  if (cursor.tail !== set.tail || cursor.size !== set.size) {
    selected = set.head;
    while (selected !== undefined && selected.order <= cursor.after)
      selected = selected.next;
  }
  if (selected === undefined) {
    cursor.set = undefined;
    cursor.next = undefined;
    cursor.tail = undefined;
    return false;
  }
  cursor.next = selected.next;
  cursor.tail = set.tail;
  cursor.size = set.size;
  cursor.current = selected;
  cursor.after = selected.order;
  return true;
}
export function readSetCursor<T>(cursor: SetCursor<T>): T {
  const entry = cursor.current;
  if (entry === undefined) throw "SET_CURSOR_NOT_POSITIONED";
  return entry.value;
}
