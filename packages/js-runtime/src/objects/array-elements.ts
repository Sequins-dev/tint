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
  readonly fromGeneral: (value: unknown) => Value;
  readonly rangeError: () => Value;
  /** Cached shared exotic methods for arrays sharing these hooks. */
  internalMethods?: ObjectInternalMethods<Key, Value> | undefined;
}

/** Flat reference storage backing general packed array elements. Portably a
 * record wrapping a JS array; natively bound to a GC-traced ReferenceVector
 * (marker 6) storing managed string/reference pointers directly at
 * `nativeArrayInlineOffset + index * 8`. */
export interface GeneralRefStorage {
  readonly slots: unknown[];
}

export function allocGeneralRefs(capacity: number): GeneralRefStorage {
  const slots: unknown[] = [];
  for (let index = 0; index < capacity; index++) slots.push(undefined);
  return { slots };
}

export function copyGeneralRefs(
  source: GeneralRefStorage,
  target: GeneralRefStorage,
  count: number,
): void {
  for (let index = 0; index < count; index++)
    target.slots[index] = source.slots[index];
}

export function clearGeneralRef(refs: GeneralRefStorage, index: number): void {
  refs.slots[index] = undefined;
}

/** Proven-in-bounds read from flat general element storage. Natively bound to
 * IR general-slot-load. Tag byte encoding: 0=undefined, 1=number, 2=false,
 * 3=string, 4=null, 5=reference, 6=true. */
export function readGeneralSlot(
  tags: Uint8Array,
  refs: GeneralRefStorage,
  numbers: Float64Array,
  index: number,
): unknown {
  const tag = tags[index];
  if (tag === 5 || tag === 3) return refs.slots[index];
  if (tag === 1) return numbers[index];
  if (tag === 6) return true;
  if (tag === 2) return false;
  if (tag === 4) return null;
  return undefined;
}

/** Proven-in-bounds write into flat general element storage. Natively bound to
 * IR general-slot-store. Returns false, with nothing written, only when `value`
 * is a Number and `index >= numbers.length` so the caller can lazily allocate
 * `numbers` and retry. */
export function writeGeneralSlot(
  tags: Uint8Array,
  refs: GeneralRefStorage,
  numbers: Float64Array,
  index: number,
  value: unknown,
): boolean {
  if (typeof value === "number") {
    if (index >= numbers.length) return false;
    numbers[index] = value;
    tags[index] = 1;
    refs.slots[index] = undefined;
    return true;
  }
  if (typeof value === "string") {
    refs.slots[index] = value;
    tags[index] = 3;
    return true;
  }
  if (typeof value === "boolean") {
    tags[index] = value ? 6 : 2;
    refs.slots[index] = undefined;
    return true;
  }
  if (value === undefined) {
    tags[index] = 0;
    refs.slots[index] = undefined;
    return true;
  }
  if (value === null) {
    tags[index] = 4;
    refs.slots[index] = undefined;
    return true;
  }
  refs.slots[index] = value;
  tags[index] = 5;
  return true;
}

/** Packed own elements of an array exotic object. While present, indices
 * `0..count-1` are writable, enumerable and configurable data properties and no
 * other array index is an own property; the property map holds no index key and
 * no "length" key (stored inline here), and the object has no property contract
 * (attaching one unpacks them).
 *
 * Elements start as binary64 numbers (`numberCount > 0, generalCount === 0`)
 * and move to flat general storage (`numberCount === 0, generalCount > 0`) at
 * the first element that is not a Number. Generated code reads and overwrites
 * both representations in place (IR element-load/store and
 * general-element-load/store). Pure object/string/boolean/null/undefined
 * general arrays keep `numbers === noNumbers` (zero float64 storage). */
export interface ArrayElements<Key, Value> {
  readonly keys: ArrayObjectHooks<Key, Value>;
  readonly undefinedValue: Value;
  /** While in number mode, the element count (`numbers[0..numberCount-1]`).
   * Zero when empty or in general mode. */
  numberCount: number;
  /** Number storage: capacity >= numberCount in number mode; in general mode,
   * either `noNumbers` (0 length) or capacity >= `generalTags.length`. */
  numbers: Float64Array;
  /** While in general mode, the element count. Zero when empty or in number mode. */
  generalCount: number;
  /** Tag byte per general element (capacity >= generalCount in general mode). */
  generalTags: Uint8Array;
  /** Managed reference vector (capacity === generalTags.length in general mode). */
  generalRefs: GeneralRefStorage;
  /** The value of the array's own non-configurable, non-enumerable "length"
   * property (at least the count). */
  length: number;
  /** Whether the array's own "length" property is writable. */
  lengthWritable: boolean;
}

const dataFields =
  valueField | writableField | enumerableField | configurableField;
// Shared zero-length storages so empty and single-mode arrays allocate nothing extra.
export const noNumbers = new Float64Array(0);
export const noGeneralTags = new Uint8Array(0);
export const noGeneralRefs = allocGeneralRefs(0);
// Initial and minimum grown capacity of packed element storage.
export const firstCapacity = 4;
// Largest Float64Array / ReferenceVector extent below the native allocator's aligned uint32 bound.
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
    generalCount: 0,
    generalTags: noGeneralTags,
    generalRefs: noGeneralRefs,
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
        generalCount: 0,
        generalTags: noGeneralTags,
        generalRefs: noGeneralRefs,
        length,
        lengthWritable: true,
      };
    const generalTags = new Uint8Array(capacity);
    for (let i = 0; i < index; i++) generalTags[i] = 1;
    const generalRefs = allocGeneralRefs(capacity);
    for (let i = index; i < length; i++) {
      if (
        !writeGeneralSlot(generalTags, generalRefs, numbers, i, args[start + i])
      )
        throw "ARRAY_ELEMENTS_INVARIANT";
    }
    return {
      keys,
      undefinedValue,
      numberCount: 0,
      numbers,
      generalCount: length,
      generalTags,
      generalRefs,
      length,
      lengthWritable: true,
    };
  }
  if (length > maximumCapacity) throw "ARRAY_ELEMENTS_CAPACITY";
  const capacity = length < firstCapacity ? firstCapacity : length;
  const generalTags = new Uint8Array(capacity);
  const generalRefs = allocGeneralRefs(capacity);
  let numbers = noNumbers;
  for (let i = 0; i < length; i++) {
    const item = args[start + i];
    if (!writeGeneralSlot(generalTags, generalRefs, numbers, i, item)) {
      numbers = new Float64Array(capacity);
      if (!writeGeneralSlot(generalTags, generalRefs, numbers, i, item))
        throw "ARRAY_ELEMENTS_INVARIANT";
    }
  }
  return {
    keys,
    undefinedValue,
    numberCount: 0,
    numbers,
    generalCount: length,
    generalTags,
    generalRefs,
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
  const general = elements.generalCount;
  return general === 0 ? elements.numberCount : general;
}

/** The caller has checked `index < count`. */
export function readArrayElement<Key, Value>(
  elements: ArrayElements<Key, Value>,
  index: number,
): Value {
  const general = elements.generalCount;
  if (general === 0) {
    if (index >= elements.numberCount) throw "ARRAY_ELEMENTS_INVARIANT";
    const value = elements.numbers[index];
    if (value === undefined) throw "ARRAY_ELEMENTS_INVARIANT";
    return elements.keys.fromNumber(value);
  }
  if (index >= general) throw "ARRAY_ELEMENTS_INVARIANT";
  return elements.keys.fromGeneral(
    readGeneralSlot(
      elements.generalTags,
      elements.generalRefs,
      elements.numbers,
      index,
    ),
  );
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

/** General storage with room for `required` elements. */
export function reserveGeneral<Key, Value>(
  elements: ArrayElements<Key, Value>,
  required: number,
): void {
  const oldTags = elements.generalTags;
  if (required <= oldTags.length) return;
  if (required > maximumCapacity) throw "ARRAY_ELEMENTS_CAPACITY";
  let capacity =
    oldTags.length < firstCapacity ? firstCapacity : oldTags.length;
  while (capacity < required)
    capacity = capacity > maximumCapacity / 2 ? maximumCapacity : capacity * 2;
  const tags = new Uint8Array(capacity);
  tags.set(oldTags);
  const refs = allocGeneralRefs(capacity);
  const count = elements.generalCount;
  if (count > 0) copyGeneralRefs(elements.generalRefs, refs, count);
  elements.generalTags = tags;
  elements.generalRefs = refs;
  const oldNumbers = elements.numbers;
  if (oldNumbers.length > 0 && oldNumbers.length < capacity) {
    const numbers = new Float64Array(capacity);
    numbers.set(oldNumbers);
    elements.numbers = numbers;
  }
}

/** Lazily allocate or grow `elements.numbers` to match `generalTags.length`. */
export function ensureGeneralNumbers<Key, Value>(
  elements: ArrayElements<Key, Value>,
): Float64Array {
  const capacity = elements.generalTags.length;
  const old = elements.numbers;
  if (old.length >= capacity) return old;
  const numbers = new Float64Array(capacity);
  if (old.length > 0) numbers.set(old);
  elements.numbers = numbers;
  return numbers;
}

/** Overwrite a present element or append at `count`. */
export function writeArrayElement<Key, Value>(
  elements: ArrayElements<Key, Value>,
  index: number,
  value: Value,
): void {
  if (elements.generalCount === 0) {
    const count = elements.numberCount;
    if (index > count) throw "ARRAY_ELEMENTS_INVARIANT";
    const payload = elements.keys.numberPayload(value);
    if (payload !== undefined) {
      reserveNumbers<Key, Value>(elements, index + 1)[index] = payload;
      if (index === count) elements.numberCount = count + 1;
      return;
    }
    // The first non-number element switches to flat general storage once.
    const required = index + 1;
    if (required > maximumCapacity) throw "ARRAY_ELEMENTS_CAPACITY";
    let capacity = elements.numbers.length;
    if (capacity < firstCapacity) capacity = firstCapacity;
    while (capacity < required)
      capacity =
        capacity > maximumCapacity / 2 ? maximumCapacity : capacity * 2;
    if (count > 0) {
      if (elements.numbers.length < capacity) {
        const numbers = new Float64Array(capacity);
        numbers.set(elements.numbers);
        elements.numbers = numbers;
      }
    } else {
      elements.numbers = noNumbers;
    }
    const tags = new Uint8Array(capacity);
    for (let i = 0; i < count; i++) tags[i] = 1;
    const refs = allocGeneralRefs(capacity);
    elements.numberCount = 0;
    elements.generalCount = count;
    elements.generalTags = tags;
    elements.generalRefs = refs;
  }
  const count = elements.generalCount;
  if (index > count) throw "ARRAY_ELEMENTS_INVARIANT";
  reserveGeneral<Key, Value>(elements, index + 1);
  if (
    !writeGeneralSlot(
      elements.generalTags,
      elements.generalRefs,
      elements.numbers,
      index,
      value,
    )
  ) {
    ensureGeneralNumbers<Key, Value>(elements);
    if (
      !writeGeneralSlot(
        elements.generalTags,
        elements.generalRefs,
        elements.numbers,
        index,
        value,
      )
    )
      throw "ARRAY_ELEMENTS_INVARIANT";
  }
  if (index === count) elements.generalCount = count + 1;
}

/** Remove elements at and above `count`; every packed element is configurable. */
export function truncateArrayElements<Key, Value>(
  elements: ArrayElements<Key, Value>,
  count: number,
): void {
  const general = elements.generalCount;
  if (general === 0) {
    if (count < elements.numberCount) elements.numberCount = count;
    return;
  }
  if (count >= general) return;
  if (count === 0) {
    // An emptied array starts over with number storage.
    elements.generalCount = 0;
    elements.generalTags = noGeneralTags;
    elements.generalRefs = noGeneralRefs;
    elements.numbers = noNumbers;
    elements.numberCount = 0;
  } else {
    const refs = elements.generalRefs;
    for (let i = count; i < general; i++) clearGeneralRef(refs, i);
    elements.generalCount = count;
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
