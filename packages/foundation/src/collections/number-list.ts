/** Low-level representation: callers mutate it only through the exported operations. */
export interface NumberList {
  length: number;
  values: Float64Array;
  // 0: hole; 1: numeric payload; 2: present undefined.
  present: Uint8Array;
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
    present: new Uint8Array(capacity),
  };
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
  const values = new Float64Array(capacity),
    present = new Uint8Array(capacity);
  // Presence alone determines whether a payload is observable. Shrink/pop/delete
  // clear it, so copying unused numeric payloads cannot resurrect old entries.
  // Matching typed-array encodings lower to the checked bulk mover.
  values.set(list.values);
  present.set(list.present);
  // Publish only after both allocations and copying have completed.
  list.values = values;
  list.present = present;
}
export function readNumberList(
  list: NumberList,
  index: number,
): number | undefined {
  if (!validIndex(index) || index >= list.length || list.present[index] !== 1)
    return undefined;
  return list.values[index];
}
export function writeNumberList(
  list: NumberList,
  index: number,
  value: number | undefined,
): void {
  if (!validIndex(index)) throw "INVALID_INDEX";
  reserve(list, index + 1);
  if (value === undefined) list.present[index] = 2;
  else {
    list.values[index] = value;
    list.present[index] = 1;
  }
  if (index >= list.length) list.length = index + 1;
}
export function pushNumberList(
  list: NumberList,
  value: number | undefined,
): number {
  writeNumberList(list, list.length, value);
  return list.length;
}
export function popNumberList(list: NumberList): number | undefined {
  if (list.length === 0) return undefined;
  const index = list.length - 1,
    value = readNumberList(list, index);
  list.present[index] = 0;
  list.length = index;
  return value;
}
export function resizeNumberList(list: NumberList, length: number): void {
  if (!Number.isInteger(length) || length < 0 || length > 0xffffffff)
    throw "INVALID_LENGTH";
  list.present.fill(0, length, list.length);
  list.length = length === 0 ? 0 : length;
}

export function lengthNumberList(list: NumberList): number {
  return list.length;
}

export function hasNumberList(list: NumberList, index: number): boolean {
  if (
    !validIndex(index) ||
    index >= list.length ||
    index >= list.present.length
  )
    return false;
  return list.present[index] === 1 || list.present[index] === 2;
}
export function deleteNumberList(list: NumberList, index: number): boolean {
  if (!hasNumberList(list, index)) return false;
  list.present[index] = 0;
  return true;
}
