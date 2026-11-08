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
 * other array index is an own property; the property map holds no index key.
 * Exactly one of `numbers` and `values` is defined. */
export interface ArrayElements<Key, Value> {
  readonly keys: ArrayObjectHooks<Key, Value>;
  readonly undefinedValue: Value;
  numbers: number[] | undefined;
  values: Value[] | undefined;
}

const dataFields =
  valueField | writableField | enumerableField | configurableField;

export function createArrayElements<Key, Value>(
  keys: ArrayObjectHooks<Key, Value>,
  undefinedValue: Value,
): ArrayElements<Key, Value> {
  const numbers: number[] = [];
  return { keys, undefinedValue, numbers, values: undefined };
}

export function arrayElementCount<Key, Value>(
  elements: ArrayElements<Key, Value>,
): number {
  const numbers = elements.numbers;
  if (numbers !== undefined) return numbers.length;
  const values = elements.values;
  if (values === undefined) throw "ARRAY_ELEMENTS_INVARIANT";
  return values.length;
}

/** The caller has checked `index < count`. */
export function readArrayElement<Key, Value>(
  elements: ArrayElements<Key, Value>,
  index: number,
): Value {
  const numbers = elements.numbers;
  if (numbers !== undefined) {
    const value = numbers[index];
    if (value === undefined) throw "ARRAY_ELEMENTS_INVARIANT";
    return elements.keys.fromNumber(value);
  }
  const values = elements.values;
  if (values === undefined || index >= values.length)
    throw "ARRAY_ELEMENTS_INVARIANT";
  const value = values[index];
  // Value may itself include undefined, which is a valid stored element.
  return value === undefined ? elements.undefinedValue : value;
}

/** Overwrite a present element or append at `count`. */
export function writeArrayElement<Key, Value>(
  elements: ArrayElements<Key, Value>,
  index: number,
  value: Value,
): void {
  const numbers = elements.numbers;
  if (numbers !== undefined) {
    const payload = elements.keys.numberPayload(value);
    if (payload !== undefined) {
      numbers[index] = payload;
      return;
    }
    // The first non-number element moves every number to generic storage once.
    const values: Value[] = [];
    for (let i = 0; i < numbers.length; i++) {
      const number = numbers[i];
      if (number === undefined) throw "ARRAY_ELEMENTS_INVARIANT";
      values.push(elements.keys.fromNumber(number));
    }
    elements.values = values;
    elements.numbers = undefined;
  }
  const values = elements.values;
  if (values === undefined) throw "ARRAY_ELEMENTS_INVARIANT";
  values[index] = value;
}

/** Remove elements at and above `count`; every packed element is configurable. */
export function truncateArrayElements<Key, Value>(
  elements: ArrayElements<Key, Value>,
  count: number,
): void {
  if (count >= arrayElementCount<Key, Value>(elements)) return;
  const numbers = elements.numbers;
  if (numbers !== undefined) numbers.length = count;
  else {
    const values = elements.values;
    if (values === undefined) throw "ARRAY_ELEMENTS_INVARIANT";
    values.length = count;
  }
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
