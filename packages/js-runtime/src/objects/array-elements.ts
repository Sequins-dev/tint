import {
  valueField,
  writableField,
  enumerableField,
  configurableField,
  type Descriptor,
  type DescriptorUpdate,
} from "../descriptors/index.ts";
import type { ObjectInternalMethods } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";

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
  /** Cached shared exotic methods for arrays sharing these hooks. */
  internalMethods?: ObjectInternalMethods<Key, Value> | undefined;
}

/** Packed own elements of an array exotic object. While present, indices
 * `0..count-1` are writable, enumerable and configurable data properties and no
 * other array index is an own property; the property map holds no index key and
 * no "length" key (stored inline here), and the object has no property contract
 * (attaching one unpacks them).
 *
 * Elements start as binary64 numbers and move to general storage at the first
 * element that is not a Number. Generated code reads and overwrites the number
 * elements in place (IR element-load and element-store), which is why the
 * count of number elements doubles as their kind: it is zero once `values`
 * holds the elements. General elements each have their own cell, which an
 * overwrite updates in place (also from generated code); cells are never
 * shared between arrays. */
export interface ElementCell<Value> {
  elementValue: Value;
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
  /** The value of the array's own non-configurable, non-enumerable "length"
   * property (at least the count). */
  length: number;
  /** Whether the array's own "length" property is writable. */
  lengthWritable: boolean;
}

const dataFields =
  valueField | writableField | enumerableField | configurableField;
// Number storage of every array with no room for numbers: elements that are
// not numbers, or none yet. It has no cells to write, so arrays share it and
// creating an array allocates no storage.
export const noNumbers = new Float64Array(0);
// Initial and minimum grown capacity of number storage.
export const firstCapacity = 4;
// Largest Float64Array extent below the native allocator's aligned uint32 bound.
const maximumCapacity = 536870906;

export function createArrayElements<Key, Value>(
  keys: ArrayObjectHooks<Key, Value>,
  undefinedValue: Value,
  length: number = 0,
): ArrayElements<Key, Value> {
  return {
    keys,
    undefinedValue,
    numberCount: 0,
    numbers: noNumbers,
    values: undefined,
    length: length === 0 ? 0 : length,
    lengthWritable: true,
  };
}

/** Create packed Script array elements directly from an argument slice without
 * per-element descriptor or hook dispatch. */
export function createArrayElementsFromList(
  keys: ArrayObjectHooks<ScriptPropertyKey, unknown>,
  undefinedValue: unknown,
  args: readonly unknown[],
  start: number,
  length: number,
): ArrayElements<ScriptPropertyKey, unknown> {
  if (length === 0)
    return createArrayElements<ScriptPropertyKey, unknown>(
      keys,
      undefinedValue,
      0,
    );
  const first = args[start];
  if (typeof first === "number" && length <= maximumCapacity) {
    const capacity = length < firstCapacity ? firstCapacity : length;
    const numbers = new Float64Array(capacity);
    numbers[0] = first;
    let index = 1;
    while (index < length) {
      const item = args[start + index];
      if (typeof item !== "number") break;
      numbers[index] = item;
      index++;
    }
    if (index === length)
      return {
        keys,
        undefinedValue,
        numberCount: length,
        numbers,
        values: undefined,
        length,
        lengthWritable: true,
      };
    const values: ElementCell<unknown>[] = [];
    for (let i = 0; i < index; i++) {
      const number = numbers[i];
      if (number === undefined) throw "ARRAY_ELEMENTS_INVARIANT";
      values.push({ elementValue: number });
    }
    for (let i = index; i < length; i++)
      values.push({ elementValue: args[start + i] });
    return {
      keys,
      undefinedValue,
      numberCount: 0,
      numbers: noNumbers,
      values,
      length,
      lengthWritable: true,
    };
  }
  const values: ElementCell<unknown>[] = [];
  for (let i = 0; i < length; i++)
    values.push({ elementValue: args[start + i] });
  return {
    keys,
    undefinedValue,
    numberCount: 0,
    numbers: noNumbers,
    values,
    length,
    lengthWritable: true,
  };
}

/** The ordinary descriptor of the array's own "length" property. */
export function arrayLengthDescriptor<Key, Value>(
  elements: ArrayElements<Key, Value>,
): Descriptor<Value> {
  const undefinedValue = elements.undefinedValue;
  return {
    accessor: false,
    value: elements.keys.fromNumber(elements.length),
    writable: elements.lengthWritable,
    enumerable: false,
    configurable: false,
    get: undefinedValue,
    set: undefinedValue,
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
  return cell.elementValue;
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
      converted.push({ elementValue: elements.keys.fromNumber(number) });
    }
    elements.values = converted;
    elements.numberCount = 0;
    elements.numbers = noNumbers;
  }
  const values = elements.values;
  if (values === undefined || index > values.length)
    throw "ARRAY_ELEMENTS_INVARIANT";
  const cell = values[index];
  if (cell !== undefined) cell.elementValue = value;
  else values.push({ elementValue: value });
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
