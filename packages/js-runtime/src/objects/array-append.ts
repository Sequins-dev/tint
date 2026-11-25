import {
  arrayElementCount,
  readArrayElement,
  truncateArrayElements,
  writeArrayElement,
} from "./array-elements.ts";
import type { OrdinaryObject } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import type { ErrorRealm } from "./errors.ts";
import { viewObjectValue } from "./values.ts";

// Indices above this are not array indices or would push length past 2^32 - 1.
const lastAppendIndex = 4294967294;

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
  const inherited = arrayPrototype.internalArrayElements;
  if (
    inherited === undefined ||
    arrayElementCount<ScriptPropertyKey, unknown>(inherited) !== 0
  )
    return false;
  const objectPrototype = arrayPrototype.prototype;
  if (
    objectPrototype === undefined ||
    objectPrototype !== realm.objectPrototype ||
    objectPrototype.internalDictionary
  )
    return false;
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
  const count = arrayElementCount<ScriptPropertyKey, unknown>(elements);
  if (elements.length !== count) return realm.arrayPopMiss;
  if (count === 0) return undefined;
  const last = count - 1;
  const result = readArrayElement<ScriptPropertyKey, unknown>(elements, last);
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
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object === undefined) return -1;
  const elements = object.internalArrayElements;
  if (elements === undefined || !object.extensible || !elements.lengthWritable)
    return -1;
  const arrayPrototype = object.prototype;
  if (arrayPrototype === undefined || arrayPrototype !== realm.arrayPrototype)
    return -1;
  const inherited = arrayPrototype.internalArrayElements;
  if (
    inherited === undefined ||
    inherited.values !== undefined ||
    inherited.numberCount !== 0
  )
    return -1;
  const objectPrototype = arrayPrototype.prototype;
  if (
    objectPrototype === undefined ||
    objectPrototype !== realm.objectPrototype ||
    objectPrototype.internalDictionary
  )
    return -1;
  // Fast steady-state path: append a Number directly into existing capacity
  // without helper or hook closure dispatch.
  if (elements.values === undefined) {
    const count = elements.numberCount;
    if (elements.length === count && typeof item === "number") {
      const numbers = elements.numbers;
      if (count < numbers.length) {
        numbers[count] = item;
        const next = count + 1;
        elements.numberCount = next;
        elements.length = next;
        return next;
      }
    }
  }
  if (!appendPackedElement(object, item, realm)) return -1;
  return elements.length;
}

/** Array.prototype.pop's result for a dense packed array (see
 * popPackedElement), else `realm.arrayPopMiss` with nothing changed. */
export function scriptArrayPop(value: unknown, realm: ErrorRealm): unknown {
  const object = viewObjectValue(value, realm.objectPrototype);
  if (object === undefined) return realm.arrayPopMiss;
  return popPackedElement(object, realm);
}
