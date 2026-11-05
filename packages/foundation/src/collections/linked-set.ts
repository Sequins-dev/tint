interface SetEntry<T> {
  readonly value: T;
  readonly order: number;
  next: SetEntry<T> | undefined;
}
export interface LinkedSet<T> {
  head: SetEntry<T> | undefined;
  tail: SetEntry<T> | undefined;
  size: number;
  order: number;
}
export function createSet<T>(): LinkedSet<T> {
  return { head: undefined, tail: undefined, size: 0, order: 0 };
}
export function hasSet<T>(set: LinkedSet<T>, value: T): boolean {
  let entry = set.head;
  while (entry !== undefined) {
    if (
      entry.value === value ||
      (entry.value !== entry.value && value !== value)
    )
      return true;
    entry = entry.next;
  }
  return false;
}
/** Return whether a new member was added. Duplicate insertion does not allocate. */
export function addSet<T>(set: LinkedSet<T>, value: T): boolean {
  if (hasSet<T>(set, value)) return false;
  appendSet<T>(set, value);
  return true;
}
/** Append an already unique member. Keep ownership/order updates shared by
 * insertion and cloning without repeating a membership search during a copy. */
function appendSet<T>(set: LinkedSet<T>, value: T): void {
  if (set.order >= 9007199254740991) throw "SET_ORDER_LIMIT";
  const order = set.order + 1;
  const entry: SetEntry<T> = { value, next: undefined, order };
  const tail = set.tail;
  if (tail === undefined) set.head = entry;
  else tail.next = entry;
  set.order = order;
  set.tail = entry;
  set.size = set.size + 1;
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
  let entry = set.head;
  let previous: SetEntry<T> | undefined = undefined;
  while (entry !== undefined) {
    if (
      entry.value === value ||
      (entry.value !== entry.value && value !== value)
    ) {
      if (previous === undefined) set.head = entry.next;
      else previous.next = entry.next;
      if (set.tail === entry) set.tail = previous;
      set.size = set.size - 1;
      return true;
    }
    previous = entry;
    entry = entry.next;
  }
  return false;
}
export function clearSet<T>(set: LinkedSet<T>): void {
  set.head = undefined;
  set.tail = undefined;
  set.size = 0;
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
