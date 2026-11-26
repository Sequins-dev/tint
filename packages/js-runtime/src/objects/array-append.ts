import {
  arrayElementCount,
  truncateArrayElements,
  writeArrayElement,
} from "./array-elements.ts";
import { propertyEpoch, type OrdinaryObject } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import type { ErrorRealm } from "./errors.ts";
import { viewTypeofObject } from "./values.ts";

// Indices above this are not array indices or would push length past 2^32 - 1.
const lastAppendIndex = 4294967294;
// Largest Float64Array extent below the native allocator's aligned uint32 bound.
const maxNumberCapacity = 536870906;
// First grown capacity when pushing into an empty number array (`[]`).
const firstPushCapacity = 8;

function hasCleanArrayPushPrototypes(realm: ErrorRealm): boolean {
  const epoch = propertyEpoch.value;
  if (realm.cleanArrayPushEpoch === epoch) return true;
  const arrayPrototype = realm.arrayPrototype;
  const inherited = arrayPrototype.internalArrayElements;
  if (
    inherited === undefined ||
    inherited.values !== undefined ||
    inherited.numberCount !== 0
  )
    return false;
  const objectPrototype = arrayPrototype.prototype;
  if (
    objectPrototype === undefined ||
    objectPrototype !== realm.objectPrototype ||
    objectPrototype.internalDictionary
  )
    return false;
  realm.cleanArrayPushEpoch = epoch;
  return true;
}

/** Append `value` as element `count` of a packed array when [[Set]] there can
 * only create that element: the array is extensible, its prototype is the
 * realm's Array.prototype with no elements, and that prototype's is the
 * realm's Object.prototype in fast mode (an index key moves an ordinary object
 * to dictionary mode), so no object on the chain has the index or intercepts
 * it. When `allowPreallocated` is false (Array.prototype.push), `length` must
 * equal `count` and be writable, and grows by 1; when true (indexed assignment
 * `a[count] = value`), `count < length` is also accepted and leaves `length`
 * unchanged. Otherwise nothing changes and the caller takes the ordinary path. */
export function appendPackedElement(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  value: unknown,
  realm: ErrorRealm,
  allowPreallocated: boolean = false,
): boolean {
  const elements = object.internalArrayElements;
  if (elements === undefined || !object.extensible) return false;
  const count = arrayElementCount<ScriptPropertyKey, unknown>(elements);
  const growing = elements.length === count;
  if (growing) {
    if (!elements.lengthWritable || count > lastAppendIndex) return false;
  } else if (!allowPreallocated || count >= elements.length) {
    return false;
  }
  const arrayPrototype = object.prototype;
  if (arrayPrototype === undefined || arrayPrototype !== realm.arrayPrototype)
    return false;
  if (!hasCleanArrayPushPrototypes(realm)) return false;
  writeArrayElement<ScriptPropertyKey, unknown>(elements, count, value);
  if (growing) elements.length = count + 1;
  return true;
}

/** Pop the last element of a dense packed array (writable `length === count`)
 * without property-key conversion or prototype traversal. Returns
 * `realm.arrayPopMiss` when the fast path does not apply, leaving the object
 * unchanged. */
export function popPackedElement(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  realm: ErrorRealm,
): unknown {
  const elements = object.internalArrayElements;
  if (elements === undefined || !elements.lengthWritable)
    return realm.arrayPopMiss;
  const values = elements.values;
  if (values === undefined) {
    const count = elements.numberCount;
    if (elements.length !== count) return realm.arrayPopMiss;
    if (count === 0) return undefined;
    const last = count - 1;
    const result = elements.numbers[last];
    if (result === undefined) throw "ARRAY_ELEMENTS_INVARIANT";
    elements.numberCount = last;
    elements.length = last;
    return result;
  }
  const count = values.length;
  if (elements.length !== count) return realm.arrayPopMiss;
  if (count === 0) return undefined;
  const last = count - 1;
  const cell = values[last];
  if (cell === undefined) throw "ARRAY_ELEMENTS_INVARIANT";
  const result = cell.elementValue;
  truncateArrayElements<ScriptPropertyKey, unknown>(elements, last);
  elements.length = last;
  return result;
}

/** Array.prototype.push's result for one item when it is a packed append
 * (see appendPackedElement), else -1 with nothing changed. Generated calls
 * of the realm's push use it before the ordinary call. */
export function scriptArrayPush(
  value: unknown,
  item: unknown,
  realm: ErrorRealm,
): number {
  const object = viewTypeofObject(value);
  if (object === undefined) return -1;
  const elements = object.internalArrayElements;
  if (elements === undefined || !object.extensible || !elements.lengthWritable)
    return -1;
  const arrayPrototype = object.prototype;
  if (arrayPrototype === undefined || arrayPrototype !== realm.arrayPrototype)
    return -1;
  if (
    propertyEpoch.value !== realm.cleanArrayPushEpoch &&
    !hasCleanArrayPushPrototypes(realm)
  )
    return -1;
  // Fast steady-state path: append a Number directly into existing or freshly
  // grown capacity without helper or hook closure dispatch.
  const values = elements.values;
  if (values === undefined && typeof item === "number") {
    const count = elements.numberCount;
    if (elements.length === count) {
      let numbers = elements.numbers;
      if (count < numbers.length) {
        numbers[count] = item;
        const next = count + 1;
        elements.numberCount = next;
        elements.length = next;
        return next;
      }
      if (count < maxNumberCapacity) {
        const capacity =
          numbers.length < firstPushCapacity
            ? firstPushCapacity
            : numbers.length > maxNumberCapacity / 2
              ? maxNumberCapacity
              : numbers.length * 2;
        const grown = new Float64Array(capacity);
        grown.set(numbers);
        grown[count] = item;
        elements.numbers = grown;
        const next = count + 1;
        elements.numberCount = next;
        elements.length = next;
        return next;
      }
    }
  } else if (values !== undefined) {
    // Fast steady-state path: append any value directly to a packed general array.
    const count = values.length;
    if (elements.length === count && count <= lastAppendIndex) {
      values.push({ elementValue: item });
      const next = count + 1;
      elements.length = next;
      return next;
    }
  } else if (elements.numberCount === 0 && elements.length === 0) {
    // Empty freshly-created array receiving its first non-number element.
    elements.values = [{ elementValue: item }];
    elements.length = 1;
    return 1;
  }
  if (!appendPackedElement(object, item, realm)) return -1;
  return elements.length;
}

/** Zero-capture inlineable fast path for steady-state numeric Array.prototype.push.
 * Appends `item` into existing Float64Array capacity when the receiver is an
 * extensible packed array inheriting from the realm's clean Array.prototype,
 * returning the new length, or -1 to fall back to `scriptArrayPush`. */
export function scriptArrayPushFast(
  object: OrdinaryObject<ScriptPropertyKey, unknown> | undefined,
  item: number,
  realm: ErrorRealm,
): number {
  if (
    object !== undefined &&
    object.extensible &&
    object.prototype === realm.arrayPrototype &&
    realm.propertyEpoch.value === realm.cleanArrayPushEpoch
  ) {
    const elements = object.internalArrayElements;
    if (
      elements !== undefined &&
      elements.values === undefined &&
      elements.lengthWritable
    ) {
      const count = elements.numberCount;
      const numbers = elements.numbers;
      if (elements.length === count && count < numbers.length) {
        numbers[count] = item;
        const next = count + 1;
        elements.numberCount = next;
        elements.length = next;
        return next;
      }
    }
  }
  return -1;
}

/** Array.prototype.pop's result for a dense packed array (see
 * popPackedElement), else `realm.arrayPopMiss` with nothing changed. */
export function scriptArrayPop(value: unknown, realm: ErrorRealm): unknown {
  const object = viewTypeofObject(value);
  if (object === undefined) return realm.arrayPopMiss;
  return popPackedElement(object, realm);
}
