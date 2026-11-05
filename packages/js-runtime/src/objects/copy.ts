import {
  createDataProperty,
  getOwnProperty,
  getProperty,
  ownKeys,
  type OrdinaryObject,
  type ObjectHooks,
} from "./operations.ts";

/** Ordinary-object portion of CopyDataProperties. The embedding runtime skips
 * null/undefined sources and performs ToObject before calling this operation.
 * sourceValue is the resulting object's value, used as the getter receiver.
 * Keys and exclusions must use the same canonical identity as the property map.
 * False requests a TypeError from the embedding runtime; getter exceptions
 * propagate directly. Earlier copies remain observable on failure. */
export function copyDataProperties<Key, Value>(
  target: OrdinaryObject<Key, Value>,
  source: OrdinaryObject<Key, Value>,
  sourceValue: Value,
  excluded: readonly Key[],
  keyOrder: (key: Key) => number,
  hooks: ObjectHooks<Value>,
): boolean {
  const keys = ownKeys<Key, Value>(source, keyOrder);
  for (const key of keys) {
    if (key === undefined) throw "PROPERTY_KEY_INVARIANT";
    if (excluded.includes(key)) continue;
    const descriptor = getOwnProperty<Key, Value>(source, key);
    if (descriptor === undefined || !descriptor.enumerable) continue;
    const value = getProperty<Key, Value>(source, key, sourceValue, hooks);
    if (!createDataProperty<Key, Value>(target, key, value, hooks))
      return false;
  }
  return true;
}
