import { createKeyIndex, hashString, type KeyIndex } from "./key-index.ts";

interface SetEntry<T> {
  readonly value: T;
  readonly order: number;
  next: SetEntry<T> | undefined;
  previous: SetEntry<T> | undefined;
}
/** Insertion-ordered members. Once more than eight string or number members
 * exist they are also indexed by value; other members have no stable hash and
 * are found by walking the links. */
export interface LinkedSet<T> {
  head: SetEntry<T> | undefined;
  tail: SetEntry<T> | undefined;
  size: number;
  order: number;
  index: KeyIndex<T, SetEntry<T>> | undefined;
  /** String and number members, counted until the index exists. */
  hashable: number;
}
function hashable(value: unknown): boolean {
  return typeof value === "string" || typeof value === "number";
}
function valueHash(value: unknown): number {
  if (typeof value === "string") return hashString(value);
  return typeof value === "number" ? value >>> 0 : 0;
}
export function createSet<T>(): LinkedSet<T> {
  return {
    head: undefined,
    tail: undefined,
    size: 0,
    order: 0,
    index: undefined,
    hashable: 0,
  };
}
function findSet<T>(set: LinkedSet<T>, value: T): SetEntry<T> | undefined {
  const index = set.index;
  if (index !== undefined && hashable(value)) return index.get(value);
  let entry = set.head;
  while (entry !== undefined) {
    if (
      entry.value === value ||
      (entry.value !== entry.value && value !== value)
    )
      return entry;
    entry = entry.next;
  }
  return undefined;
}
export function hasSet<T>(set: LinkedSet<T>, value: T): boolean {
  return findSet<T>(set, value) !== undefined;
}
/** Return whether a new member was added. Duplicate insertion does not allocate. */
export function addSet<T>(set: LinkedSet<T>, value: T): boolean {
  if (findSet<T>(set, value) !== undefined) return false;
  appendSet<T>(set, value);
  return true;
}
/** Append an already unique member. Keep ownership/order updates shared by
 * insertion and cloning without repeating a membership search during a copy. */
function appendSet<T>(set: LinkedSet<T>, value: T): void {
  if (set.order >= 9007199254740991) throw "SET_ORDER_LIMIT";
  const order = set.order + 1;
  const tail = set.tail;
  const entry: SetEntry<T> = { value, next: undefined, previous: tail, order };
  if (tail === undefined) set.head = entry;
  else tail.next = entry;
  set.order = order;
  set.tail = entry;
  set.size = set.size + 1;
  if (!hashable(value)) return;
  const index = set.index;
  if (index !== undefined) index.set(value, entry);
  else if (++set.hashable > 8) {
    // Publish the index only after every hashable member is in it.
    const promoted = createKeyIndex<T, SetEntry<T>>((key: T): number =>
      valueHash(key),
    );
    let current = set.head;
    while (current !== undefined) {
      if (hashable(current.value)) promoted.set(current.value, current);
      current = current.next;
    }
    set.index = promoted;
  }
}
/** Copy the live insertion sequence in linear time. Links and order counters are
 * independent; member values retain their identity. The source is not mutated. */
export function cloneSet<T>(source: LinkedSet<T>): LinkedSet<T> {
  const result = createSet<T>();
  let entry = source.head;
  while (entry !== undefined) {
    appendSet<T>(result, entry.value);
    entry = entry.next;
  }
  return result;
}
export function deleteSet<T>(set: LinkedSet<T>, value: T): boolean {
  const entry = findSet<T>(set, value);
  if (entry === undefined) return false;
  const index = set.index;
  if (index !== undefined && hashable(value)) index.delete(value);
  else if (hashable(value)) set.hashable = set.hashable - 1;
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
  set.index = undefined;
  set.hashable = 0;
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
