import {
  valueField,
  writableField,
  enumerableField,
  configurableField,
  type Descriptor,
  type DescriptorUpdate,
} from "../descriptors/index.ts";

/** Embedding conversions for array exotic objects. `index`, `indexKey`,
 * `numberPayload` and `fromNumber` are pure and are also used by packed
 * elements; only `toNumber` and `rangeError` may involve user code. */
export interface ArrayObjectHooks<Key, Value> {
  readonly lengthKey: Key;
  /** Canonical array index, or a negative value for a non-index property. */
  readonly index: (key: Key) => number;
  /** Inverse of `index` for canonical array indices. */
  readonly indexKey: (index: number) => Key;
  /** The payload of a Number primitive; undefined for every other value. */
  readonly numberPayload: (value: Value) => number | undefined;
  /** Implements ToNumber, including user coercion and abrupt completion. */
  readonly toNumber: (value: Value) => number;
  readonly fromNumber: (value: number) => Value;
  readonly rangeError: () => Value;
}

/** Packed own elements of an array exotic object. While present, indices
 * `0..count-1` are writable, enumerable and configurable data properties and no
 * other array index is an own property; the property map holds no index key,
 * and the object has no property contract (attaching one unpacks them).
 *
 * Elements start as binary64 numbers and move to general storage at the first
 * element that is not a Number. Generated code reads and overwrites the number
 * elements in place (IR element-load and element-store), which is why the
 * count of number elements doubles as their kind: it is zero once `values`
 * holds the elements. General elements each have their own cell, which an
 * overwrite updates in place (also from generated code); cells are never
 * shared between arrays. */
export interface ElementCell<Value> {
  value: Value;
}
export interface ArrayElements<Key, Value> {
  readonly keys: ArrayObjectHooks<Key, Value>;
  readonly undefinedValue: Value;
  /** While `values` is undefined, the element count: elements are
   * `numbers[0..numberCount-1]`. Zero once `values` holds the elements. */
  numberCount: number;
  /** Number storage; its length is the capacity (at least numberCount). */
  numbers: Float64Array;
  /** General storage, once any element was not a Number. */
  values: ElementCell<Value>[] | undefined;
  /** The value of the array's "length" (at least the count), mirrored by
   * every length definition so the runtime's length read takes it here
   * instead of looking the property up. */
  length: number;
}

const dataFields =
  valueField | writableField | enumerableField | configurableField;
// Number storage of every array with no room for numbers: elements that are
// not numbers, or none yet. It has no cells to write, so arrays share it and
// creating an array allocates no storage.
const noNumbers = new Float64Array(0);
// Initial and minimum grown capacity of number storage.
const firstCapacity = 4;
// Largest Float64Array extent below the native allocator's aligned uint32 bound.
const maximumCapacity = 536870906;

export function createArrayElements<Key, Value>(
  keys: ArrayObjectHooks<Key, Value>,
  undefinedValue: Value,
): ArrayElements<Key, Value> {
  return {
    keys,
    undefinedValue,
    numberCount: 0,
    numbers: noNumbers,
    values: undefined,
    length: 0,
  };
}

export function arrayElementCount<Key, Value>(
  elements: ArrayElements<Key, Value>,
): number {
  const values = elements.values;
  return values === undefined ? elements.numberCount : values.length;
}

/** The caller has checked `index < count`. */
export function readArrayElement<Key, Value>(
  elements: ArrayElements<Key, Value>,
  index: number,
): Value {
  const values = elements.values;
  if (values === undefined) {
    if (index >= elements.numberCount) throw "ARRAY_ELEMENTS_INVARIANT";
    const value = elements.numbers[index];
    if (value === undefined) throw "ARRAY_ELEMENTS_INVARIANT";
    return elements.keys.fromNumber(value);
  }
  const cell = values[index];
  if (cell === undefined) throw "ARRAY_ELEMENTS_INVARIANT";
  return cell.value;
}

/** Number storage with room for `required` elements. */
function reserveNumbers<Key, Value>(
  elements: ArrayElements<Key, Value>,
  required: number,
): Float64Array {
  const old = elements.numbers;
  if (required <= old.length) return old;
  if (required > maximumCapacity) throw "ARRAY_ELEMENTS_CAPACITY";
  let capacity = old.length < firstCapacity ? firstCapacity : old.length;
  while (capacity < required)
    capacity = capacity > maximumCapacity / 2 ? maximumCapacity : capacity * 2;
  const numbers = new Float64Array(capacity);
  // Cells past the count are unobservable, so the whole buffer copies.
  numbers.set(old);
  elements.numbers = numbers;
  return numbers;
}

/** Overwrite a present element or append at `count`. */
export function writeArrayElement<Key, Value>(
  elements: ArrayElements<Key, Value>,
  index: number,
  value: Value,
): void {
  if (elements.values === undefined) {
    const count = elements.numberCount;
    if (index > count) throw "ARRAY_ELEMENTS_INVARIANT";
    const payload = elements.keys.numberPayload(value);
    if (payload !== undefined) {
      reserveNumbers<Key, Value>(elements, index + 1)[index] = payload;
      if (index === count) elements.numberCount = count + 1;
      return;
    }
    // The first non-number element moves every number to general storage once.
    const numbers = elements.numbers;
    const converted: ElementCell<Value>[] = [];
    for (let i = 0; i < count; i++) {
      const number = numbers[i];
      if (number === undefined) throw "ARRAY_ELEMENTS_INVARIANT";
      converted.push({ value: elements.keys.fromNumber(number) });
    }
    elements.values = converted;
    elements.numberCount = 0;
    elements.numbers = noNumbers;
  }
  const values = elements.values;
  if (values === undefined || index > values.length)
    throw "ARRAY_ELEMENTS_INVARIANT";
  const cell = values[index];
  if (cell !== undefined) cell.value = value;
  else values.push({ value });
}

/** Remove elements at and above `count`; every packed element is configurable. */
export function truncateArrayElements<Key, Value>(
  elements: ArrayElements<Key, Value>,
  count: number,
): void {
  if (count >= arrayElementCount<Key, Value>(elements)) return;
  const values = elements.values;
  if (values === undefined) elements.numberCount = count;
  else if (count === 0) {
    // An emptied array starts over with number storage.
    elements.values = undefined;
    elements.numberCount = 0;
  } else values.length = count;
}

/** The ordinary descriptor of a present packed element. */
export function arrayElementDescriptor<Key, Value>(
  elements: ArrayElements<Key, Value>,
  index: number,
): Descriptor<Value> {
  const undefinedValue = elements.undefinedValue;
  return {
    accessor: false,
    value: readArrayElement<Key, Value>(elements, index),
    writable: true,
    enumerable: true,
    configurable: true,
    get: undefinedValue,
    set: undefinedValue,
  };
}

/** Whether applying `update` to a present packed element (or creating one at
 * `count`) leaves a writable, enumerable, configurable data property. A newly
 * created property defaults absent attributes to false, so creation requires
 * all three to be supplied as true. */
export function packedElementUpdate<Value>(
  update: DescriptorUpdate<Value>,
  creating: boolean,
): boolean {
  const fields = update.fields;
  if (!Number.isInteger(fields) || fields < 0 || (fields & ~dataFields) !== 0)
    return false;
  if ((fields & writableField) !== 0 ? !update.writable : creating)
    return false;
  if ((fields & enumerableField) !== 0 ? !update.enumerable : creating)
    return false;
  if ((fields & configurableField) !== 0 ? !update.configurable : creating)
    return false;
  return true;
}
