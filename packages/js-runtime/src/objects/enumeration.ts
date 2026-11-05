import {
  getPrototype,
  getOwnProperty,
  ownKeys,
  type OrdinaryObject,
} from "./operations.ts";

/** Internal enumeration state, not a user-visible iterator. The classifier uses
 * ownKeys' contract: array index, -1 for other strings, -2 for symbols. */
export interface PropertyEnumeration<Key, Value> {
  object: OrdinaryObject<Key, Value> | undefined;
  readonly visited: Set<Key>;
  keys: Key[];
  position: number;
  started: boolean;
  readonly keyOrder: (key: Key) => number;
}

export function stringPropertyKeyOrder(key: string): number {
  // Array indices are canonical unsigned decimal strings, not arbitrary
  // numeric text. Avoid allocating numeric-conversion scratch for every key.
  if (key.length === 0 || key.length > 10) return -1;
  if (key.length > 1 && key.charCodeAt(0) === 48) return -1;
  let index = 0;
  for (let position = 0; position < key.length; position++) {
    const digit = key.charCodeAt(position) - 48;
    if (digit < 0 || digit > 9) return -1;
    index = index * 10 + digit;
  }
  return index < 4294967295 ? index : -1;
}

export function createPropertyEnumeration<Key, Value>(
  object: OrdinaryObject<Key, Value> | undefined,
  keyOrder: (key: Key) => number,
): PropertyEnumeration<Key, Value> {
  const keys: Key[] = [];
  return {
    object,
    visited: new Set<Key>(),
    keys,
    position: 0,
    started: false,
    keyOrder,
  };
}

/** Snapshot each object's keys once, but inspect its descriptor when visiting.
 * A deleted key does not shadow a prototype key; a non-enumerable own key does.
 * Values and getters are never read. Undefined denotes exhaustion, not a key. */
export function nextEnumerableProperty<Key, Value>(
  iterator: PropertyEnumeration<Key, Value>,
): Key | undefined {
  while (true) {
    const object = iterator.object;
    if (object === undefined) return undefined;
    if (!iterator.started) {
      iterator.keys = ownKeys<Key, Value>(object, iterator.keyOrder);
      iterator.position = 0;
      iterator.started = true;
    }
    while (iterator.position < iterator.keys.length) {
      const key = iterator.keys[iterator.position++];
      if (key === undefined) throw "ENUMERATION_KEY_INVARIANT";
      if (iterator.keyOrder(key) === -2 || iterator.visited.has(key)) continue;
      const descriptor = getOwnProperty<Key, Value>(object, key);
      if (descriptor === undefined) continue;
      iterator.visited.add(key);
      if (descriptor.enumerable) return key;
    }
    iterator.object = getPrototype<Key, Value>(object);
    iterator.started = false;
  }
}
