import {
  emptyUpdate,
  configurableField,
  writableField,
} from "../descriptors/index.ts";
import {
  defineOwnProperty,
  getOwnProperty,
  isExtensible,
  ownKeys,
  preventExtensions,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";
/** The classifier follows ownKeys' contract. Exotic own-key order is
 * preserved verbatim, including during seal/freeze. */
export function setIntegrityLevel<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  frozen: boolean,
  hooks: ObjectHooks<Value>,
  keyOrder: (key: Key) => number,
): boolean {
  if (!preventExtensions<Key, Value>(object)) return false;
  const keys = ownKeys<Key, Value>(object, keyOrder);
  for (const key of keys) {
    if (key === undefined) throw "PROPERTY_KEY_INVARIANT";
    const descriptor = frozen
      ? getOwnProperty<Key, Value>(object, key)
      : undefined;
    if (frozen && descriptor === undefined) continue;
    const fields =
      configurableField |
      (descriptor !== undefined && !descriptor.accessor ? writableField : 0);
    const status = defineOwnProperty<Key, Value>(
      object,
      key,
      { ...emptyUpdate<Value>(hooks.undefinedValue), fields },
      hooks,
    );
    if (status !== "accepted") return false;
  }
  return true;
}
export function testIntegrityLevel<Key, Value>(
  object: OrdinaryObject<Key, Value>,
  frozen: boolean,
  keyOrder: (key: Key) => number,
): boolean {
  if (isExtensible<Key, Value>(object)) return false;
  for (const key of ownKeys<Key, Value>(object, keyOrder)) {
    if (key === undefined) throw "PROPERTY_KEY_INVARIANT";
    const descriptor = getOwnProperty<Key, Value>(object, key);
    if (
      descriptor !== undefined &&
      (descriptor.configurable ||
        (frozen && !descriptor.accessor && descriptor.writable))
    )
      return false;
  }
  return true;
}
