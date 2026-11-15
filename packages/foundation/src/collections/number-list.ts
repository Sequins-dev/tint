/** Low-level representation: callers mutate it only through the exported operations. */
export interface NumberList {
  length: number;
  values: Float64Array;
  // Dense lists (no `present`) hold a number at every index below length.
  // The first hole or stored undefined makes the list holey: `present` then
  // covers the capacity with 0: hole; 1: numeric payload; 2: present
  // undefined. Dense lists allocate no presence storage.
  present: Uint8Array | undefined;
}
// Largest Float64Array extent below the native allocator's aligned uint32 bound.
const maximumCapacity = 536870906;
function validIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < 0xffffffff;
}
export function createNumberList(capacity: number): NumberList {
  if (!Number.isInteger(capacity) || capacity < 0 || capacity > maximumCapacity)
    throw "INVALID_CAPACITY";
  return {
    length: 0,
    values: new Float64Array(capacity),
    present: undefined,
  };
}
/** Switches a dense list to explicit presence; dense length never exceeds capacity. */
function makeHoley(list: NumberList): Uint8Array {
  const present = new Uint8Array(list.values.length);
  present.fill(1, 0, list.length);
  list.present = present;
  return present;
}
function reserve(list: NumberList, required: number): void {
  if (required <= list.values.length) return;
  if (required > maximumCapacity) throw "CAPACITY_LIMIT";
  let capacity = list.values.length;
  if (capacity < 4) capacity = 4;
  while (capacity < required) {
    if (capacity > maximumCapacity / 2) {
      capacity = required;
      break;
    }
    capacity *= 2;
  }
  const values = new Float64Array(capacity);
  // Only live cells are observable: dense reads stop at length and holey reads
  // consult presence, which shrink/pop/delete clear, so copying stale payloads
  // cannot resurrect old entries. Matching typed-array encodings lower to the
  // checked bulk mover.
  values.set(list.values);
  const holey = list.present;
  if (holey === undefined) list.values = values;
  else {
    const present = new Uint8Array(capacity);
    present.set(holey);
    // Publish only after both allocations and copying have completed.
    list.values = values;
    list.present = present;
  }
}
export function readNumberList(
  list: NumberList,
  index: number,
): number | undefined {
  // Typed-array reads at fractional, negative or out-of-range indexes are
  // undefined. Dense cells below length are numbers; holey lists have no
  // present marker beyond length. One element read keeps this within the
  // inliner's small-CFG bound.
  const present = list.present;
  const numeric =
    present === undefined ? index < list.length : present[index] === 1;
  return numeric ? list.values[index] : undefined;
}
export function writeNumberList(
  list: NumberList,
  index: number,
  value: number | undefined,
): void {
  if (!validIndex(index)) throw "INVALID_INDEX";
  if (
    list.present === undefined &&
    (value === undefined || index > list.length)
  )
    makeHoley(list);
  reserve(list, index + 1);
  // Reserve may replace the presence storage.
  const present = list.present;
  if (value === undefined) {
    if (present === undefined) throw "number list presence invariant";
    present[index] = 2;
  } else {
    list.values[index] = value;
    if (present !== undefined) present[index] = 1;
  }
  if (index >= list.length) list.length = index + 1;
}
export function pushNumberList(
  list: NumberList,
  value: number | undefined,
): number {
  // Appending a number within capacity keeps a dense list dense.
  const index = list.length;
  if (
    list.present === undefined &&
    value !== undefined &&
    index < list.values.length
  ) {
    list.values[index] = value;
    list.length = index + 1;
    return index + 1;
  }
  writeNumberList(list, index, value);
  return list.length;
}
export function popNumberList(list: NumberList): number | undefined {
  if (list.length === 0) return undefined;
  const index = list.length - 1,
    value = readNumberList(list, index),
    present = list.present;
  if (present !== undefined) present[index] = 0;
  list.length = index;
  return value;
}
export function resizeNumberList(list: NumberList, length: number): void {
  if (!Number.isInteger(length) || length < 0 || length > 0xffffffff)
    throw "INVALID_LENGTH";
  if (length === 0) {
    // An empty list has no holes.
    list.present = undefined;
    list.length = 0;
    return;
  }
  const present = list.present;
  if (present === undefined) {
    // Growth exposes holes.
    if (length > list.length) makeHoley(list);
  } else present.fill(0, length, list.length);
  list.length = length;
}

export function lengthNumberList(list: NumberList): number {
  return list.length;
}

export function hasNumberList(list: NumberList, index: number): boolean {
  const present = list.present;
  if (present === undefined)
    return Number.isInteger(index) && index >= 0 && index < list.length;
  // Presence alone decides, as in readNumberList.
  const marker = present[index];
  return marker === 1 || marker === 2;
}
export function deleteNumberList(list: NumberList, index: number): boolean {
  if (!hasNumberList(list, index)) return false;
  (list.present ?? makeHoley(list))[index] = 0;
  return true;
}
