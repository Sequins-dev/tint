import type {
  ObjectHooks,
  OrdinaryObject,
  ScriptPropertyCache,
} from "./operations.ts";
import type { ScriptPropertyKey } from "./symbols.ts";
import type { ErrorRealm } from "./errors.ts";
import { readCachedObjectValueProperty, viewObjectValue } from "./values.ts";

/** Inline element access for generated code. Native code binds these
 * functions to IR element-load, element-store and the absent test; their
 * bodies are the portable definitions. Both apply only to the packed number
 * elements of an array (see ArrayElements): each such index is an own
 * writable data property and the object has no property contract, so a read
 * never consults the prototype chain and an overwrite needs no other check.
 * Everything else (holes, appends, general elements, other objects and
 * non-integer keys) misses to the generic paths. */

/** The packed number element `index` of an object value, or a miss: `witness`,
 * which no number element can be (natively the absent value). */
export function packedNumberElement(
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
  value: unknown,
  index: number,
): unknown {
  const elements = viewObjectValue(value, witness)?.internalArrayElements;
  if (
    elements === undefined ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= elements.numberCount
  )
    return witness;
  return elements.numbers[index];
}

/** Whether packedNumberElement missed. */
export function absentElementValue(
  value: unknown,
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
): boolean {
  return value === witness;
}

/** Overwrite the packed number element `index` of an object value with a
 * Number; false, with nothing written, when either does not apply. */
export function storePackedNumberElement(
  witness: OrdinaryObject<ScriptPropertyKey, unknown>,
  target: unknown,
  index: number,
  value: unknown,
): boolean {
  if (typeof value !== "number") return false;
  const elements = viewObjectValue(target, witness)?.internalArrayElements;
  if (
    elements === undefined ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= elements.numberCount
  )
    return false;
  elements.numbers[index] = value;
  return true;
}

/** A generated `length` read of a value that is not a String: the length an
 * array with packed elements mirrors (every length definition refreshes it),
 * else the site's cached read. */
export function readCachedLengthValue(
  base: unknown,
  key: string,
  hooks: ObjectHooks<unknown>,
  realm: ErrorRealm,
  cache: ScriptPropertyCache,
): unknown {
  const elements = viewObjectValue(
    base,
    realm.objectPrototype,
  )?.internalArrayElements;
  if (elements !== undefined) return elements.length;
  return readCachedObjectValueProperty(base, key, hooks, realm, cache);
}
