import {
  allocGeneralRefs,
  arrayElementCount,
  ensureGeneralNumbers,
  noNumbers,
  readGeneralSlot,
  reserveGeneral,
  truncateArrayElements,
  writeArrayElement,
  writeGeneralSlot,
  type ArrayElements,
} from "./array-elements.ts";
import {
  objectFlagDictionary,
  objectFlagExtensible,
  propertyEpoch,
  type OrdinaryObject,
} from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import type { ErrorRealm } from "./errors.ts";
import { viewTypeofObject } from "./values.ts";

// Indices above this are not array indices or would push length past 2^32 - 1.
const lastAppendIndex = 4294967294;
// Largest Float64Array / ReferenceVector extent below the native allocator's aligned uint32 bound.
const maxNumberCapacity = 536870906;
// First grown capacity when pushing into an empty array (`[]`).
const firstPushCapacity = 8;

function hasCleanArrayPushPrototypes(realm: ErrorRealm): boolean {
  const epoch = propertyEpoch.value;
  if (realm.cleanArrayPushEpoch === epoch) return true;
  const arrayPrototype = realm.arrayPrototype;
  const inherited = arrayPrototype.internalArrayElements;
  if (
    inherited === undefined ||
    inherited.generalCount !== 0 ||
    inherited.numberCount !== 0
  )
    return false;
  const objectPrototype = arrayPrototype.prototype;
  if (
    objectPrototype === undefined ||
    objectPrototype !== realm.objectPrototype ||
    (objectPrototype.internalFlags & objectFlagDictionary) !== 0
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
  if (
    elements === undefined ||
    (object.internalFlags & objectFlagExtensible) === 0
  )
    return false;
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
  const general = elements.generalCount;
  if (general === 0) {
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
  if (elements.length !== general) return realm.arrayPopMiss;
  const last = general - 1;
  const result = readGeneralSlot(
    elements.generalTags,
    elements.generalRefs,
    elements.numbers,
    last,
  );
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
  if (
    elements === undefined ||
    (object.internalFlags & objectFlagExtensible) === 0 ||
    !elements.lengthWritable
  )
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
  const general = elements.generalCount;
  if (general === 0 && typeof item === "number") {
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
  } else if (general > 0) {
    // Fast steady-state path: append any value directly into flat general storage.
    if (elements.length === general && general < maxNumberCapacity) {
      if (general >= elements.generalTags.length)
        reserveGeneral<ScriptPropertyKey, unknown>(elements, general + 1);
      if (
        !writeGeneralSlot(
          elements.generalTags,
          elements.generalRefs,
          elements.numbers,
          general,
          item,
        )
      ) {
        ensureGeneralNumbers<ScriptPropertyKey, unknown>(elements);
        if (
          !writeGeneralSlot(
            elements.generalTags,
            elements.generalRefs,
            elements.numbers,
            general,
            item,
          )
        )
          throw "ARRAY_ELEMENTS_INVARIANT";
      }
      const next = general + 1;
      elements.generalCount = next;
      elements.length = next;
      return next;
    }
  } else if (elements.numberCount === 0 && elements.length === 0) {
    // Empty freshly-created array receiving its first non-number element.
    const generalTags = new Uint8Array(firstPushCapacity);
    const generalRefs = allocGeneralRefs(firstPushCapacity);
    writeGeneralSlot(generalTags, generalRefs, noNumbers, 0, item);
    elements.generalTags = generalTags;
    elements.generalRefs = generalRefs;
    elements.generalCount = 1;
    elements.length = 1;
    return 1;
  }
  if (!appendPackedElement(object, item, realm)) return -1;
  return elements.length;
}

/** Out-of-line steady-state flat general array append called from
 * `scriptArrayPushFast`, keeping the numeric steady-state path small enough
 * for IR inlining into hot loops. */
function scriptArrayPushGeneralFast(
  elements: ArrayElements<ScriptPropertyKey, unknown>,
  item: unknown,
): number {
  const general = elements.generalCount;
  const tags = elements.generalTags;
  if (elements.length === general && general < tags.length) {
    if (
      writeGeneralSlot(
        tags,
        elements.generalRefs,
        elements.numbers,
        general,
        item,
      )
    ) {
      const next = general + 1;
      elements.generalCount = next;
      elements.length = next;
      return next;
    }
  }
  return -1;
}

/** Zero-capture inlineable fast path for steady-state packed Array.prototype.push.
 * Appends `item` into existing binary64 capacity inline (or delegates flat
 * general capacity to `scriptArrayPushGeneralFast`) when the receiver is an
 * extensible packed array inheriting from the realm's clean Array.prototype,
 * returning the new length, or -1 to fall back to `scriptArrayPush`. */
export function scriptArrayPushFast(
  object: OrdinaryObject<ScriptPropertyKey, unknown> | undefined,
  item: unknown,
  realm: ErrorRealm,
): number {
  if (
    object !== undefined &&
    (object.internalFlags & objectFlagExtensible) !== 0 &&
    object.prototype === realm.arrayPrototype &&
    realm.propertyEpoch.value === realm.cleanArrayPushEpoch
  ) {
    const elements = object.internalArrayElements;
    if (elements !== undefined && elements.lengthWritable) {
      if (elements.generalCount === 0) {
        if (typeof item === "number") {
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
      } else {
        return scriptArrayPushGeneralFast(elements, item);
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
