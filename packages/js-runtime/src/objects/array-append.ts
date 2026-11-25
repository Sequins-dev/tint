import { arrayElementCount, writeArrayElement } from "./array-elements.ts";
import type { OrdinaryObject } from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import type { ErrorRealm } from "./errors.ts";
import { viewObjectValue } from "./values.ts";

// Indices above this are not array indices or would push length past 2^32 - 1.
const lastAppendIndex = 4294967294;

/** Append `value` as element `count` of a packed array when [[Set]] there can
 * only create that element: the array is extensible, its writable length
 * equals its count, its prototype is the realm's Array.prototype with no
 * elements, and that prototype's is the realm's Object.prototype in fast mode
 * (an index key moves an ordinary object to dictionary mode), so no object
 * on the chain has the index or intercepts it. Then the element and the
 * length update in place; otherwise nothing changes and the caller takes the
 * ordinary path. */
export function appendPackedElement(
  object: OrdinaryObject<ScriptPropertyKey, unknown>,
  value: unknown,
  realm: ErrorRealm,
): boolean {
  const elements = object.internalArrayElements;
  if (elements === undefined || !object.extensible || !elements.lengthWritable)
    return false;
  const count = arrayElementCount<ScriptPropertyKey, unknown>(elements);
  if (elements.length !== count || count > lastAppendIndex) return false;
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
  elements.length = count + 1;
  return true;
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
  if (object === undefined || !appendPackedElement(object, item, realm))
    return -1;
  const elements = object.internalArrayElements;
  if (elements === undefined) throw "ARRAY_APPEND_INVARIANT";
  return elements.length;
}
